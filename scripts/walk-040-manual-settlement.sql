-- Rolled-back verification walk for connect_settle_manual_due (4-arg,
-- 20260811000000_connect_manual_net_settlement.sql — spec 040 FR-027/FR-027a).
-- Debt-netting scenarios live in scripts/walk-040-manual-net-settlement.sql;
-- THIS walk proves the base settlement contract with no debt in play. Run:
--   psql "$LOCAL_DB_URL" -v ON_ERROR_STOP=1 -f scripts/walk-040-manual-settlement.sql
-- Every assertion RAISEs on failure; the whole walk rolls back (BEGIN…ROLLBACK),
-- so it is safe to re-run and leaves no rows behind.
--
-- Assert the OUTCOME, not the mechanism:
--   * a settle on a manual_due + payout_method='manual' row with the correct
--     expected net → outcome='settled', all three settlement columns set
--     atomically with status='manual_paid'
--   * a replay / wrong-status / stripe_connect entry → outcome='not_found',
--     the row is UNCHANGED, never raises
--   * a blank reference (net>0) and a pasted-twice reference → RAISE (caller
--     breach / UNIQUE backstop), caught in a savepoint sub-block
--
-- ids are hex-only (uuid): teacher M uses 'd' tokens, teacher C uses 'c'.

BEGIN;
SET LOCAL search_path = public, extensions;

-- ════════════════════════════════════════════════════════════════════════
-- Seed (rolled back). 2 teachers + 1 admin; teacher_profiles auto-created by
-- the profiles-insert trigger (payout_method defaults 'stripe_connect').
--   M  manual rail  → its manual_due entries are settle-able
--   C  stripe rail  → its manual_due entry must be REFUSED by the payout guard
-- ════════════════════════════════════════════════════════════════════════
INSERT INTO auth.users (id, email, instance_id, aud, role) VALUES
  ('00000000-0000-4000-9000-0000000000aa','walk.student@test.local','00000000-0000-0000-0000-000000000000','authenticated','authenticated'),
  ('00000000-0000-4000-9000-0000000000ad','walk.admin@test.local','00000000-0000-0000-0000-000000000000','authenticated','authenticated'),
  ('00000000-0000-4000-9000-000000000d01','walk.m@test.local','00000000-0000-0000-0000-000000000000','authenticated','authenticated'),
  ('00000000-0000-4000-9000-000000000c01','walk.c@test.local','00000000-0000-0000-0000-000000000000','authenticated','authenticated');

INSERT INTO public.profiles (id, full_name, role, roles) VALUES
  ('00000000-0000-4000-9000-0000000000aa','Walk Student','student', ARRAY['student']::public.user_role[]),
  ('00000000-0000-4000-9000-0000000000ad','Walk Admin','admin', ARRAY['admin']::public.user_role[]),
  ('00000000-0000-4000-9000-000000000d01','Walk M','teacher', ARRAY['teacher']::public.user_role[]),
  ('00000000-0000-4000-9000-000000000c01','Walk C','teacher', ARRAY['teacher']::public.user_role[]);

-- Only M is switched to the manual rail (C keeps the 'stripe_connect' default).
UPDATE public.teacher_profiles SET payout_method = 'manual'
  WHERE teacher_id = '00000000-0000-4000-9000-000000000d01';

-- bookings → sessions → session_deliveries (session earnings need a delivery FK).
INSERT INTO public.bookings (id, student_id, teacher_id, duration_min, rate_snapshot, amount_usd, scheduled_at, status) VALUES
  ('00000000-0000-4000-9000-000000b000d1','00000000-0000-4000-9000-0000000000aa','00000000-0000-4000-9000-000000000d01',30,20.00,10.00, now()-interval '20 days', 'confirmed'),
  ('00000000-0000-4000-9000-000000b000d2','00000000-0000-4000-9000-0000000000aa','00000000-0000-4000-9000-000000000d01',30,20.00,10.00, now()-interval '20 days 1 hour', 'confirmed'),
  ('00000000-0000-4000-9000-000000b000d3','00000000-0000-4000-9000-0000000000aa','00000000-0000-4000-9000-000000000d01',30,20.00,10.00, now()-interval '20 days 2 hours', 'confirmed'),
  ('00000000-0000-4000-9000-000000b000c1','00000000-0000-4000-9000-0000000000aa','00000000-0000-4000-9000-000000000c01',30,20.00,10.00, now()-interval '20 days', 'confirmed');

INSERT INTO public.sessions (id, booking_id, room_name, room_url, scheduled_at) VALUES
  ('00000000-0000-4000-9000-000000c000d1','00000000-0000-4000-9000-000000b000d1','rd1','https://w.test/d1', now()-interval '20 days'),
  ('00000000-0000-4000-9000-000000c000d2','00000000-0000-4000-9000-000000b000d2','rd2','https://w.test/d2', now()-interval '20 days'),
  ('00000000-0000-4000-9000-000000c000d3','00000000-0000-4000-9000-000000b000d3','rd3','https://w.test/d3', now()-interval '20 days'),
  ('00000000-0000-4000-9000-000000c000c1','00000000-0000-4000-9000-000000b000c1','rc1','https://w.test/c1', now()-interval '20 days');

INSERT INTO public.session_deliveries (id, session_id, teacher_id, duration_minutes, hourly_rate_usd, delivered_at, payroll_period_month) VALUES
  ('00000000-0000-4000-9000-000000d000d1','00000000-0000-4000-9000-000000c000d1','00000000-0000-4000-9000-000000000d01',30,20.00, now()-interval '20 days', date_trunc('month', now())::date),
  ('00000000-0000-4000-9000-000000d000d2','00000000-0000-4000-9000-000000c000d2','00000000-0000-4000-9000-000000000d01',30,20.00, now()-interval '20 days', date_trunc('month', now())::date),
  ('00000000-0000-4000-9000-000000d000d3','00000000-0000-4000-9000-000000c000d3','00000000-0000-4000-9000-000000000d01',30,20.00, now()-interval '20 days', date_trunc('month', now())::date),
  ('00000000-0000-4000-9000-000000d000c1','00000000-0000-4000-9000-000000c000c1','00000000-0000-4000-9000-000000000c01',30,20.00, now()-interval '20 days', date_trunc('month', now())::date);

-- Earning entries seeded DIRECTLY at their sweep-produced states:
--   E1  M, manual_due  → settles (no debt ⇒ expected net = gross 1000)
--   E2  M, manual_due  → blank-ref + pasted-twice negatives
--   E3  M, pending     → wrong-status no-op
--   EC  C, manual_due  → refused by the payout_method='manual' guard
INSERT INTO public.teacher_earning_entries (id, teacher_id, kind, amount_cents, session_delivery_id, status) VALUES
  ('00000000-0000-4000-9000-0000000000e1','00000000-0000-4000-9000-000000000d01','session',1000,'00000000-0000-4000-9000-000000d000d1','manual_due'),
  ('00000000-0000-4000-9000-0000000000e2','00000000-0000-4000-9000-000000000d01','session',1000,'00000000-0000-4000-9000-000000d000d2','manual_due'),
  ('00000000-0000-4000-9000-0000000000e3','00000000-0000-4000-9000-000000000d01','session',1000,'00000000-0000-4000-9000-000000d000d3','pending'),
  ('00000000-0000-4000-9000-0000000000ec','00000000-0000-4000-9000-000000000c01','session',1000,'00000000-0000-4000-9000-000000d000c1','manual_due');

-- ════════════════════════════════════════════════════════════════════════
-- [1] Happy path: settle E1 at expected net 1000 → 'settled'; status flips;
--     all 3 settlement cols set; no recovery row (no debt).
-- ════════════════════════════════════════════════════════════════════════
DO $$
DECLARE
  v         jsonb;
  v_status  text;
  v_ref     text;
  v_by      uuid;
  v_at      timestamptz;
  v_rec     int;
BEGIN
  v := connect_settle_manual_due(
         '00000000-0000-4000-9000-0000000000e1',
         '  BANK-TXN-1  ',                 -- untrimmed input; the fn btrims it
         '00000000-0000-4000-9000-0000000000ad',
         1000);
  IF v->>'outcome' <> 'settled' THEN RAISE EXCEPTION '[settle] outcome must be settled, got %', v; END IF;
  IF (v->>'net_paid_cents')::bigint <> 1000 THEN RAISE EXCEPTION '[settle] net must be 1000, got %', v; END IF;
  IF (v->>'recovered_cents')::bigint <> 0 THEN RAISE EXCEPTION '[settle] recovered must be 0, got %', v; END IF;

  SELECT status, external_reference_id, settled_by, settled_at
    INTO v_status, v_ref, v_by, v_at
    FROM teacher_earning_entries WHERE id='00000000-0000-4000-9000-0000000000e1';

  IF v_status <> 'manual_paid' THEN RAISE EXCEPTION '[settle] status must be manual_paid, got %', v_status; END IF;
  IF v_ref <> 'BANK-TXN-1' THEN RAISE EXCEPTION '[settle] reference must be trimmed to BANK-TXN-1, got %', v_ref; END IF;
  IF v_by <> '00000000-0000-4000-9000-0000000000ad' THEN RAISE EXCEPTION '[settle] settled_by wrong, got %', v_by; END IF;
  IF v_at IS NULL THEN RAISE EXCEPTION '[settle] settled_at must be set'; END IF;

  SELECT count(*) INTO v_rec FROM teacher_earning_entries
   WHERE kind='debt_recovery' AND consuming_entry_id='00000000-0000-4000-9000-0000000000e1';
  IF v_rec <> 0 THEN RAISE EXCEPTION '[settle] no debt ⇒ no recovery row, got %', v_rec; END IF;
END $$;

-- ════════════════════════════════════════════════════════════════════════
-- [2] Replay: a second settle on the already-paid E1 → 'not_found', UNCHANGED.
-- ════════════════════════════════════════════════════════════════════════
DO $$
DECLARE v jsonb; v_ref_before text; v_at_before timestamptz; v_ref_after text; v_at_after timestamptz;
BEGIN
  SELECT external_reference_id, settled_at INTO v_ref_before, v_at_before
    FROM teacher_earning_entries WHERE id='00000000-0000-4000-9000-0000000000e1';

  v := connect_settle_manual_due(
         '00000000-0000-4000-9000-0000000000e1',
         'BANK-TXN-OVERWRITE',
         '00000000-0000-4000-9000-0000000000ad',
         1000);
  IF v->>'outcome' <> 'not_found' THEN RAISE EXCEPTION '[replay] second settle must be not_found, got %', v; END IF;

  SELECT external_reference_id, settled_at INTO v_ref_after, v_at_after
    FROM teacher_earning_entries WHERE id='00000000-0000-4000-9000-0000000000e1';
  IF v_ref_after <> v_ref_before THEN RAISE EXCEPTION '[replay] reference must be unchanged, was % now %', v_ref_before, v_ref_after; END IF;
  IF v_at_after <> v_at_before THEN RAISE EXCEPTION '[replay] settled_at must be unchanged'; END IF;
END $$;

-- ════════════════════════════════════════════════════════════════════════
-- [3] Rail safety: EC is manual_due but C is on the stripe rail → the
--     payout_method='manual' guard REFUSES it → 'not_found', stays manual_due.
-- ════════════════════════════════════════════════════════════════════════
DO $$
DECLARE v jsonb; v_status text; v_ref text;
BEGIN
  v := connect_settle_manual_due(
         '00000000-0000-4000-9000-0000000000ec',
         'BANK-TXN-2',
         '00000000-0000-4000-9000-0000000000ad',
         1000);
  IF v->>'outcome' <> 'not_found' THEN RAISE EXCEPTION '[rail] a stripe_connect entry must be refused, got %', v; END IF;

  SELECT status, external_reference_id INTO v_status, v_ref
    FROM teacher_earning_entries WHERE id='00000000-0000-4000-9000-0000000000ec';
  IF v_status <> 'manual_due' THEN RAISE EXCEPTION '[rail] EC must stay manual_due, got %', v_status; END IF;
  IF v_ref IS NOT NULL THEN RAISE EXCEPTION '[rail] EC must keep NULL reference, got %', v_ref; END IF;
END $$;

-- ════════════════════════════════════════════════════════════════════════
-- [4] Wrong status: E3 is 'pending' → 'not_found', stays pending.
-- ════════════════════════════════════════════════════════════════════════
DO $$
DECLARE v jsonb; v_status text;
BEGIN
  v := connect_settle_manual_due(
         '00000000-0000-4000-9000-0000000000e3',
         'BANK-TXN-3',
         '00000000-0000-4000-9000-0000000000ad',
         1000);
  IF v->>'outcome' <> 'not_found' THEN RAISE EXCEPTION '[status] a pending entry must not settle, got %', v; END IF;
  SELECT status INTO v_status FROM teacher_earning_entries WHERE id='00000000-0000-4000-9000-0000000000e3';
  IF v_status <> 'pending' THEN RAISE EXCEPTION '[status] E3 must stay pending, got %', v_status; END IF;
END $$;

-- ════════════════════════════════════════════════════════════════════════
-- [5] Blank reference with net > 0 → RAISE (caller breach), savepoint-caught.
--     E2 must be untouched (still manual_due) afterwards.
-- ════════════════════════════════════════════════════════════════════════
DO $$
DECLARE v_raised boolean := false; v_status text;
BEGIN
  BEGIN
    PERFORM connect_settle_manual_due(
              '00000000-0000-4000-9000-0000000000e2',
              '   ',
              '00000000-0000-4000-9000-0000000000ad',
              1000);
  EXCEPTION WHEN OTHERS THEN v_raised := true;
  END;
  IF NOT v_raised THEN RAISE EXCEPTION '[blank] a blank reference with net>0 must RAISE'; END IF;
  SELECT status INTO v_status FROM teacher_earning_entries WHERE id='00000000-0000-4000-9000-0000000000e2';
  IF v_status <> 'manual_due' THEN RAISE EXCEPTION '[blank] E2 must stay manual_due, got %', v_status; END IF;
END $$;

-- ════════════════════════════════════════════════════════════════════════
-- [6] Pasted-twice reference: settle E2 with 'BANK-TXN-1' (already used by E1,
--     same teacher M) → partial UNIQUE(teacher_id, external_reference_id)
--     violation RAISES. Caught in a savepoint; E2 stays manual_due.
-- ════════════════════════════════════════════════════════════════════════
DO $$
DECLARE v_raised boolean := false; v_status text;
BEGIN
  BEGIN
    PERFORM connect_settle_manual_due(
              '00000000-0000-4000-9000-0000000000e2',
              'BANK-TXN-1',
              '00000000-0000-4000-9000-0000000000ad',
              1000);
  EXCEPTION WHEN unique_violation THEN v_raised := true;
  END;
  IF NOT v_raised THEN RAISE EXCEPTION '[dup-ref] a reused reference must hit the UNIQUE backstop'; END IF;
  SELECT status INTO v_status FROM teacher_earning_entries WHERE id='00000000-0000-4000-9000-0000000000e2';
  IF v_status <> 'manual_due' THEN RAISE EXCEPTION '[dup-ref] E2 must stay manual_due, got %', v_status; END IF;
END $$;

-- ════════════════════════════════════════════════════════════════════════
-- [7] Lockdown: EXECUTE is service_role only — anon/authenticated cannot call it.
-- ════════════════════════════════════════════════════════════════════════
DO $$
BEGIN
  IF has_function_privilege('anon',
       'connect_settle_manual_due(uuid, text, uuid, bigint)', 'EXECUTE') THEN
    RAISE EXCEPTION '[lockdown] anon must NOT have EXECUTE';
  END IF;
  IF has_function_privilege('authenticated',
       'connect_settle_manual_due(uuid, text, uuid, bigint)', 'EXECUTE') THEN
    RAISE EXCEPTION '[lockdown] authenticated must NOT have EXECUTE';
  END IF;
  IF NOT has_function_privilege('service_role',
       'connect_settle_manual_due(uuid, text, uuid, bigint)', 'EXECUTE') THEN
    RAISE EXCEPTION '[lockdown] service_role MUST have EXECUTE';
  END IF;
END $$;

\echo '════════════════════════════════════════════════════════════════'
\echo '  walk-040-manual-settlement: ALL ASSERTIONS PASSED'
\echo '════════════════════════════════════════════════════════════════'

ROLLBACK;
