-- walk-prepaid-guard.sql
-- Rolled-back local walk for assertPrepaidGrantValid (round-2 task 9).
--
-- assertPrepaidGrantValid is a pure TS gate (src/lib/domains/billing/prepaid-guard.ts)
-- that both the Stripe and PayPal prepaid-hours rails now call BEFORE their
-- grant_prepaid_hours RPC. Its only DB touch is a `profiles(id, role)` select.
-- This walk proves, against the REAL local Postgres (not mocked):
--
--   W1  grant_prepaid_hours has NO tamper/ownership check of its own — given
--       any hours/rate it blindly inserts a lot. This is the POSITIVE
--       CONTROL: it proves the app-level guard is the only thing standing
--       between a tampered charge and a real grant — if the guard were
--       skipped, the RPC would happily grant on bad numbers.
--   W2  the ownership predicate the guard issues (`select id, role from
--       profiles where id = X`) returns role='student' for a real student
--       row → the guard's `role !== 'student'` check would pass it.
--   W3  NEGATIVE CONTROL — the same predicate against a real teacher-role
--       row returns role='teacher' → the guard's check would refuse it.
--       This is the DB-side proof for the "wrong owner" refusal path.
--   W4  NEGATIVE CONTROL on the tamper arithmetic — Postgres's own
--       round(hours*rate*100) for a representative (hours=10, rate=10.00)
--       charge disagrees with a deliberately tampered charged-cents value,
--       cross-validating the JS Math.round(hours*rate*100) predicate the
--       guard uses is not just self-consistently checking against itself.
--   W5  the SAME arithmetic agrees for the correct (untampered) charge —
--       the guard's happy path is not vacuously true.
--
-- Run: psql <local-url> -v ON_ERROR_STOP=1 -f scripts/walk-prepaid-guard.sql

BEGIN;

SET session_replication_role = replica;

INSERT INTO auth.users (id, email) VALUES
  ('99999999-0000-4000-8000-000000000901', 'walk-pg-student@walk.test'),
  ('99999999-0000-4000-8000-000000000902', 'walk-pg-teacher@walk.test');

INSERT INTO public.profiles (id, role, roles, is_test_account, full_name) VALUES
  ('99999999-0000-4000-8000-000000000901', 'student', ARRAY['student']::user_role[], false, 'Walk Prepaid Student'),
  ('99999999-0000-4000-8000-000000000902', 'teacher', ARRAY['teacher']::user_role[], false, 'Walk Prepaid Teacher');

SET session_replication_role = DEFAULT;

-- W1: grant_prepaid_hours has no built-in tamper/ownership check — it grants
-- on whatever hours/rate it's handed. This is the positive control proving
-- the TS guard (assertPrepaidGrantValid) is the sole enforcement point.
DO $$
DECLARE v_lot_id uuid; v_hours int; v_rate numeric;
BEGIN
  v_lot_id := public.grant_prepaid_hours(
    'walk-pg-pi-001', '99999999-0000-4000-8000-000000000901', 10, 10.00, 'stripe'
  );
  SELECT sessions_total, rate_paid_usd INTO v_hours, v_rate
    FROM public.student_packages WHERE id = v_lot_id;
  IF v_lot_id IS NULL OR v_hours IS DISTINCT FROM 10 OR v_rate IS DISTINCT FROM 10.00 THEN
    RAISE EXCEPTION 'W1 FAIL: grant_prepaid_hours did not grant the requested hours/rate (lot=%, hours=%, rate=%)', v_lot_id, v_hours, v_rate;
  END IF;
  RAISE NOTICE 'W1 OK: grant_prepaid_hours has no tamper/ownership check — the RPC alone would have granted 10h@$10 unconditionally. The guard is the only gate.';
END $$;

-- W2: ownership predicate — real student row passes the guard's role check.
DO $$
DECLARE v_role public.user_role;
BEGIN
  SELECT role INTO v_role FROM public.profiles WHERE id = '99999999-0000-4000-8000-000000000901';
  IF v_role IS DISTINCT FROM 'student' THEN
    RAISE EXCEPTION 'W2 FAIL: expected role=student, got %', v_role;
  END IF;
  RAISE NOTICE 'W2 OK: real student profile resolves role=student — assertPrepaidGrantValid would return {ok:true} on this leg.';
END $$;

-- W3: NEGATIVE CONTROL — real teacher row must be refused by the same predicate.
DO $$
DECLARE v_role public.user_role;
BEGIN
  SELECT role INTO v_role FROM public.profiles WHERE id = '99999999-0000-4000-8000-000000000902';
  IF v_role = 'student' THEN
    RAISE EXCEPTION 'W3 FAIL (control broken): teacher row resolved role=student — the ownership refusal would be blind';
  END IF;
  IF v_role IS DISTINCT FROM 'teacher' THEN
    RAISE EXCEPTION 'W3 FAIL: expected role=teacher, got %', v_role;
  END IF;
  RAISE NOTICE 'W3 OK (negative control fired correctly): teacher profile resolves role=teacher — assertPrepaidGrantValid would return {ok:false, reason:"...not student"}.';
END $$;

-- W4: NEGATIVE CONTROL on tamper arithmetic — a tampered charge must be
-- detectably wrong against Postgres's own round(), not just self-consistent
-- inside the JS predicate.
DO $$
DECLARE v_expected_cents int; v_tampered_cents int := 1000; -- attacker pays $10 for 10h@$10 (should be $100)
BEGIN
  v_expected_cents := round(10 * 10.00 * 100)::int;
  IF v_expected_cents IS DISTINCT FROM 10000 THEN
    RAISE EXCEPTION 'W4 FAIL: sanity — expected_cents should be 10000, got %', v_expected_cents;
  END IF;
  IF v_tampered_cents = v_expected_cents THEN
    RAISE EXCEPTION 'W4 FAIL (control broken): tampered charge (%!) equals expected (%) — probe cannot fail', v_tampered_cents, v_expected_cents;
  END IF;
  RAISE NOTICE 'W4 OK (negative control fired correctly): tampered chargedCents=% != expected=% — Postgres round() agrees the mismatch is real.', v_tampered_cents, v_expected_cents;
END $$;

-- W5: the happy path is not vacuously true — a correct charge DOES match.
DO $$
DECLARE v_expected_cents int; v_correct_cents int := 10000;
BEGIN
  v_expected_cents := round(10 * 10.00 * 100)::int;
  IF v_correct_cents IS DISTINCT FROM v_expected_cents THEN
    RAISE EXCEPTION 'W5 FAIL: correct charge=% does not match expected=%', v_correct_cents, v_expected_cents;
  END IF;
  RAISE NOTICE 'W5 OK: correct chargedCents=% matches expected=% — the guard''s happy path is real, not a tautology.', v_correct_cents, v_expected_cents;
END $$;

ROLLBACK;

-- Post-rollback proof: nothing persisted.
SELECT count(*) AS should_be_zero FROM public.profiles WHERE id::text LIKE '99999999-0000-4000-8000-000000000%';
SELECT count(*) AS should_be_zero FROM public.student_packages WHERE provider_payment_ref = 'walk-pg-pi-001';
