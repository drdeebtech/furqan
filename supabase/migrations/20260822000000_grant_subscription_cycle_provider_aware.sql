-- Spec 039 / PayPal epic (#756) Phase 2 (#759) — make grant_subscription_cycle
-- provider-aware. Mirrors the proven prepaid twin
-- (20260719000000_grant_prepaid_hours_provider_aware.sql).
--
-- WHY. grant_subscription_cycle is the SECURITY DEFINER function that atomically
--   records the cycle payment and grants the monthly credits. It hardcodes
--   provider='stripe' and keys payment idempotency on stripe_payment_intent, so a
--   PayPal-funded subscription cycle cannot flow through the SAME grant path.
--   Phase 1 (#758) added payments.paypal_sale_id + widened the cross-field CHECK;
--   this phase teaches the function to branch on the paying processor while
--   keeping the Stripe path byte-identical.
--
-- WHAT. Two new DEFAULTed params (p_provider DEFAULT 'stripe', p_provider_ref
--   DEFAULT null) so every existing 9-arg caller (orchestrate.ts RPC) keeps
--   working unchanged. The function now:
--     • validates provider ∈ (stripe, paypal),
--     • rejects paypal with a NULL ref BEFORE any write (would else violate the
--       widened CHECK),
--     • branches the payments insert: stripe → stripe_payment_intent (conflict
--       target payments_stripe_payment_intent_key, unchanged); paypal →
--       paypal_sale_id (conflict target uq_payments_paypal_sale_id, partial),
--     • stamps student_packages.payment_provider + provider_payment_ref for
--       paypal grants; stripe grants are unchanged (payment_provider DEFAULTs to
--       'stripe', provider_payment_ref stays NULL as today, stripe_payment_intent_id
--       still written for refund mapping).
--
-- SIGNATURE CHANGE (safe). CREATE OR REPLACE cannot add parameters, so DROP the
--   9-arg + CREATE the 11-arg in one (atomic) migration. Existing callers pass 9
--   named args and resolve to the 11-arg function via the two DEFAULTs — no live
--   shape breaks, and the running build's Stripe webhook keeps calling with 9
--   args. The migration-safety guard does not flag DROP FUNCTION; there is no
--   column/type contraction here.
-- expand-contract-ok: 9-arg callers resolve to the new 11-arg fn via DEFAULTs; atomic DROP+CREATE, no live shape broken.
--
-- Idempotency + invariants proven by the rolled-back walk
-- scripts/walk-paypal-subscription-grant.sql (acceptance #1–#7).

drop function if exists public.grant_subscription_cycle(
  uuid, uuid, uuid, text, text, integer, integer, timestamptz, jsonb
);

create function public.grant_subscription_cycle(
  p_subscription_id uuid,
  p_student_id uuid,
  p_plan_id uuid,
  p_cycle_key text,
  p_stripe_payment_intent text,
  p_amount_cents integer,
  p_credit_count integer,
  p_expires_at timestamptz,
  p_session_metadata jsonb,
  p_provider text default 'stripe',
  p_provider_ref text default null
) returns uuid
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_existing_id uuid;
  v_amount_usd   numeric := p_amount_cents / 100.0;
  v_payment_id   uuid;
  v_grant_id     uuid;
begin
  -- Invariant: subscription must belong to the given student (unchanged).
  if not exists (
    select 1 from public.subscriptions
    where id = p_subscription_id and student_id = p_student_id
  ) then
    raise exception 'grant_subscription_cycle: subscription % does not belong to student %',
      p_subscription_id, p_student_id
      using errcode = '22023';
  end if;

  -- Provider validation. Reject an unknown processor, and reject a paypal grant
  -- with no capture ref BEFORE any insert (it would otherwise violate the
  -- widened payments_provider_id_check).
  if p_provider is null or p_provider not in ('stripe', 'paypal') then
    raise exception 'grant_subscription_cycle: invalid provider (%)', p_provider
      using errcode = 'P0001';
  end if;
  if p_provider = 'paypal' and p_provider_ref is null then
    raise exception 'grant_subscription_cycle: paypal grant requires p_provider_ref'
      using errcode = 'P0001';
  end if;

  -- 1. Idempotency short-circuit: same cycle_key already granted → return it.
  select id into v_existing_id
    from public.student_packages
    where billing_cycle_key = p_cycle_key;
  if v_existing_id is not null then
    return v_existing_id;
  end if;

  -- 2. Payment (idempotent on the processor-specific ref). Stripe path is
  --    byte-identical to the pre-#759 function; paypal is the new branch.
  if p_provider = 'stripe' then
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
  else
    insert into public.payments (
      student_id, provider, paypal_sale_id,
      amount_usd, amount_before_tax, tax_rate, tax_amount, revenue_recognized,
      status, paid_at
    )
    values (
      p_student_id, 'paypal', p_provider_ref,
      v_amount_usd, v_amount_usd, 0, 0, 0,
      'succeeded', now()
    )
    on conflict (paypal_sale_id) where paypal_sale_id is not null do nothing
    returning id into v_payment_id;

    if v_payment_id is null then
      select id into v_payment_id
        from public.payments
        where paypal_sale_id = p_provider_ref;
    end if;
  end if;

  -- 3. Grant. package_id is NULL for subscription grants; session_mode_used is
  --    OMITTED so its column DEFAULT applies (H1 fix). stripe_payment_intent_id
  --    is written only for stripe (refund → grant → subscription mapping, fix #2);
  --    payment_provider/provider_payment_ref stamp the paypal funding source
  --    (stripe leaves them at DEFAULT 'stripe' / NULL — unchanged from today).
  insert into public.student_packages (
    student_id, package_id, sessions_total, status,
    expires_at, subscription_id, billing_cycle_key,
    stripe_payment_intent_id, payment_provider, provider_payment_ref
  )
  values (
    p_student_id, null, p_credit_count, 'active',
    p_expires_at, p_subscription_id, p_cycle_key,
    case when p_provider = 'stripe' then p_stripe_payment_intent else null end,
    p_provider,
    case when p_provider = 'stripe' then null else p_provider_ref end
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
$function$;

-- Preserve ownership + SECURITY DEFINER lockdown for the NEW 11-arg signature:
-- callable only by service_role (webhook/admin server paths); never anon/authed.
alter function public.grant_subscription_cycle(
  uuid, uuid, uuid, text, text, integer, integer, timestamptz, jsonb, text, text
) owner to postgres;

revoke execute on function public.grant_subscription_cycle(
  uuid, uuid, uuid, text, text, integer, integer, timestamptz, jsonb, text, text
) from public, anon, authenticated;

grant execute on function public.grant_subscription_cycle(
  uuid, uuid, uuid, text, text, integer, integer, timestamptz, jsonb, text, text
) to service_role;
