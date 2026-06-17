-- 20260617000001_catalog_grant_function.sql
--
-- Spec 019 — grant_hifz_cycle_credits function (T004).
--
-- Inserts a student_packages grant whose sessions_total equals the plan's
-- sessions_per_month. Idempotent on (subscription_id, billing_cycle_key) via
-- the composite unique index uix_student_packages_cycle_grant.
--
-- This function does NOT record a payment — that is handled by the existing
-- grant_subscription_cycle (spec 018) in the normal invoice.paid webhook flow.
-- This function is used for:
--   - T014a: re-grant at renewal when applying a pending tier change
--   - T022: delta session grant on mid-month upgrade
-- The normal monthly cycle grant flows through grant_subscription_cycle (spec 018),
-- which already records payment + grant atomically and uses monthly_credit_count
-- (= sessions_per_month for hifz plans) as the credit count.
--
-- SECURITY DEFINER; REVOKE from public/anon/authenticated; GRANT to service_role only.

create or replace function public.grant_hifz_cycle_credits(
  p_subscription_id    uuid,
  p_plan_id            uuid,
  p_billing_cycle_key  text,
  p_session_count      integer default null  -- optional: override for delta grants (mid-cycle upgrades)
) returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_student_id       uuid;
  v_sessions_per_mon integer;
  v_period_end       timestamptz;
  v_existing_id      uuid;
  v_grant_id         uuid;
begin
  -- Reject null or blank billing_cycle_key — a null key bypasses the idempotency index.
  if p_billing_cycle_key is null or trim(p_billing_cycle_key) = '' then
    raise exception 'grant_hifz_cycle_credits: billing_cycle_key must not be null or blank'
      using errcode = '22023';
  end if;

  -- Resolve student_id, period_end, and sessions_per_month atomically, asserting that
  -- p_plan_id matches the subscription's current plan_id (prevents cross-plan grants).
  select s.student_id, s.current_period_end, sp.sessions_per_month
    into v_student_id, v_period_end, v_sessions_per_mon
    from public.subscriptions s
    join public.subscription_plans sp on sp.id = s.plan_id
   where s.id = p_subscription_id
     and s.plan_id = p_plan_id;

  if v_student_id is null then
    raise exception 'grant_hifz_cycle_credits: subscription % not found or plan mismatch with %', p_subscription_id, p_plan_id
      using errcode = '22023';
  end if;

  if v_period_end is null then
    raise exception 'grant_hifz_cycle_credits: subscription % has null current_period_end', p_subscription_id
      using errcode = '22023';
  end if;

  if v_sessions_per_mon is null then
    raise exception 'grant_hifz_cycle_credits: plan % has no sessions_per_month (not a hifz plan?)', p_plan_id
      using errcode = '22023';
  end if;

  -- Reject zero/negative override — prevents corrupt cycle grants.
  if p_session_count is not null and p_session_count <= 0 then
    raise exception 'grant_hifz_cycle_credits: p_session_count must be > 0 when provided'
      using errcode = '22023';
  end if;

  -- Reject over-grant: delta cannot exceed the plan's full monthly allowance.
  if p_session_count is not null and p_session_count > v_sessions_per_mon then
    raise exception 'grant_hifz_cycle_credits: p_session_count (%) exceeds plan sessions_per_month (%)',
      p_session_count, v_sessions_per_mon
      using errcode = '22023';
  end if;

  -- Apply override: mid-cycle upgrades pass deltaSessions; renewals pass null → full count.
  v_sessions_per_mon := coalesce(p_session_count, v_sessions_per_mon);

  -- Idempotency short-circuit: same (subscription_id, billing_cycle_key) already granted.
  select id into v_existing_id
    from public.student_packages
    where subscription_id = p_subscription_id
      and billing_cycle_key = p_billing_cycle_key;

  if v_existing_id is not null then
    return v_existing_id;
  end if;

  -- Grant. package_id is NULL (subscription grants carry subscription_id, not a packages row).
  -- session_mode_used is OMITTED so the column DEFAULT applies (spec 018 H1 fix pattern).
  insert into public.student_packages (
    student_id, package_id, sessions_total, status,
    expires_at, subscription_id, billing_cycle_key
  )
  values (
    v_student_id, null, v_sessions_per_mon, 'active',
    v_period_end, p_subscription_id, p_billing_cycle_key
  )
  on conflict (subscription_id, billing_cycle_key) where billing_cycle_key is not null do nothing
  returning id into v_grant_id;

  if v_grant_id is null then
    -- Lost the race; return the winner's id.
    select id into v_grant_id
      from public.student_packages
      where subscription_id = p_subscription_id
        and billing_cycle_key = p_billing_cycle_key;
  end if;

  return v_grant_id;
end;
$$;

alter function public.grant_hifz_cycle_credits(uuid, uuid, text, integer) owner to postgres;

-- Lockdown (NFR-002): only service_role may invoke.
revoke all on function public.grant_hifz_cycle_credits(uuid, uuid, text, integer) from public, anon, authenticated;
grant execute on function public.grant_hifz_cycle_credits(uuid, uuid, text, integer) to service_role;
