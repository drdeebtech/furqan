-- Rolled-back verification walk for 20260801000000_connect_sweep_functions.sql
-- (spec 040 Phase 1.2 — the transfer-sweep SweepStore SQL surface). Run:
--   psql "$LOCAL_DB_URL" -v ON_ERROR_STOP=1 -f scripts/walk-040-sweep-functions.sql
-- Every assertion RAISEs on failure; the whole walk rolls back (BEGIN…ROLLBACK),
-- so it is safe to re-run and leaves no rows behind.
--
-- Assert the OUTCOME, not the mechanism:
--   * a fence rejection returns boolean false (0 rows), never raises
--   * an ineligible entry stays `pending` (claim skips it), never raises
--   * a constraint backstop (immutable trigger / UNIQUE) RAISEs
-- Asserting the wrong one yields a green test that proves nothing.

BEGIN;

-- Legacy tables (sessions, bookings) default ids with extensions.uuid_generate_v4();
-- psql's default search_path omits `extensions`. Everything below is schema-
-- qualified, so widening the path only affects those defaults.
SET LOCAL search_path = public, extensions;

-- ════════════════════════════════════════════════════════════════════════
-- Seed (all rolled back). 6 teachers, one eligible entry each + 2 hold/cutover
-- negatives for teacher A; clawbacks give A and B outstanding debt.
--   A  stripe rail, payouts_enabled, debt 1000  → FULL consumption
--   B  stripe rail, payouts_enabled, debt  400  → PARTIAL (transfer + recovery)
--   C  stripe rail, payouts_enabled, debt    0  → plain transfer / failure path
--   M  manual rail (no Stripe acct)             → manual_due
--   NP stripe rail, payouts_enabled=FALSE       → NOT claimed
--   H  stripe rail, payouts_enabled, active hold→ NOT claimed
-- ════════════════════════════════════════════════════════════════════════
INSERT INTO auth.users (id, email, instance_id, aud, role) VALUES
  ('00000000-0000-4000-9000-0000000000aa','walk.student@test.local','00000000-0000-0000-0000-000000000000','authenticated','authenticated'),
  ('00000000-0000-4000-9000-000000000a01','walk.a@test.local','00000000-0000-0000-0000-000000000000','authenticated','authenticated'),
  ('00000000-0000-4000-9000-000000000b01','walk.b@test.local','00000000-0000-0000-0000-000000000000','authenticated','authenticated'),
  ('00000000-0000-4000-9000-000000000c01','walk.c@test.local','00000000-0000-0000-0000-000000000000','authenticated','authenticated'),
  ('00000000-0000-4000-9000-000000000d01','walk.m@test.local','00000000-0000-0000-0000-000000000000','authenticated','authenticated'),
  ('00000000-0000-4000-9000-000000000e01','walk.np@test.local','00000000-0000-0000-0000-000000000000','authenticated','authenticated'),
  ('00000000-0000-4000-9000-000000000f01','walk.h@test.local','00000000-0000-0000-0000-000000000000','authenticated','authenticated');

INSERT INTO public.profiles (id, full_name, role, roles) VALUES
  ('00000000-0000-4000-9000-0000000000aa','Walk Student','student', ARRAY['student']::public.user_role[]),
  ('00000000-0000-4000-9000-000000000a01','Walk A','teacher', ARRAY['teacher']::public.user_role[]),
  ('00000000-0000-4000-9000-000000000b01','Walk B','teacher', ARRAY['teacher']::public.user_role[]),
  ('00000000-0000-4000-9000-000000000c01','Walk C','teacher', ARRAY['teacher']::public.user_role[]),
  ('00000000-0000-4000-9000-000000000d01','Walk M','teacher', ARRAY['teacher']::public.user_role[]),
  ('00000000-0000-4000-9000-000000000e01','Walk NP','teacher', ARRAY['teacher']::public.user_role[]),
  ('00000000-0000-4000-9000-000000000f01','Walk H','teacher', ARRAY['teacher']::public.user_role[]);

-- teacher_profiles rows are AUTO-CREATED by a profiles-insert trigger (baseline)
-- with payout_method defaulting to 'stripe_connect'. Only M needs switching to
-- the manual rail. UPDATE OF payout_method fires guard_teacher_profiles_payout_
-- columns; as postgres (NULL jwt = trusted) it is allowed and audit-logged.
UPDATE public.teacher_profiles SET payout_method = 'manual'
  WHERE teacher_id = '00000000-0000-4000-9000-000000000d01';

-- Stripe Connect mirror: A/B/C/H payouts_enabled=true; NP=false; M has no row.
INSERT INTO public.stripe_connect_accounts (teacher_id, stripe_account_id, payouts_enabled) VALUES
  ('00000000-0000-4000-9000-000000000a01','acct_A', true),
  ('00000000-0000-4000-9000-000000000b01','acct_B', true),
  ('00000000-0000-4000-9000-000000000c01','acct_C', true),
  ('00000000-0000-4000-9000-000000000e01','acct_NP', false),
  ('00000000-0000-4000-9000-000000000f01','acct_H', true);

-- Active payout hold for H (blocks the sweep, FR-023). admin source needs created_by.
INSERT INTO public.payout_holds (teacher_id, source, reason, created_by) VALUES
  ('00000000-0000-4000-9000-000000000f01','admin','walk hold','00000000-0000-4000-9000-000000000f01');

-- bookings → sessions → session_deliveries. delivered_at drives the hold/cutover.
INSERT INTO public.bookings (id, student_id, teacher_id, duration_min, rate_snapshot, amount_usd, scheduled_at, status) VALUES
  ('00000000-0000-4000-9000-000000b00001','00000000-0000-4000-9000-0000000000aa','00000000-0000-4000-9000-000000000a01',30,20.00,10.00, now()-interval '14 days', 'confirmed'),
  ('00000000-0000-4000-9000-000000b00002','00000000-0000-4000-9000-0000000000aa','00000000-0000-4000-9000-000000000a01',30,20.00,10.00, now()-interval '13 days', 'confirmed'),
  ('00000000-0000-4000-9000-000000b00003','00000000-0000-4000-9000-0000000000aa','00000000-0000-4000-9000-000000000a01',30,20.00,10.00, timestamptz '2025-12-01 00:00:00+00', 'confirmed'),
  ('00000000-0000-4000-9000-000000b000b1','00000000-0000-4000-9000-0000000000aa','00000000-0000-4000-9000-000000000b01',30,20.00,10.00, now()-interval '20 days', 'confirmed'),
  ('00000000-0000-4000-9000-000000b000c1','00000000-0000-4000-9000-0000000000aa','00000000-0000-4000-9000-000000000c01',30,20.00,10.00, now()-interval '20 days', 'confirmed'),
  ('00000000-0000-4000-9000-000000b000d1','00000000-0000-4000-9000-0000000000aa','00000000-0000-4000-9000-000000000d01',30,20.00,10.00, now()-interval '20 days', 'confirmed'),
  ('00000000-0000-4000-9000-000000b000e1','00000000-0000-4000-9000-0000000000aa','00000000-0000-4000-9000-000000000e01',30,20.00,10.00, now()-interval '20 days', 'confirmed'),
  ('00000000-0000-4000-9000-000000b000f1','00000000-0000-4000-9000-0000000000aa','00000000-0000-4000-9000-000000000f01',30,20.00,10.00, now()-interval '20 days', 'confirmed');

INSERT INTO public.sessions (id, booking_id, room_name, room_url, scheduled_at) VALUES
  ('00000000-0000-4000-9000-000000c00001','00000000-0000-4000-9000-000000b00001','r1','https://w.test/1', now()-interval '14 days'),
  ('00000000-0000-4000-9000-000000c00002','00000000-0000-4000-9000-000000b00002','r2','https://w.test/2', now()-interval '13 days'),
  ('00000000-0000-4000-9000-000000c00003','00000000-0000-4000-9000-000000b00003','r3','https://w.test/3', timestamptz '2025-12-01 00:00:00+00'),
  ('00000000-0000-4000-9000-000000c000b1','00000000-0000-4000-9000-000000b000b1','rb','https://w.test/b', now()-interval '20 days'),
  ('00000000-0000-4000-9000-000000c000c1','00000000-0000-4000-9000-000000b000c1','rc','https://w.test/c', now()-interval '20 days'),
  ('00000000-0000-4000-9000-000000c000d1','00000000-0000-4000-9000-000000b000d1','rd','https://w.test/d', now()-interval '20 days'),
  ('00000000-0000-4000-9000-000000c000e1','00000000-0000-4000-9000-000000b000e1','re','https://w.test/e', now()-interval '20 days'),
  ('00000000-0000-4000-9000-000000c000f1','00000000-0000-4000-9000-000000b000f1','rf','https://w.test/f', now()-interval '20 days');

INSERT INTO public.session_deliveries (id, session_id, teacher_id, duration_minutes, hourly_rate_usd, delivered_at, payroll_period_month) VALUES
  ('00000000-0000-4000-9000-000000d00001','00000000-0000-4000-9000-000000c00001','00000000-0000-4000-9000-000000000a01',30,20.00, now()-interval '14 days 1 minute', date_trunc('month', now())::date),
  ('00000000-0000-4000-9000-000000d00002','00000000-0000-4000-9000-000000c00002','00000000-0000-4000-9000-000000000a01',30,20.00, now()-interval '13 days',           date_trunc('month', now())::date),
  ('00000000-0000-4000-9000-000000d00003','00000000-0000-4000-9000-000000c00003','00000000-0000-4000-9000-000000000a01',30,20.00, timestamptz '2025-12-01 00:00:00+00', '2025-12-01'),
  ('00000000-0000-4000-9000-000000d000b1','00000000-0000-4000-9000-000000c000b1','00000000-0000-4000-9000-000000000b01',30,20.00, now()-interval '20 days',           date_trunc('month', now())::date),
  ('00000000-0000-4000-9000-000000d000c1','00000000-0000-4000-9000-000000c000c1','00000000-0000-4000-9000-000000000c01',30,20.00, now()-interval '20 days',           date_trunc('month', now())::date),
  ('00000000-0000-4000-9000-000000d000d1','00000000-0000-4000-9000-000000c000d1','00000000-0000-4000-9000-000000000d01',30,20.00, now()-interval '20 days',           date_trunc('month', now())::date),
  ('00000000-0000-4000-9000-000000d000e1','00000000-0000-4000-9000-000000c000e1','00000000-0000-4000-9000-000000000e01',30,20.00, now()-interval '20 days',           date_trunc('month', now())::date),
  ('00000000-0000-4000-9000-000000d000f1','00000000-0000-4000-9000-000000c000f1','00000000-0000-4000-9000-000000000f01',30,20.00, now()-interval '20 days',           date_trunc('month', now())::date);

-- Earning entries (kind='session'). Amount 1000 cents each (30 min @ $20/h).
INSERT INTO public.teacher_earning_entries (id, teacher_id, kind, amount_cents, session_delivery_id) VALUES
  ('00000000-0000-4000-9000-0000000000e1','00000000-0000-4000-9000-000000000a01','session',1000,'00000000-0000-4000-9000-000000d00001'), -- E1  eligible (A)
  ('00000000-0000-4000-9000-0000000000e2','00000000-0000-4000-9000-000000000a01','session',1000,'00000000-0000-4000-9000-000000d00002'), -- E2  before hold
  ('00000000-0000-4000-9000-0000000000e3','00000000-0000-4000-9000-000000000a01','session',1000,'00000000-0000-4000-9000-000000d00003'), -- E3  before cutover
  ('00000000-0000-4000-9000-0000000000eb','00000000-0000-4000-9000-000000000b01','session',1000,'00000000-0000-4000-9000-000000d000b1'), -- EB  eligible (B)
  ('00000000-0000-4000-9000-0000000000ec','00000000-0000-4000-9000-000000000c01','session',1000,'00000000-0000-4000-9000-000000d000c1'), -- EC  eligible (C)
  ('00000000-0000-4000-9000-0000000000ed','00000000-0000-4000-9000-000000000d01','session',1000,'00000000-0000-4000-9000-000000d000d1'), -- EM  eligible (M, manual)
  ('00000000-0000-4000-9000-0000000000ee','00000000-0000-4000-9000-000000000e01','session',1000,'00000000-0000-4000-9000-000000d000e1'), -- ENP payouts_enabled=false
  ('00000000-0000-4000-9000-0000000000ef','00000000-0000-4000-9000-000000000f01','session',1000,'00000000-0000-4000-9000-000000d000f1'); -- EH  active hold

-- Clawbacks give A (1000) and B (400) outstanding debt.
INSERT INTO public.teacher_earning_entries (id, teacher_id, kind, amount_cents) VALUES
  ('00000000-0000-4000-9000-00000000cb0a','00000000-0000-4000-9000-000000000a01','clawback',-1000),
  ('00000000-0000-4000-9000-00000000cb0b','00000000-0000-4000-9000-000000000b01','clawback', -400);

-- ════════════════════════════════════════════════════════════════════════
-- [DORMANCY] cutover empty (migration default) ⇒ claim returns ZERO rows even
-- though eligible data exists. THIS is the safety argument for wiring the cron.
-- ════════════════════════════════════════════════════════════════════════
DO $$
DECLARE v int;
BEGIN
  SELECT count(*) INTO v FROM connect_sweep_claim_eligible(now());
  IF v <> 0 THEN RAISE EXCEPTION '[dormancy] cutover unset must claim 0, got %', v; END IF;
END $$;

-- Arm the cutover (sole-writer setter). now-as-postgres bypasses the EXECUTE grant.
DO $$
DECLARE r text;
BEGIN
  r := set_connect_cutover_date('2026-01-01');
  IF r <> 'applied' THEN RAISE EXCEPTION '[arm] expected applied, got %', r; END IF;
END $$;

-- ════════════════════════════════════════════════════════════════════════
-- [CLAIM] the real claim: 4 eligible (E1,EB,EC,EM), 4 negatives skipped.
-- ════════════════════════════════════════════════════════════════════════
CREATE TEMP TABLE claim1 ON COMMIT DROP AS
  SELECT * FROM connect_sweep_claim_eligible(now());

DO $$
DECLARE v int; v_txt text; v_num bigint;
BEGIN
  -- Positives claimed.
  SELECT count(*) INTO v FROM claim1
    WHERE entry_id IN ('00000000-0000-4000-9000-0000000000e1',
                       '00000000-0000-4000-9000-0000000000eb',
                       '00000000-0000-4000-9000-0000000000ec',
                       '00000000-0000-4000-9000-0000000000ed');
  IF v <> 4 THEN RAISE EXCEPTION '[claim] expected 4 eligible claimed, got %', v; END IF;
  -- Exactly those 4 (no negative leaked in).
  SELECT count(*) INTO v FROM claim1;
  IF v <> 4 THEN RAISE EXCEPTION '[claim] expected total 4 rows, got %', v; END IF;

  -- Negatives untouched (still pending).
  IF (SELECT status FROM teacher_earning_entries WHERE id='00000000-0000-4000-9000-0000000000e2') <> 'pending'
    THEN RAISE EXCEPTION '[claim-neg] E2 (before hold) must stay pending'; END IF;
  IF (SELECT status FROM teacher_earning_entries WHERE id='00000000-0000-4000-9000-0000000000e3') <> 'pending'
    THEN RAISE EXCEPTION '[claim-neg] E3 (before cutover) must stay pending'; END IF;
  IF (SELECT status FROM teacher_earning_entries WHERE id='00000000-0000-4000-9000-0000000000ee') <> 'pending'
    THEN RAISE EXCEPTION '[claim-neg] ENP (payouts_enabled=false) must stay pending'; END IF;
  IF (SELECT status FROM teacher_earning_entries WHERE id='00000000-0000-4000-9000-0000000000ef') <> 'pending'
    THEN RAISE EXCEPTION '[claim-neg] EH (active hold) must stay pending'; END IF;

  -- Positives now processing + leased.
  IF (SELECT status FROM teacher_earning_entries WHERE id='00000000-0000-4000-9000-0000000000e1') <> 'processing'
    THEN RAISE EXCEPTION '[claim] E1 must be processing'; END IF;

  -- Claim-time snapshot on E1 (teacher A): debt 1000, stripe rail, dest, usd.
  SELECT payout_method INTO v_txt FROM claim1 WHERE entry_id='00000000-0000-4000-9000-0000000000e1';
  IF v_txt <> 'stripe_connect' THEN RAISE EXCEPTION '[claim] E1 payout_method %', v_txt; END IF;
  SELECT destination_account_id INTO v_txt FROM claim1 WHERE entry_id='00000000-0000-4000-9000-0000000000e1';
  IF v_txt <> 'acct_A' THEN RAISE EXCEPTION '[claim] E1 destination %', v_txt; END IF;
  SELECT currency INTO v_txt FROM claim1 WHERE entry_id='00000000-0000-4000-9000-0000000000e1';
  IF v_txt <> 'usd' THEN RAISE EXCEPTION '[claim] E1 currency %', v_txt; END IF;
  SELECT outstanding_debt_cents INTO v_num FROM claim1 WHERE entry_id='00000000-0000-4000-9000-0000000000e1';
  IF v_num <> 1000 THEN RAISE EXCEPTION '[claim] E1 debt snapshot expected 1000, got %', v_num; END IF;

  -- Manual rail snapshot on EM: manual, no destination.
  SELECT payout_method INTO v_txt FROM claim1 WHERE entry_id='00000000-0000-4000-9000-0000000000ed';
  IF v_txt <> 'manual' THEN RAISE EXCEPTION '[claim] EM payout_method %', v_txt; END IF;
  SELECT destination_account_id INTO v_txt FROM claim1 WHERE entry_id='00000000-0000-4000-9000-0000000000ed';
  IF v_txt IS NOT NULL THEN RAISE EXCEPTION '[claim] EM destination should be NULL, got %', v_txt; END IF;
END $$;

-- ════════════════════════════════════════════════════════════════════════
-- [LEASE-ONCE] a second claim in the same state claims nothing (all processing).
-- ════════════════════════════════════════════════════════════════════════
DO $$
DECLARE v int;
BEGIN
  SELECT count(*) INTO v FROM connect_sweep_claim_eligible(now());
  IF v <> 0 THEN RAISE EXCEPTION '[lease-once] second claim must return 0, got %', v; END IF;
END $$;

-- ════════════════════════════════════════════════════════════════════════
-- [FENCE] a settlement with the WRONG lease returns false and touches nothing;
-- with the right lease it returns true. (now() = the claim's lease token.)
-- ════════════════════════════════════════════════════════════════════════
DO $$
DECLARE ok boolean; v_status text;
BEGIN
  -- Wrong lease on EC.
  ok := connect_sweep_record_transfer_failed('00000000-0000-4000-9000-0000000000ec', now() - interval '1 second');
  IF ok THEN RAISE EXCEPTION '[fence] wrong lease must return false'; END IF;
  SELECT status INTO v_status FROM teacher_earning_entries WHERE id='00000000-0000-4000-9000-0000000000ec';
  IF v_status <> 'processing' THEN RAISE EXCEPTION '[fence] EC must stay processing after a rejected fence, got %', v_status; END IF;
END $$;

-- ════════════════════════════════════════════════════════════════════════
-- [FULL CONSUMPTION] E1 (A, debt 1000, earning 1000) → debt_recovered, a
-- debt_recovery row, and NO transfer row. A's debt nets to 0.
-- ════════════════════════════════════════════════════════════════════════
DO $$
DECLARE ok boolean; v int; v_debt bigint;
BEGIN
  ok := connect_sweep_record_debt_recovered('00000000-0000-4000-9000-0000000000e1',
          '00000000-0000-4000-9000-000000000a01', 1000, now());
  IF NOT ok THEN RAISE EXCEPTION '[full] recordDebtRecovered should return true'; END IF;

  IF (SELECT status FROM teacher_earning_entries WHERE id='00000000-0000-4000-9000-0000000000e1') <> 'debt_recovered'
    THEN RAISE EXCEPTION '[full] E1 should be debt_recovered'; END IF;

  SELECT count(*) INTO v FROM teacher_earning_entries
    WHERE kind='debt_recovery' AND consuming_entry_id='00000000-0000-4000-9000-0000000000e1' AND amount_cents=1000;
  IF v <> 1 THEN RAISE EXCEPTION '[full] expected 1 debt_recovery row for E1, got %', v; END IF;

  SELECT count(*) INTO v FROM teacher_transfers WHERE entry_id='00000000-0000-4000-9000-0000000000e1';
  IF v <> 0 THEN RAISE EXCEPTION '[full] full consumption must write NO transfer row, got %', v; END IF;

  -- A's outstanding debt now nets to 0 (clawback -1000 + recovery +1000).
  SELECT GREATEST(0, -1 * COALESCE(SUM(amount_cents),0)) INTO v_debt FROM teacher_earning_entries
    WHERE teacher_id='00000000-0000-4000-9000-000000000a01'
      AND kind IN ('clawback','debt_recovery','debt_recovery_reversal');
  IF v_debt <> 0 THEN RAISE EXCEPTION '[full] A debt should net to 0, got %', v_debt; END IF;
END $$;

-- ════════════════════════════════════════════════════════════════════════
-- [PARTIAL] EB (B, debt 400, earning 1000) → transfer 600 + recovery 400 both
-- present, entry transferred.
-- ════════════════════════════════════════════════════════════════════════
DO $$
DECLARE ok boolean; v int;
BEGIN
  ok := connect_sweep_record_transfer_succeeded('00000000-0000-4000-9000-0000000000eb',
          '00000000-0000-4000-9000-000000000b01','tr_B', 600, 400, 'tg_B', 'transfer:eb', now());
  IF NOT ok THEN RAISE EXCEPTION '[partial] recordTransferSucceeded should return true'; END IF;

  IF (SELECT status FROM teacher_earning_entries WHERE id='00000000-0000-4000-9000-0000000000eb') <> 'transferred'
    THEN RAISE EXCEPTION '[partial] EB should be transferred'; END IF;

  SELECT count(*) INTO v FROM teacher_transfers
    WHERE entry_id='00000000-0000-4000-9000-0000000000eb' AND kind='transfer' AND amount_cents=600 AND status='succeeded';
  IF v <> 1 THEN RAISE EXCEPTION '[partial] expected 1 transfer row (600), got %', v; END IF;

  SELECT count(*) INTO v FROM teacher_earning_entries
    WHERE kind='debt_recovery' AND consuming_entry_id='00000000-0000-4000-9000-0000000000eb' AND amount_cents=400;
  IF v <> 1 THEN RAISE EXCEPTION '[partial] expected 1 debt_recovery row (400), got %', v; END IF;
END $$;

-- ════════════════════════════════════════════════════════════════════════
-- [FAILURE] EC (C, debt 0) → recordTransferFailed flips to pending, clears the
-- lease, and writes NOTHING (no transfer, no recovery) — balance re-derives.
-- ════════════════════════════════════════════════════════════════════════
DO $$
DECLARE ok boolean; v int; v_claim timestamptz;
BEGIN
  ok := connect_sweep_record_transfer_failed('00000000-0000-4000-9000-0000000000ec', now());
  IF NOT ok THEN RAISE EXCEPTION '[fail] recordTransferFailed should return true'; END IF;

  IF (SELECT status FROM teacher_earning_entries WHERE id='00000000-0000-4000-9000-0000000000ec') <> 'pending'
    THEN RAISE EXCEPTION '[fail] EC should be back to pending'; END IF;
  SELECT claimed_at INTO v_claim FROM teacher_earning_entries WHERE id='00000000-0000-4000-9000-0000000000ec';
  IF v_claim IS NOT NULL THEN RAISE EXCEPTION '[fail] EC lease should be cleared'; END IF;

  SELECT count(*) INTO v FROM teacher_transfers WHERE entry_id='00000000-0000-4000-9000-0000000000ec';
  IF v <> 0 THEN RAISE EXCEPTION '[fail] failure path must write NO transfer row, got %', v; END IF;
  SELECT count(*) INTO v FROM teacher_earning_entries
    WHERE kind='debt_recovery' AND consuming_entry_id='00000000-0000-4000-9000-0000000000ec';
  IF v <> 0 THEN RAISE EXCEPTION '[fail] failure path must write NO debt_recovery row, got %', v; END IF;
END $$;

-- ════════════════════════════════════════════════════════════════════════
-- [MANUAL] EM (M, manual rail, debt 0) → manual_due, no Stripe dependency,
-- recovered 0 ⇒ no debt_recovery row.
-- ════════════════════════════════════════════════════════════════════════
DO $$
DECLARE ok boolean; v int;
BEGIN
  ok := connect_sweep_record_manual_due('00000000-0000-4000-9000-0000000000ed',
          '00000000-0000-4000-9000-000000000d01', 0, now());
  IF NOT ok THEN RAISE EXCEPTION '[manual] recordManualDue should return true'; END IF;

  IF (SELECT status FROM teacher_earning_entries WHERE id='00000000-0000-4000-9000-0000000000ed') <> 'manual_due'
    THEN RAISE EXCEPTION '[manual] EM should be manual_due'; END IF;
  SELECT count(*) INTO v FROM teacher_earning_entries
    WHERE kind='debt_recovery' AND consuming_entry_id='00000000-0000-4000-9000-0000000000ed';
  IF v <> 0 THEN RAISE EXCEPTION '[manual] recovered=0 must write NO debt_recovery row, got %', v; END IF;
END $$;

-- ════════════════════════════════════════════════════════════════════════
-- [IDEMPOTENCY] teacher_transfers UNIQUE(entry_id) WHERE kind='transfer' blocks
-- a duplicate transfer row for EB (distinct idempotency_key, so it is the ENTRY
-- unique that fires, not the key unique).
-- ════════════════════════════════════════════════════════════════════════
DO $$
BEGIN
  BEGIN
    INSERT INTO teacher_transfers (entry_id, teacher_id, kind, amount_cents, idempotency_key)
    VALUES ('00000000-0000-4000-9000-0000000000eb','00000000-0000-4000-9000-000000000b01','transfer',600,'transfer:eb-dup');
    RAISE EXCEPTION '[idem] duplicate transfer row was NOT blocked';
  EXCEPTION WHEN unique_violation THEN
    NULL; -- expected: one transfer per entry
  END;
END $$;

-- ════════════════════════════════════════════════════════════════════════
-- [IMMUTABLE TRIGGER UNCHANGED] our status flips satisfy the immutable-
-- financials trigger, but an amount_cents change still RAISEs — proving we did
-- NOT weaken guard_earning_entries_financials.
-- ════════════════════════════════════════════════════════════════════════
DO $$
DECLARE v_blocked boolean := false;
BEGIN
  BEGIN
    UPDATE teacher_earning_entries SET amount_cents = 999 WHERE id='00000000-0000-4000-9000-0000000000eb';
  EXCEPTION WHEN others THEN
    v_blocked := true; -- the trigger raised (P0001) — expected
  END;
  IF NOT v_blocked THEN RAISE EXCEPTION '[immutable] amount_cents change was NOT blocked'; END IF;
END $$;

-- ════════════════════════════════════════════════════════════════════════
-- [RECLAIM] an expired-lease processing row returns to pending. Put EC back to
-- processing with a stale lease, then reclaim with a 15-min cutoff.
-- ════════════════════════════════════════════════════════════════════════
DO $$
DECLARE n int;
BEGIN
  UPDATE teacher_earning_entries
     SET status='processing', claimed_at = now() - interval '1 hour'
   WHERE id='00000000-0000-4000-9000-0000000000ec';

  n := connect_sweep_reclaim_expired_leases(now() - interval '15 minutes');
  IF n < 1 THEN RAISE EXCEPTION '[reclaim] expected >=1 reclaimed, got %', n; END IF;
  IF (SELECT status FROM teacher_earning_entries WHERE id='00000000-0000-4000-9000-0000000000ec') <> 'pending'
    THEN RAISE EXCEPTION '[reclaim] EC should be pending after reclaim'; END IF;
  IF (SELECT claimed_at FROM teacher_earning_entries WHERE id='00000000-0000-4000-9000-0000000000ec') IS NOT NULL
    THEN RAISE EXCEPTION '[reclaim] EC lease should be cleared'; END IF;
END $$;

\echo '════════════════════════════════════════════════════════════'
\echo 'walk-040-sweep-functions: ALL ASSERTIONS PASSED'
\echo '════════════════════════════════════════════════════════════'

ROLLBACK;
