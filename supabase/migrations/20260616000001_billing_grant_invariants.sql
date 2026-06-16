-- 20260616000001_billing_grant_invariants.sql
--
-- Adds an ownership invariant to grant_subscription_cycle (spec 018 P2 Codex fix).
-- Verifies that p_subscription_id belongs to p_student_id before granting,
-- preventing a mis-wired caller from crediting the wrong student.
--
-- Forward-only timestamped migration. Lands after 20260616000000.

create or replace function public.grant_subscription_cycle(
  p_subscription_id uuid,
  p_student_id uuid,
  p_plan_id uuid,
  p_cycle_key text,
  p_stripe_payment_intent text,
  p_amount_cents int,
  p_credit_count int,
  p_expires_at timestamptz,
  p_session_metadata jsonb
) returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_existing_id uuid;
  v_amount_usd   numeric := p_amount_cents / 100.0;
  v_payment_id   uuid;
  v_grant_id     uuid;
begin
  -- Invariant: subscription must belong to the given student.
  -- Prevents a mis-wired caller from crediting the wrong student.
  if not exists (
    select 1 from public.subscriptions
    where id = p_subscription_id and student_id = p_student_id
  ) then
    raise exception 'grant_subscription_cycle: subscription % does not belong to student %',
      p_subscription_id, p_student_id
      using errcode = '22023';
  end if;

  -- 1. Idempotency short-circuit: same cycle_key already granted → return it.
  select id into v_existing_id
    from public.student_packages
    where billing_cycle_key = p_cycle_key;
  if v_existing_id is not null then
    return v_existing_id;
  end if;

  -- 2. Payment (idempotent on stripe_payment_intent).
  insert into public.payments (
    student_id, provider, stripe_payment_intent,
    amount_usd, amount_before_tax, tax_rate, tax_amount, revenue_recognized,
    status, paid_at
  )
  values (
    p_student_id, 'stripe', p_stripe_payment_intent,
    v_amount_usd, v_amount_usd, 0, 0, 0,
    'succeeded', now()
  )
  on conflict (stripe_payment_intent) do nothing
  returning id into v_payment_id;

  if v_payment_id is null then
    select id into v_payment_id
      from public.payments
      where stripe_payment_intent = p_stripe_payment_intent;
  end if;

  -- 3. Grant. package_id is intentionally NULL for subscription grants.
  insert into public.student_packages (
    student_id, package_id, sessions_total, status,
    expires_at, session_mode_used, subscription_id, billing_cycle_key
  )
  values (
    p_student_id, null, p_credit_count, 'active',
    p_expires_at, p_session_metadata, p_subscription_id, p_cycle_key
  )
  on conflict (billing_cycle_key) where billing_cycle_key is not null do nothing
  returning id into v_grant_id;

  if v_grant_id is null then
    select id into v_grant_id
      from public.student_packages
      where billing_cycle_key = p_cycle_key;
  end if;

  return v_grant_id;
end;
$$;

alter function public.grant_subscription_cycle(uuid, uuid, uuid, text, text, int, int, timestamptz, jsonb) owner to postgres;

-- Maintain lockdown (NFR-002): service_role only.
revoke all on function public.grant_subscription_cycle(uuid, uuid, uuid, text, text, int, int, timestamptz, jsonb) from public, anon, authenticated;
grant execute on function public.grant_subscription_cycle(uuid, uuid, uuid, text, text, int, int, timestamptz, jsonb) to service_role;
