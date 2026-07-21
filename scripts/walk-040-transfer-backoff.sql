-- Rolled-back verification walk for FR-011 (capped backoff + terminal state)
-- in 20260812000000_connect_transfer_backoff.sql. Run:
--   psql "$LOCAL_DB_URL" -v ON_ERROR_STOP=1 -f scripts/walk-040-transfer-backoff.sql
-- Every assertion RAISEs on failure; the whole walk rolls back (BEGIN…ROLLBACK).
--
-- Proves:
--  [1] a failed transfer records the error ON the entry, increments the
--      attempt counter, returns it to pending with next_attempt_at ≈ +15 min;
--  [2] the claim SKIPS the entry while its backoff is pending, and claims it
--      again once the delay has elapsed;
--  [3] the delay doubles per failure and is capped at 24 h;
--  [4] the 8th failure parks the entry TERMINAL-LOUD: held/transfer_failed,
--      no next_attempt_at, unclaimable at any future time;
--  [5] the audited admin requeue resets the counters and makes it claimable;
--      a replay returns not_found;
--  [6] the failure write is lease-fenced (wrong claimed_at ⇒ false, no change);
--  [6b] the 2-arg deploy-window wrapper is GONE (contract phase, 20260816);
--  [7] lockdown on the surviving 3-arg function + the requeue.
--
-- ids are hex-only (uuid): teacher S uses 'f' tokens ('walk failure').

BEGIN;
SET LOCAL search_path = public, extensions;

-- ════════════════════════════════════════════════════════════════════════
-- Seed: teacher S on the STRIPE rail with payouts_enabled, one delivery,
-- one pending entry. Cutover armed inside the rolled-back txn.
-- ════════════════════════════════════════════════════════════════════════
INSERT INTO auth.users (id, email, instance_id, aud, role) VALUES
  ('00000000-0000-4000-9000-0000000000af','walkfail.student@test.local','00000000-0000-0000-0000-000000000000','authenticated','authenticated'),
  ('00000000-0000-4000-9000-0000000000a9','walkfail.admin@test.local','00000000-0000-0000-0000-000000000000','authenticated','authenticated'),
  ('00000000-0000-4000-9000-000000000f01','walkfail.s@test.local','00000000-0000-0000-0000-000000000000','authenticated','authenticated');

INSERT INTO public.profiles (id, full_name, role, roles) VALUES
  ('00000000-0000-4000-9000-0000000000af','WalkFail Student','student', ARRAY['student']::public.user_role[]),
  ('00000000-0000-4000-9000-0000000000a9','WalkFail Admin','admin', ARRAY['admin']::public.user_role[]),
  ('00000000-0000-4000-9000-000000000f01','WalkFail S','teacher', ARRAY['teacher']::public.user_role[]);

INSERT INTO public.stripe_connect_accounts
  (teacher_id, stripe_account_id, charges_enabled, payouts_enabled, details_submitted)
VALUES ('00000000-0000-4000-9000-000000000f01', 'acct_walkfail1', true, true, true);

INSERT INTO public.bookings (id, student_id, teacher_id, duration_min, rate_snapshot, amount_usd, scheduled_at, status) VALUES
  ('00000000-0000-4000-9000-000000b000f1','00000000-0000-4000-9000-0000000000af','00000000-0000-4000-9000-000000000f01',30,20.00,10.00, now()-interval '20 days', 'confirmed');
INSERT INTO public.sessions (id, booking_id, room_name, room_url, scheduled_at) VALUES
  ('00000000-0000-4000-9000-000000c000f1','00000000-0000-4000-9000-000000b000f1','rf1','https://w.test/f1', now()-interval '20 days');
INSERT INTO public.session_deliveries (id, session_id, teacher_id, duration_minutes, hourly_rate_usd, delivered_at, payroll_period_month) VALUES
  ('00000000-0000-4000-9000-000000d000f1','00000000-0000-4000-9000-000000c000f1','00000000-0000-4000-9000-000000000f01',30,20.00, now()-interval '20 days', date_trunc('month', now())::date);

INSERT INTO public.teacher_earning_entries (id, teacher_id, kind, amount_cents, session_delivery_id, status) VALUES
  ('00000000-0000-4000-9000-0000000000f1','00000000-0000-4000-9000-000000000f01','session',1000,'00000000-0000-4000-9000-000000d000f1','pending');

-- Arm the cutover via the sole-writer escape hatch (txn-local, rolled back).
DO $$
BEGIN
  PERFORM set_config('app.connect_cutover_writer', 'on', true);
  UPDATE platform_settings
     SET value = to_char(now() - interval '30 days', 'YYYY-MM-DD')
   WHERE key = 'connect_cutover_date';
  IF NOT FOUND THEN RAISE EXCEPTION '[arm] connect_cutover_date setting row missing'; END IF;
END $$;

-- ════════════════════════════════════════════════════════════════════════
-- [1] First failure: error recorded, attempt_count 1, pending, +15 min gate.
-- ════════════════════════════════════════════════════════════════════════
DO $$
DECLARE v_claimed timestamptz; ok boolean; e record;
BEGIN
  SELECT c.claimed_at INTO v_claimed FROM connect_sweep_claim_eligible(now()) c
   WHERE c.entry_id = '00000000-0000-4000-9000-0000000000f1';
  IF v_claimed IS NULL THEN RAISE EXCEPTION '[1] entry must be claimable'; END IF;

  ok := connect_sweep_record_transfer_failed(
          '00000000-0000-4000-9000-0000000000f1', v_claimed, 'stripe: balance_insufficient');
  IF NOT ok THEN RAISE EXCEPTION '[1] fenced failure write must hit'; END IF;

  SELECT * INTO e FROM teacher_earning_entries WHERE id='00000000-0000-4000-9000-0000000000f1';
  IF e.status <> 'pending' THEN RAISE EXCEPTION '[1] status must be pending, got %', e.status; END IF;
  IF e.attempt_count <> 1 THEN RAISE EXCEPTION '[1] attempt_count must be 1, got %', e.attempt_count; END IF;
  IF e.last_error_detail <> 'stripe: balance_insufficient' THEN RAISE EXCEPTION '[1] error must be recorded, got %', e.last_error_detail; END IF;
  IF e.claimed_at IS NOT NULL THEN RAISE EXCEPTION '[1] lease must be cleared'; END IF;
  -- now() is txn-frozen, so the schedule is EXACT: attempt 1 ⇒ +15 min.
  IF e.next_attempt_at IS DISTINCT FROM now() + interval '15 minutes' THEN
    RAISE EXCEPTION '[1] next_attempt_at must be exactly now+15min, got %', e.next_attempt_at;
  END IF;
END $$;

-- ════════════════════════════════════════════════════════════════════════
-- [2] Backoff gate: unclaimable now; claimable once the delay elapses.
-- ════════════════════════════════════════════════════════════════════════
DO $$
DECLARE n int; v_claimed timestamptz; ok boolean;
BEGIN
  SELECT count(*) INTO n FROM connect_sweep_claim_eligible(now()) c
   WHERE c.entry_id = '00000000-0000-4000-9000-0000000000f1';
  IF n <> 0 THEN RAISE EXCEPTION '[2] entry mid-backoff must NOT be claimable'; END IF;

  -- 16 minutes later the gate opens; fail again (attempt 2 → +30 min).
  SELECT c.claimed_at INTO v_claimed
    FROM connect_sweep_claim_eligible(now() + interval '16 minutes') c
   WHERE c.entry_id = '00000000-0000-4000-9000-0000000000f1';
  IF v_claimed IS NULL THEN RAISE EXCEPTION '[2] entry must be claimable after the delay'; END IF;
  ok := connect_sweep_record_transfer_failed(
          '00000000-0000-4000-9000-0000000000f1', v_claimed, 'stripe: still failing');
  IF NOT ok THEN RAISE EXCEPTION '[2] second failure write must hit'; END IF;
END $$;

-- ════════════════════════════════════════════════════════════════════════
-- [3] Exponential schedule: after attempt 2 the delay is ~30 min; loop the
--     failures out to attempt 7 and assert the 24 h cap is respected.
-- ════════════════════════════════════════════════════════════════════════
DO $$
DECLARE e record; v_claimed timestamptz; ok boolean; i int; v_expected interval;
BEGIN
  SELECT * INTO e FROM teacher_earning_entries WHERE id='00000000-0000-4000-9000-0000000000f1';
  IF e.attempt_count <> 2 THEN RAISE EXCEPTION '[3] attempt_count must be 2, got %', e.attempt_count; END IF;
  IF e.next_attempt_at IS DISTINCT FROM now() + interval '30 minutes' THEN
    RAISE EXCEPTION '[3] second delay must be exactly 30min, got %', e.next_attempt_at;
  END IF;

  -- Attempts 3..7: claim far in the future (always past any backoff), fail,
  -- and assert the EXACT doubled delay after every failure: 60, 120, 240,
  -- 480, 960 minutes (now() is txn-frozen, so equality is deterministic).
  FOR i IN 3..7 LOOP
    SELECT c.claimed_at INTO v_claimed
      FROM connect_sweep_claim_eligible(now() + (i || ' days')::interval) c
     WHERE c.entry_id = '00000000-0000-4000-9000-0000000000f1';
    IF v_claimed IS NULL THEN RAISE EXCEPTION '[3] attempt % claim failed', i; END IF;
    ok := connect_sweep_record_transfer_failed(
            '00000000-0000-4000-9000-0000000000f1', v_claimed, 'stripe: attempt ' || i);
    IF NOT ok THEN RAISE EXCEPTION '[3] attempt % failure write must hit', i; END IF;

    v_expected := make_interval(mins => LEAST(15 * (2 ^ (i - 1))::integer, 1440));
    SELECT * INTO e FROM teacher_earning_entries WHERE id='00000000-0000-4000-9000-0000000000f1';
    IF e.attempt_count <> i THEN RAISE EXCEPTION '[3] attempt_count must be %, got %', i, e.attempt_count; END IF;
    IF e.next_attempt_at IS DISTINCT FROM now() + v_expected THEN
      RAISE EXCEPTION '[3] delay after attempt % must be exactly % (got %)', i, v_expected, e.next_attempt_at;
    END IF;
  END LOOP;

  SELECT * INTO e FROM teacher_earning_entries WHERE id='00000000-0000-4000-9000-0000000000f1';
  IF e.status <> 'pending' THEN RAISE EXCEPTION '[3] must still be pending at attempt 7'; END IF;
  -- Note: at MAX_ATTEMPTS=8 the largest scheduled delay is 15·2^6 = 960 min,
  -- so the 1440-min cap is a guard for future constant changes, not a state
  -- reachable today — the exact-schedule assertions above are the real proof.
END $$;

-- ════════════════════════════════════════════════════════════════════════
-- [4] 8th failure ⇒ TERMINAL: held/transfer_failed, unclaimable forever.
-- ════════════════════════════════════════════════════════════════════════
DO $$
DECLARE e record; v_claimed timestamptz; ok boolean; n int;
BEGIN
  SELECT c.claimed_at INTO v_claimed
    FROM connect_sweep_claim_eligible(now() + interval '30 days') c
   WHERE c.entry_id = '00000000-0000-4000-9000-0000000000f1';
  IF v_claimed IS NULL THEN RAISE EXCEPTION '[4] attempt 8 claim failed'; END IF;
  ok := connect_sweep_record_transfer_failed(
          '00000000-0000-4000-9000-0000000000f1', v_claimed, 'stripe: final failure');
  IF NOT ok THEN RAISE EXCEPTION '[4] final failure write must hit'; END IF;

  SELECT * INTO e FROM teacher_earning_entries WHERE id='00000000-0000-4000-9000-0000000000f1';
  IF e.status <> 'held' THEN RAISE EXCEPTION '[4] status must be held, got %', e.status; END IF;
  IF e.hold_reason <> 'transfer_failed' THEN RAISE EXCEPTION '[4] hold_reason must be transfer_failed, got %', e.hold_reason; END IF;
  IF e.attempt_count <> 8 THEN RAISE EXCEPTION '[4] attempt_count must be 8, got %', e.attempt_count; END IF;
  IF e.next_attempt_at IS NOT NULL THEN RAISE EXCEPTION '[4] terminal entry must have no next_attempt_at'; END IF;
  IF e.last_error_detail <> 'stripe: final failure' THEN RAISE EXCEPTION '[4] last error must be recorded'; END IF;

  SELECT count(*) INTO n FROM connect_sweep_claim_eligible(now() + interval '365 days') c
   WHERE c.entry_id = '00000000-0000-4000-9000-0000000000f1';
  IF n <> 0 THEN RAISE EXCEPTION '[4] a terminal-failed entry must NEVER be claimed'; END IF;

  -- Visible in the ops snapshot's failed_entries queue.
  IF NOT EXISTS (
    SELECT 1 FROM jsonb_array_elements(connect_admin_payouts_overview()->'failed_entries') fe
     WHERE fe->>'entry_id' = '00000000-0000-4000-9000-0000000000f1'
       AND (fe->>'attempt_count')::int = 8
  ) THEN
    RAISE EXCEPTION '[4] terminal entry must appear in the overview failed_entries queue';
  END IF;
END $$;

-- ════════════════════════════════════════════════════════════════════════
-- [5] Audited admin requeue: counters reset, claimable again; replay no-op.
-- ════════════════════════════════════════════════════════════════════════
DO $$
DECLARE r text; e record; n int;
BEGIN
  r := connect_admin_requeue_failed_entry(
         '00000000-0000-4000-9000-0000000000f1',
         '00000000-0000-4000-9000-0000000000a9');
  IF r <> 'requeued' THEN RAISE EXCEPTION '[5] requeue must succeed, got %', r; END IF;

  SELECT * INTO e FROM teacher_earning_entries WHERE id='00000000-0000-4000-9000-0000000000f1';
  IF e.status <> 'pending' OR e.hold_reason IS NOT NULL
     OR e.attempt_count <> 0 OR e.next_attempt_at IS NOT NULL THEN
    RAISE EXCEPTION '[5] requeue must fully reset the retry state';
  END IF;

  SELECT count(*) INTO n FROM connect_sweep_claim_eligible(now()) c
   WHERE c.entry_id = '00000000-0000-4000-9000-0000000000f1';
  IF n <> 1 THEN RAISE EXCEPTION '[5] requeued entry must be claimable'; END IF;
  -- Return the lease so later state stays clean.
  UPDATE teacher_earning_entries SET status='pending', claimed_at=NULL
   WHERE id='00000000-0000-4000-9000-0000000000f1';

  IF NOT EXISTS (
    SELECT 1 FROM connect_payout_audit
     WHERE event = 'transfer_failed_requeue'
       AND actor = '00000000-0000-4000-9000-0000000000a9'
       AND subject_teacher_id = '00000000-0000-4000-9000-000000000f01'
  ) THEN
    RAISE EXCEPTION '[5] requeue must write an audit row';
  END IF;

  r := connect_admin_requeue_failed_entry(
         '00000000-0000-4000-9000-0000000000f1',
         '00000000-0000-4000-9000-0000000000a9');
  IF r <> 'not_found' THEN RAISE EXCEPTION '[5] replay must be not_found, got %', r; END IF;
END $$;

-- ════════════════════════════════════════════════════════════════════════
-- [6] Lease fence: a failure write with the wrong claimed_at is a no-op.
-- ════════════════════════════════════════════════════════════════════════
DO $$
DECLARE v_claimed timestamptz; ok boolean; e record;
BEGIN
  SELECT c.claimed_at INTO v_claimed FROM connect_sweep_claim_eligible(now()) c
   WHERE c.entry_id = '00000000-0000-4000-9000-0000000000f1';
  IF v_claimed IS NULL THEN RAISE EXCEPTION '[6] entry must be claimable'; END IF;

  ok := connect_sweep_record_transfer_failed(
          '00000000-0000-4000-9000-0000000000f1',
          v_claimed - interval '1 second',   -- a stolen/stale lease
          'stale-lease write');
  IF ok THEN RAISE EXCEPTION '[6] wrong lease must be refused'; END IF;

  SELECT * INTO e FROM teacher_earning_entries WHERE id='00000000-0000-4000-9000-0000000000f1';
  IF e.status <> 'processing' THEN RAISE EXCEPTION '[6] entry must remain processing (leased)'; END IF;
  IF e.attempt_count <> 0 THEN RAISE EXCEPTION '[6] refused write must not count an attempt'; END IF;
  IF e.last_error_detail = 'stale-lease write' THEN RAISE EXCEPTION '[6] refused write must not record its error'; END IF;
END $$;

-- ════════════════════════════════════════════════════════════════════════
-- [6b] Contract phase (20260816000000): the 2-arg deploy-window wrapper is
--      GONE, and only it — the 3-arg form must survive. to_regprocedure
--      returns NULL for a missing function instead of RAISEing, so absence is
--      assertable without aborting the walk.
-- ════════════════════════════════════════════════════════════════════════
DO $$
BEGIN
  IF to_regprocedure('connect_sweep_record_transfer_failed(uuid, timestamptz)') IS NOT NULL THEN
    RAISE EXCEPTION '[6b] the legacy 2-arg wrapper must have been dropped (contract phase)';
  END IF;
  IF to_regprocedure('connect_sweep_record_transfer_failed(uuid, timestamptz, text)') IS NULL THEN
    RAISE EXCEPTION '[6b] the 3-arg record_transfer_failed must still exist';
  END IF;
END $$;

-- ════════════════════════════════════════════════════════════════════════
-- [7] Lockdown (the surviving 3-arg signature + the requeue).
-- ════════════════════════════════════════════════════════════════════════
DO $$
BEGIN
  IF has_function_privilege('anon', 'connect_sweep_record_transfer_failed(uuid, timestamptz, text)', 'EXECUTE')
  OR has_function_privilege('authenticated', 'connect_sweep_record_transfer_failed(uuid, timestamptz, text)', 'EXECUTE') THEN
    RAISE EXCEPTION '[lockdown] record_transfer_failed must not be client-executable';
  END IF;
  IF NOT has_function_privilege('service_role', 'connect_sweep_record_transfer_failed(uuid, timestamptz, text)', 'EXECUTE') THEN
    RAISE EXCEPTION '[lockdown] service_role MUST have EXECUTE on record_transfer_failed';
  END IF;
  IF has_function_privilege('anon', 'connect_admin_requeue_failed_entry(uuid, uuid)', 'EXECUTE')
  OR has_function_privilege('authenticated', 'connect_admin_requeue_failed_entry(uuid, uuid)', 'EXECUTE') THEN
    RAISE EXCEPTION '[lockdown] requeue must not be client-executable';
  END IF;
  IF NOT has_function_privilege('service_role', 'connect_admin_requeue_failed_entry(uuid, uuid)', 'EXECUTE') THEN
    RAISE EXCEPTION '[lockdown] service_role MUST have EXECUTE on requeue';
  END IF;
END $$;

\echo '════════════════════════════════════════════════════════════════'
\echo '  walk-040-transfer-backoff: ALL ASSERTIONS PASSED'
\echo '════════════════════════════════════════════════════════════════'

ROLLBACK;
