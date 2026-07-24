-- Rolled-back money-path proof for #759 (grant_subscription_cycle provider-aware).
-- Applies the migration inline, then asserts acceptance #1–#7 with controls.
-- Run:  PGPASSWORD=postgres psql -h 127.0.0.1 -p 54322 -U postgres -d postgres \
--         -v ON_ERROR_STOP=1 -f scripts/walk-paypal-subscription-grant.sql
\set ON_ERROR_STOP on
BEGIN;
SET LOCAL session_replication_role = replica;  -- FK off for setup + fn inserts

-- ── Seed: two students, two subscriptions (A→studentA, B→studentB) ──────────
insert into public.subscriptions (id, student_id, plan_id, provider, provider_subscription_id, status)
values
  ('a0000000-0000-4000-8000-000000000001', '11111111-1111-1111-1111-111111111111',
   'cccccccc-0000-4000-8000-00000000c001'::uuid, 'stripe', 'sub_A', 'active'),
  ('b0000000-0000-4000-8000-000000000002', '22222222-2222-2222-2222-222222222222',
   'cccccccc-0000-4000-8000-00000000c001'::uuid, 'stripe', 'sub_B', 'active');

-- ── Apply the migration under test ──────────────────────────────────────────
\i supabase/migrations/20260822000000_grant_subscription_cycle_provider_aware.sql

CREATE TEMP TABLE _p(step text, got text, want text);

-- Control: the new 11-arg signature actually took effect.
insert into _p select 'sig_is_11_arg', pronargs::text, '11'
  from pg_proc where proname = 'grant_subscription_cycle';

-- ── #1 STRIPE byte-identical (9-arg call, no provider args) ─────────────────
select public.grant_subscription_cycle(
  p_subscription_id       => 'a0000000-0000-4000-8000-000000000001',
  p_student_id            => '11111111-1111-1111-1111-111111111111',
  p_plan_id               => 'cccccccc-0000-4000-8000-00000000c001',
  p_cycle_key             => 'cyc_stripe_1',
  p_stripe_payment_intent => 'pi_stripe_1',
  p_amount_cents          => 4000,
  p_credit_count          => 8,
  p_expires_at            => now() + interval '35 days',
  p_session_metadata      => '{}'::jsonb
);
insert into _p select 'a1_stripe_payment', provider || '/' || coalesce(stripe_payment_intent,'NULL'), 'stripe/pi_stripe_1'
  from public.payments where stripe_payment_intent = 'pi_stripe_1';
insert into _p select 'a1_stripe_grant_provider', payment_provider, 'stripe'
  from public.student_packages where billing_cycle_key = 'cyc_stripe_1';
insert into _p select 'a1_stripe_grant_ref_null', coalesce(provider_payment_ref,'NULL'), 'NULL'
  from public.student_packages where billing_cycle_key = 'cyc_stripe_1';
insert into _p select 'a1_stripe_grant_credits', sessions_total::text, '8'
  from public.student_packages where billing_cycle_key = 'cyc_stripe_1';
insert into _p select 'a1_stripe_pi_recorded', coalesce(stripe_payment_intent_id,'NULL'), 'pi_stripe_1'
  from public.student_packages where billing_cycle_key = 'cyc_stripe_1';

-- ── #2 + #3 PAYPAL branch ───────────────────────────────────────────────────
select public.grant_subscription_cycle(
  p_subscription_id       => 'b0000000-0000-4000-8000-000000000002',
  p_student_id            => '22222222-2222-2222-2222-222222222222',
  p_plan_id               => 'cccccccc-0000-4000-8000-00000000c001',
  p_cycle_key             => 'cyc_paypal_1',
  p_stripe_payment_intent => null,
  p_amount_cents          => 4000,
  p_credit_count          => 8,
  p_expires_at            => now() + interval '35 days',
  p_session_metadata      => '{}'::jsonb,
  p_provider              => 'paypal',
  p_provider_ref          => 'sale_paypal_1'
);
insert into _p select 'a2_paypal_payment',
  provider || '/' || coalesce(paypal_sale_id,'NULL') || '/' || coalesce(stripe_payment_intent,'NULL'),
  'paypal/sale_paypal_1/NULL'
  from public.payments where paypal_sale_id = 'sale_paypal_1';
insert into _p select 'a3_paypal_grant_provider', payment_provider, 'paypal'
  from public.student_packages where billing_cycle_key = 'cyc_paypal_1';
insert into _p select 'a3_paypal_grant_ref', provider_payment_ref, 'sale_paypal_1'
  from public.student_packages where billing_cycle_key = 'cyc_paypal_1';
insert into _p select 'a3_paypal_grant_pi_null', coalesce(stripe_payment_intent_id,'NULL'), 'NULL'
  from public.student_packages where billing_cycle_key = 'cyc_paypal_1';

-- ── #4 + #5 idempotency: repeat BOTH calls verbatim → still one row each ─────
select public.grant_subscription_cycle(
  'a0000000-0000-4000-8000-000000000001','11111111-1111-1111-1111-111111111111',
  'cccccccc-0000-4000-8000-00000000c001','cyc_stripe_1','pi_stripe_1',4000,8,
  now() + interval '35 days','{}'::jsonb);
select public.grant_subscription_cycle(
  'b0000000-0000-4000-8000-000000000002','22222222-2222-2222-2222-222222222222',
  'cccccccc-0000-4000-8000-00000000c001','cyc_paypal_1',null,4000,8,
  now() + interval '35 days','{}'::jsonb,'paypal','sale_paypal_1');
insert into _p select 'a4_stripe_one_grant', count(*)::text, '1'
  from public.student_packages where billing_cycle_key = 'cyc_stripe_1';
insert into _p select 'a5_stripe_one_payment', count(*)::text, '1'
  from public.payments where stripe_payment_intent = 'pi_stripe_1';
insert into _p select 'a4_paypal_one_grant', count(*)::text, '1'
  from public.student_packages where billing_cycle_key = 'cyc_paypal_1';
insert into _p select 'a5_paypal_one_payment', count(*)::text, '1'
  from public.payments where paypal_sale_id = 'sale_paypal_1';

-- NEGATIVE control: a DIFFERENT cycle_key DOES create a second grant (proves the
-- count assertions above discriminate — idempotency isn't just always-1).
select public.grant_subscription_cycle(
  'a0000000-0000-4000-8000-000000000001','11111111-1111-1111-1111-111111111111',
  'cccccccc-0000-4000-8000-00000000c001','cyc_stripe_2','pi_stripe_2',4000,8,
  now() + interval '35 days','{}'::jsonb);
insert into _p select 'neg_distinct_cycle_grants', count(*)::text, '3'
  from public.student_packages
  where billing_cycle_key in ('cyc_stripe_1','cyc_paypal_1','cyc_stripe_2');

-- ── #6 ownership invariant (POSITIVE control: MUST raise 22023) ──────────────
DO $$ BEGIN
  BEGIN
    PERFORM public.grant_subscription_cycle(
      'a0000000-0000-4000-8000-000000000001',  -- subA belongs to studentA
      '22222222-2222-2222-2222-222222222222',  -- ...but studentB is the caller
      'cccccccc-0000-4000-8000-00000000c001','cyc_evil',' pi_evil',4000,8,
      now() + interval '35 days','{}'::jsonb);
    insert into _p values ('a6_ownership_raises', 'no-raise', 'raise');
  EXCEPTION WHEN sqlstate '22023' THEN insert into _p values ('a6_ownership_raises','raise','raise');
  END;
END $$;

-- ── #7 paypal + NULL ref (POSITIVE control: MUST raise, insert nothing) ──────
DO $$ BEGIN
  BEGIN
    PERFORM public.grant_subscription_cycle(
      'b0000000-0000-4000-8000-000000000002','22222222-2222-2222-2222-222222222222',
      'cccccccc-0000-4000-8000-00000000c001','cyc_paypal_bad',null,4000,8,
      now() + interval '35 days','{}'::jsonb,'paypal',null);
    insert into _p values ('a7_paypal_null_ref_raises','no-raise','raise');
  EXCEPTION WHEN sqlstate 'P0001' THEN insert into _p values ('a7_paypal_null_ref_raises','raise','raise');
  END;
END $$;
insert into _p select 'a7_no_orphan_grant', count(*)::text, '0'
  from public.student_packages where billing_cycle_key = 'cyc_paypal_bad';

-- ── Report ──────────────────────────────────────────────────────────────────
select * from _p order by step;
DO $$
DECLARE r record; bad int := 0;
BEGIN
  FOR r IN SELECT * FROM _p LOOP
    IF r.got IS DISTINCT FROM r.want THEN
      RAISE WARNING 'FAIL %  got=%  want=%', r.step, r.got, r.want; bad := bad + 1;
    ELSE RAISE NOTICE 'PASS %  (%)', r.step, r.got; END IF;
  END LOOP;
  IF bad > 0 THEN RAISE EXCEPTION '% assertion(s) FAILED', bad; END IF;
  RAISE NOTICE 'ALL #759 ACCEPTANCE (1-7) + CONTROLS PASSED';
END $$;
ROLLBACK;
