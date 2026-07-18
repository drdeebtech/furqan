-- Rolled-back verification walk for the FR-027a debt-netting features in
-- 20260811000000_connect_manual_net_settlement.sql. Run:
--   psql "$LOCAL_DB_URL" -v ON_ERROR_STOP=1 -f scripts/walk-040-manual-net-settlement.sql
-- Every assertion RAISEs on failure; the whole walk rolls back (BEGIN…ROLLBACK).
--
-- Proves:
--  [1] FIFO allocation: debt is charged to a teacher's manual_due entries
--      oldest-first, and the allocation is ORDER-INDEPENDENT under settlement.
--  [2] Settle-time netting: settle writes the recovery row + pays the net;
--      a fully-consumed entry closes as debt_recovered with NO reference.
--  [3] stale_net fence: a wrong expected net refuses and writes NOTHING.
--  [4] Recovery cap trigger (replaces UNIQUE(consuming_entry_id)): recoveries
--      per consuming entry can total at most the entry's value — a second
--      recovery within the cap is now LEGAL (the 23505 hot-loop fix), one
--      beyond the cap RAISES.
--  [5] teacher_on_hold: an active payout hold refuses manual settlement.
--  [6] Requeue overpay fix: a re-claimed entry with a prior recovery is
--      claimed at its REMAINING value, not its gross.
--
-- ids are hex-only (uuid): teacher N uses 'e' tokens ('walk net').

BEGIN;
SET LOCAL search_path = public, extensions;

-- ════════════════════════════════════════════════════════════════════════
-- Seed (rolled back). Teacher N on the manual rail, 1 admin, 4 deliveries.
-- ════════════════════════════════════════════════════════════════════════
INSERT INTO auth.users (id, email, instance_id, aud, role) VALUES
  ('00000000-0000-4000-9000-0000000000ab','walknet.student@test.local','00000000-0000-0000-0000-000000000000','authenticated','authenticated'),
  ('00000000-0000-4000-9000-0000000000ae','walknet.admin@test.local','00000000-0000-0000-0000-000000000000','authenticated','authenticated'),
  ('00000000-0000-4000-9000-000000000e01','walknet.n@test.local','00000000-0000-0000-0000-000000000000','authenticated','authenticated');

INSERT INTO public.profiles (id, full_name, role, roles) VALUES
  ('00000000-0000-4000-9000-0000000000ab','WalkNet Student','student', ARRAY['student']::public.user_role[]),
  ('00000000-0000-4000-9000-0000000000ae','WalkNet Admin','admin', ARRAY['admin']::public.user_role[]),
  ('00000000-0000-4000-9000-000000000e01','WalkNet N','teacher', ARRAY['teacher']::public.user_role[]);

UPDATE public.teacher_profiles SET payout_method = 'manual'
  WHERE teacher_id = '00000000-0000-4000-9000-000000000e01';

INSERT INTO public.bookings (id, student_id, teacher_id, duration_min, rate_snapshot, amount_usd, scheduled_at, status) VALUES
  ('00000000-0000-4000-9000-000000b000e1','00000000-0000-4000-9000-0000000000ab','00000000-0000-4000-9000-000000000e01',30,20.00,10.00, now()-interval '20 days', 'confirmed'),
  ('00000000-0000-4000-9000-000000b000e2','00000000-0000-4000-9000-0000000000ab','00000000-0000-4000-9000-000000000e01',30,20.00,10.00, now()-interval '20 days 1 hour', 'confirmed'),
  ('00000000-0000-4000-9000-000000b000e3','00000000-0000-4000-9000-0000000000ab','00000000-0000-4000-9000-000000000e01',30,20.00,10.00, now()-interval '20 days 2 hours', 'confirmed'),
  ('00000000-0000-4000-9000-000000b000e4','00000000-0000-4000-9000-0000000000ab','00000000-0000-4000-9000-000000000e01',30,20.00,10.00, now()-interval '20 days 3 hours', 'confirmed'),
  ('00000000-0000-4000-9000-000000b000e5','00000000-0000-4000-9000-0000000000ab','00000000-0000-4000-9000-000000000e01',30,20.00,10.00, now()-interval '40 days', 'confirmed');

INSERT INTO public.sessions (id, booking_id, room_name, room_url, scheduled_at) VALUES
  ('00000000-0000-4000-9000-000000c000e1','00000000-0000-4000-9000-000000b000e1','re1','https://w.test/e1', now()-interval '20 days'),
  ('00000000-0000-4000-9000-000000c000e2','00000000-0000-4000-9000-000000b000e2','re2','https://w.test/e2', now()-interval '20 days'),
  ('00000000-0000-4000-9000-000000c000e3','00000000-0000-4000-9000-000000b000e3','re3','https://w.test/e3', now()-interval '20 days'),
  ('00000000-0000-4000-9000-000000c000e4','00000000-0000-4000-9000-000000b000e4','re4','https://w.test/e4', now()-interval '20 days'),
  ('00000000-0000-4000-9000-000000c000e5','00000000-0000-4000-9000-000000b000e5','re5','https://w.test/e5', now()-interval '40 days');

INSERT INTO public.session_deliveries (id, session_id, teacher_id, duration_minutes, hourly_rate_usd, delivered_at, payroll_period_month) VALUES
  ('00000000-0000-4000-9000-000000d000e1','00000000-0000-4000-9000-000000c000e1','00000000-0000-4000-9000-000000000e01',30,20.00, now()-interval '20 days', date_trunc('month', now())::date),
  ('00000000-0000-4000-9000-000000d000e2','00000000-0000-4000-9000-000000c000e2','00000000-0000-4000-9000-000000000e01',30,20.00, now()-interval '20 days', date_trunc('month', now())::date),
  ('00000000-0000-4000-9000-000000d000e3','00000000-0000-4000-9000-000000c000e3','00000000-0000-4000-9000-000000000e01',30,20.00, now()-interval '20 days', date_trunc('month', now())::date),
  ('00000000-0000-4000-9000-000000d000e4','00000000-0000-4000-9000-000000c000e4','00000000-0000-4000-9000-000000000e01',30,20.00, now()-interval '20 days', date_trunc('month', now())::date),
  ('00000000-0000-4000-9000-000000d000e5','00000000-0000-4000-9000-000000c000e5','00000000-0000-4000-9000-000000000e01',30,20.00, now()-interval '40 days', date_trunc('month', now())::date);

-- Z: an already-TRANSFERRED earlier earning — the refunded source every walk
-- clawback points at (chk_entry_clawback_links requires the provenance pair).
INSERT INTO public.teacher_earning_entries (id, teacher_id, kind, amount_cents, session_delivery_id, status, created_at) VALUES
  ('00000000-0000-4000-9000-00000000e0e5','00000000-0000-4000-9000-000000000e01','session',5000,'00000000-0000-4000-9000-000000d000e5','transferred', now()-interval '30 days');

-- A = older manual_due (1000), B = newer manual_due (1000), plus a clawback of
-- -1500: FIFO says A absorbs 1000, B absorbs 500 → nets 0 and 500.
-- (created_at is staggered explicitly — FIFO orders by it.)
INSERT INTO public.teacher_earning_entries (id, teacher_id, kind, amount_cents, session_delivery_id, status, created_at) VALUES
  ('00000000-0000-4000-9000-00000000a0e1','00000000-0000-4000-9000-000000000e01','session',1000,'00000000-0000-4000-9000-000000d000e1','manual_due', now()-interval '2 days'),
  ('00000000-0000-4000-9000-00000000b0e2','00000000-0000-4000-9000-000000000e01','session',1000,'00000000-0000-4000-9000-000000d000e2','manual_due', now()-interval '1 day');

INSERT INTO public.teacher_earning_entries (teacher_id, kind, amount_cents, status, clawback_of_entry_id, source_reference_id) VALUES
  ('00000000-0000-4000-9000-000000000e01','clawback',-1500,'voided','00000000-0000-4000-9000-00000000e0e5','walknet-refund-1');

-- ════════════════════════════════════════════════════════════════════════
-- [1] FIFO allocation: A (older) absorbs 1000 → net 0; B absorbs 500 → net 500.
-- ════════════════════════════════════════════════════════════════════════
DO $$
DECLARE v_a bigint; v_b bigint; v_debt bigint;
BEGIN
  v_debt := connect_outstanding_debt_cents('00000000-0000-4000-9000-000000000e01');
  IF v_debt <> 1500 THEN RAISE EXCEPTION '[fifo] debt must be 1500, got %', v_debt; END IF;

  v_a := connect_manual_fifo_recover_cents('00000000-0000-4000-9000-00000000a0e1');
  v_b := connect_manual_fifo_recover_cents('00000000-0000-4000-9000-00000000b0e2');
  IF v_a <> 1000 THEN RAISE EXCEPTION '[fifo] A share must be 1000, got %', v_a; END IF;
  IF v_b <> 500 THEN RAISE EXCEPTION '[fifo] B share must be 500, got %', v_b; END IF;
END $$;

-- ════════════════════════════════════════════════════════════════════════
-- [2] Order-independence + settle-time netting: settle B FIRST at its net 500
--     → 'settled', recovery row 500 (debt drops to 1000); then A's share is
--     still its full 1000 → expected net 0 closes it as debt_recovered with
--     NO reference; debt reaches 0; audit rows written for both.
-- ════════════════════════════════════════════════════════════════════════
DO $$
DECLARE v jsonb; v_status text; v_rec bigint; v_debt bigint; v_audit int;
BEGIN
  -- Settle the NEWER entry first (out of FIFO order on purpose).
  v := connect_settle_manual_due(
         '00000000-0000-4000-9000-00000000b0e2', 'NET-TXN-B',
         '00000000-0000-4000-9000-0000000000ae', 500);
  IF v->>'outcome' <> 'settled' THEN RAISE EXCEPTION '[order] B must settle, got %', v; END IF;
  IF (v->>'net_paid_cents')::bigint <> 500 OR (v->>'recovered_cents')::bigint <> 500 THEN
    RAISE EXCEPTION '[order] B split must be 500/500, got %', v;
  END IF;

  SELECT COALESCE(SUM(amount_cents),0) INTO v_rec FROM teacher_earning_entries
   WHERE kind='debt_recovery' AND consuming_entry_id='00000000-0000-4000-9000-00000000b0e2';
  IF v_rec <> 500 THEN RAISE EXCEPTION '[order] B recovery row must total 500, got %', v_rec; END IF;

  v_debt := connect_outstanding_debt_cents('00000000-0000-4000-9000-000000000e01');
  IF v_debt <> 1000 THEN RAISE EXCEPTION '[order] debt after B must be 1000, got %', v_debt; END IF;

  -- A's share is unchanged by settling B (order independence).
  IF connect_manual_fifo_recover_cents('00000000-0000-4000-9000-00000000a0e1') <> 1000 THEN
    RAISE EXCEPTION '[order] A share must still be 1000 after settling B';
  END IF;

  -- Zero-net close of A: no reference, closes as debt_recovered.
  v := connect_settle_manual_due(
         '00000000-0000-4000-9000-00000000a0e1', NULL,
         '00000000-0000-4000-9000-0000000000ae', 0);
  IF v->>'outcome' <> 'closed_debt_recovered' THEN RAISE EXCEPTION '[zero] A must close as debt_recovered, got %', v; END IF;

  SELECT status INTO v_status FROM teacher_earning_entries WHERE id='00000000-0000-4000-9000-00000000a0e1';
  IF v_status <> 'debt_recovered' THEN RAISE EXCEPTION '[zero] A status must be debt_recovered, got %', v_status; END IF;

  v_debt := connect_outstanding_debt_cents('00000000-0000-4000-9000-000000000e01');
  IF v_debt <> 0 THEN RAISE EXCEPTION '[zero] debt must be fully recovered (0), got %', v_debt; END IF;

  -- Both netted operations wrote audit rows (netted settle + zero-net close).
  SELECT count(*) INTO v_audit FROM connect_payout_audit
   WHERE subject_teacher_id='00000000-0000-4000-9000-000000000e01'
     AND event IN ('manual_settled_net','manual_closed_debt_recovered');
  IF v_audit <> 2 THEN RAISE EXCEPTION '[audit] expected 2 audit rows, got %', v_audit; END IF;
END $$;

-- ════════════════════════════════════════════════════════════════════════
-- [3] stale_net fence: entry C (manual_due 1000) + fresh clawback -300 → true
--     net is 700; a settle at the stale 1000 → 'stale_net' carrying 700,
--     and NOTHING is written (status, recoveries, settlement cols unchanged).
-- ════════════════════════════════════════════════════════════════════════
INSERT INTO public.teacher_earning_entries (id, teacher_id, kind, amount_cents, session_delivery_id, status, created_at) VALUES
  ('00000000-0000-4000-9000-00000000c0e3','00000000-0000-4000-9000-000000000e01','session',1000,'00000000-0000-4000-9000-000000d000e3','manual_due', now());
INSERT INTO public.teacher_earning_entries (teacher_id, kind, amount_cents, status, clawback_of_entry_id, source_reference_id) VALUES
  ('00000000-0000-4000-9000-000000000e01','clawback',-300,'voided','00000000-0000-4000-9000-00000000e0e5','walknet-refund-2');

DO $$
DECLARE v jsonb; v_status text; v_rec int;
BEGIN
  v := connect_settle_manual_due(
         '00000000-0000-4000-9000-00000000c0e3', 'NET-TXN-C',
         '00000000-0000-4000-9000-0000000000ae', 1000);
  IF v->>'outcome' <> 'stale_net' THEN RAISE EXCEPTION '[stale] must refuse with stale_net, got %', v; END IF;
  IF (v->>'net_due_cents')::bigint <> 700 THEN RAISE EXCEPTION '[stale] fresh net must be 700, got %', v; END IF;

  SELECT status INTO v_status FROM teacher_earning_entries WHERE id='00000000-0000-4000-9000-00000000c0e3';
  IF v_status <> 'manual_due' THEN RAISE EXCEPTION '[stale] C must stay manual_due, got %', v_status; END IF;
  SELECT count(*) INTO v_rec FROM teacher_earning_entries
   WHERE kind='debt_recovery' AND consuming_entry_id='00000000-0000-4000-9000-00000000c0e3';
  IF v_rec <> 0 THEN RAISE EXCEPTION '[stale] refusal must write NO recovery, got %', v_rec; END IF;

  -- Retrying at the fresh number settles at 700 net / 300 recovered.
  v := connect_settle_manual_due(
         '00000000-0000-4000-9000-00000000c0e3', 'NET-TXN-C',
         '00000000-0000-4000-9000-0000000000ae', 700);
  IF v->>'outcome' <> 'settled' OR (v->>'recovered_cents')::bigint <> 300 THEN
    RAISE EXCEPTION '[stale] retry at fresh net must settle 700/300, got %', v;
  END IF;
END $$;

-- ════════════════════════════════════════════════════════════════════════
-- [4] Recovery cap trigger: C (value 1000) already consumed 300 of debt. A
--     second recovery within the cap (≤700) is LEGAL; one beyond it RAISES.
-- ════════════════════════════════════════════════════════════════════════
DO $$
DECLARE v_raised boolean := false; v_claw uuid;
BEGIN
  SELECT id INTO v_claw FROM teacher_earning_entries
   WHERE teacher_id='00000000-0000-4000-9000-000000000e01' AND kind='clawback'
   ORDER BY created_at LIMIT 1;

  -- Within the cap: 300 recovered + 700 more = exactly the entry's value. LEGAL
  -- (this is the requeue scenario the old UNIQUE turned into a 23505 hot-loop).
  INSERT INTO teacher_earning_entries (teacher_id, kind, amount_cents, status, consuming_entry_id, recovered_against_entry_id)
  VALUES ('00000000-0000-4000-9000-000000000e01','debt_recovery',700,'debt_recovered',
          '00000000-0000-4000-9000-00000000c0e3', v_claw);

  -- Beyond the cap: any further recovery consuming C must RAISE.
  BEGIN
    INSERT INTO teacher_earning_entries (teacher_id, kind, amount_cents, status, consuming_entry_id, recovered_against_entry_id)
    VALUES ('00000000-0000-4000-9000-000000000e01','debt_recovery',1,'debt_recovered',
            '00000000-0000-4000-9000-00000000c0e3', v_claw);
  EXCEPTION WHEN OTHERS THEN v_raised := true;
  END;
  IF NOT v_raised THEN RAISE EXCEPTION '[cap] a recovery beyond the entry value must RAISE'; END IF;
END $$;

-- ════════════════════════════════════════════════════════════════════════
-- [5] teacher_on_hold: an active hold refuses manual settlement (FR-015/023).
-- ════════════════════════════════════════════════════════════════════════
INSERT INTO public.teacher_earning_entries (id, teacher_id, kind, amount_cents, session_delivery_id, status, created_at) VALUES
  ('00000000-0000-4000-9000-00000000d0e4','00000000-0000-4000-9000-000000000e01','session',1000,'00000000-0000-4000-9000-000000d000e4','manual_due', now());
INSERT INTO public.payout_holds (id, teacher_id, source, reason, created_by) VALUES
  ('00000000-0000-4000-9000-00000000f0e1','00000000-0000-4000-9000-000000000e01','admin','walk hold','00000000-0000-4000-9000-0000000000ae');

DO $$
DECLARE v jsonb; v_status text;
BEGIN
  v := connect_settle_manual_due(
         '00000000-0000-4000-9000-00000000d0e4', 'NET-TXN-D',
         '00000000-0000-4000-9000-0000000000ae', 1000);
  IF v->>'outcome' <> 'teacher_on_hold' THEN RAISE EXCEPTION '[hold] must refuse with teacher_on_hold, got %', v; END IF;
  SELECT status INTO v_status FROM teacher_earning_entries WHERE id='00000000-0000-4000-9000-00000000d0e4';
  IF v_status <> 'manual_due' THEN RAISE EXCEPTION '[hold] D must stay manual_due, got %', v_status; END IF;
END $$;

-- Release the hold (so [6]'s claim is not blocked by it).
UPDATE public.payout_holds
   SET released_at = now(), released_by = '00000000-0000-4000-9000-0000000000ae'
 WHERE id = '00000000-0000-4000-9000-00000000f0e1';

-- ════════════════════════════════════════════════════════════════════════
-- [6] Requeue overpay fix: entry D (gross 1000) is requeued to pending after a
--     prior partial recovery of 400 → the sweep claim returns it at its
--     REMAINING value 600, never the gross.
-- ════════════════════════════════════════════════════════════════════════
-- Simulate the prior recovery + requeue (the rail-switch re-route path).
DO $$
DECLARE v_claw uuid;
BEGIN
  -- A fresh clawback funds the debt this recovery pays down (cap needs headroom).
  INSERT INTO teacher_earning_entries (teacher_id, kind, amount_cents, status, clawback_of_entry_id, source_reference_id)
  VALUES ('00000000-0000-4000-9000-000000000e01','clawback',-400,'voided','00000000-0000-4000-9000-00000000e0e5','walknet-refund-3');
  SELECT id INTO v_claw FROM teacher_earning_entries
   WHERE teacher_id='00000000-0000-4000-9000-000000000e01' AND kind='clawback'
   ORDER BY created_at DESC LIMIT 1;
  INSERT INTO teacher_earning_entries (teacher_id, kind, amount_cents, status, consuming_entry_id, recovered_against_entry_id)
  VALUES ('00000000-0000-4000-9000-000000000e01','debt_recovery',400,'debt_recovered',
          '00000000-0000-4000-9000-00000000d0e4', v_claw);
  UPDATE teacher_earning_entries SET status='pending'
   WHERE id='00000000-0000-4000-9000-00000000d0e4';
END $$;

-- Arm the dormant switch INSIDE the rolled-back txn (cutover 30 days ago).
-- The write-once setter soft-refuses when a cutover already exists (e.g. the
-- local dev DB after an E2E run), so the walk uses the sole-writer escape hatch
-- directly: the txn-local app.connect_cutover_writer gate the setter itself
-- uses. Rolled back with everything else — the real value is untouched.
DO $$
BEGIN
  PERFORM set_config('app.connect_cutover_writer', 'on', true);
  UPDATE platform_settings
     SET value = to_char(now() - interval '30 days', 'YYYY-MM-DD')
   WHERE key = 'connect_cutover_date';
  IF NOT FOUND THEN RAISE EXCEPTION '[arm] connect_cutover_date setting row missing'; END IF;
END $$;

DO $$
DECLARE r record; v_found boolean := false;
BEGIN
  FOR r IN SELECT * FROM connect_sweep_claim_eligible(now()) LOOP
    IF r.entry_id = '00000000-0000-4000-9000-00000000d0e4' THEN
      v_found := true;
      IF r.amount_cents <> 600 THEN
        RAISE EXCEPTION '[requeue] claim must return the REMAINING 600, got %', r.amount_cents;
      END IF;
    END IF;
  END LOOP;
  IF NOT v_found THEN RAISE EXCEPTION '[requeue] entry D must be claimable'; END IF;
END $$;

-- ════════════════════════════════════════════════════════════════════════
-- [7] Lockdown for the new helper functions.
-- ════════════════════════════════════════════════════════════════════════
DO $$
BEGIN
  IF has_function_privilege('anon', 'connect_entry_recovered_cents(uuid)', 'EXECUTE')
  OR has_function_privilege('authenticated', 'connect_entry_recovered_cents(uuid)', 'EXECUTE') THEN
    RAISE EXCEPTION '[lockdown] connect_entry_recovered_cents must not be client-executable';
  END IF;
  IF has_function_privilege('anon', 'connect_outstanding_debt_cents(uuid)', 'EXECUTE')
  OR has_function_privilege('authenticated', 'connect_outstanding_debt_cents(uuid)', 'EXECUTE') THEN
    RAISE EXCEPTION '[lockdown] connect_outstanding_debt_cents must not be client-executable';
  END IF;
  IF has_function_privilege('anon', 'connect_manual_fifo_recover_cents(uuid)', 'EXECUTE')
  OR has_function_privilege('authenticated', 'connect_manual_fifo_recover_cents(uuid)', 'EXECUTE') THEN
    RAISE EXCEPTION '[lockdown] connect_manual_fifo_recover_cents must not be client-executable';
  END IF;
END $$;

\echo '════════════════════════════════════════════════════════════════'
\echo '  walk-040-manual-net-settlement: ALL ASSERTIONS PASSED'
\echo '════════════════════════════════════════════════════════════════'

ROLLBACK;
