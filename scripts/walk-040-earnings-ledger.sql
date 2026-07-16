-- Rolled-back verification walk for 20260728000000_connect_earnings_ledger.sql
-- (spec 040 Slice 1). Run:
--   psql "$LOCAL_DB_URL" -v ON_ERROR_STOP=1 -f scripts/walk-040-earnings-ledger.sql
-- Every assertion RAISEs on failure; the whole walk rolls back, so it is safe
-- to re-run and leaves no rows behind.
--
-- Assert the OUTCOME, not the mechanism (spec 040 Phase 0 gate):
--   * trigger-enforced rules RAISE
--   * RLS-forbidden writes do NOT raise — they match 0 rows and change nothing
-- Asserting the wrong one yields a green test that proves nothing.

BEGIN;

-- Legacy tables (sessions, bookings) default their ids with
-- extensions.uuid_generate_v4(); psql's default search_path omits `extensions`,
-- so seeding them fails without this. Everything below is schema-qualified, so
-- widening the path only affects those defaults.
SET LOCAL search_path = public, extensions;

-- ── Seed (all rolled back) ──────────────────────────────────────────────
INSERT INTO auth.users (id, email, instance_id, aud, role) VALUES
  ('00000000-0000-4000-9000-00000000000a', 'walk.teacher@test.local',
   '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated'),
  ('00000000-0000-4000-9000-00000000000b', 'walk.other@test.local',
   '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated');

INSERT INTO public.profiles (id, full_name, role, roles) VALUES
  ('00000000-0000-4000-9000-00000000000a', 'Walk Teacher', 'teacher', ARRAY['teacher']::public.user_role[]),
  ('00000000-0000-4000-9000-00000000000b', 'Walk Other',   'teacher', ARRAY['teacher']::public.user_role[]);

-- Two deliveries: one 13 days old (must NOT be eligible), one 14 days + 1 min
-- old (must be eligible). session_deliveries → sessions → bookings.
INSERT INTO public.bookings (id, student_id, teacher_id, duration_min, rate_snapshot, amount_usd, scheduled_at, status) VALUES
  ('00000000-0000-4000-9000-0000000000b1', '00000000-0000-4000-9000-00000000000b',
   '00000000-0000-4000-9000-00000000000a', 30, 20.00, 10.00, now() - interval '13 days', 'confirmed'),
  ('00000000-0000-4000-9000-0000000000b2', '00000000-0000-4000-9000-00000000000b',
   '00000000-0000-4000-9000-00000000000a', 30, 20.00, 10.00, now() - interval '14 days', 'confirmed');

-- room_name is supplied explicitly: the gen_room_name() trigger's fallback
-- pins search_path=public but calls uuid_generate_v4(), which lives in
-- `extensions` — so the fallback raises. Pre-existing repo defect (present in
-- production too), unrelated to spec 040; logged, not fixed here.
INSERT INTO public.sessions (id, booking_id, room_name, room_url, scheduled_at) VALUES
  ('00000000-0000-4000-9000-0000000000c1', '00000000-0000-4000-9000-0000000000b1', 'walk-room-1', 'https://walk.test/r1', now() - interval '13 days'),
  ('00000000-0000-4000-9000-0000000000c2', '00000000-0000-4000-9000-0000000000b2', 'walk-room-2', 'https://walk.test/r2', now() - interval '14 days');

INSERT INTO public.session_deliveries
  (id, session_id, teacher_id, duration_minutes, hourly_rate_usd, delivered_at, payroll_period_month) VALUES
  ('00000000-0000-4000-9000-0000000000d1', '00000000-0000-4000-9000-0000000000c1',
   '00000000-0000-4000-9000-00000000000a', 30, 20.00, now() - interval '13 days', date_trunc('month', now())::date),
  ('00000000-0000-4000-9000-0000000000d2', '00000000-0000-4000-9000-0000000000c2',
   '00000000-0000-4000-9000-00000000000a', 30, 20.00, now() - interval '14 days 1 minute', date_trunc('month', now())::date);

-- Entries for both deliveries: 30 min @ $20/h = 1000 cents (FR-006).
INSERT INTO public.teacher_earning_entries (id, teacher_id, kind, amount_cents, session_delivery_id) VALUES
  ('00000000-0000-4000-9000-0000000000e1', '00000000-0000-4000-9000-00000000000a', 'session', 1000, '00000000-0000-4000-9000-0000000000d1'),
  ('00000000-0000-4000-9000-0000000000e2', '00000000-0000-4000-9000-00000000000a', 'session', 1000, '00000000-0000-4000-9000-0000000000d2');

-- A third delivery, deliberately left WITHOUT an earning entry. Assertion [2a]
-- needs a fixture that violates ONLY the sign constraint: a NULL
-- session_delivery_id also trips chk_entry_session_key, so [2a] would stay green
-- with the sign CHECK deleted — an assertion that cannot fail.
INSERT INTO public.bookings (id, student_id, teacher_id, duration_min, rate_snapshot, amount_usd, scheduled_at, status) VALUES
  ('00000000-0000-4000-9000-0000000000b3', '00000000-0000-4000-9000-00000000000b',
   '00000000-0000-4000-9000-00000000000a', 30, 20.00, 10.00, now() - interval '20 days', 'confirmed');

INSERT INTO public.sessions (id, booking_id, room_name, room_url, scheduled_at) VALUES
  ('00000000-0000-4000-9000-0000000000c3', '00000000-0000-4000-9000-0000000000b3', 'walk-room-3', 'https://walk.test/r3', now() - interval '20 days');

INSERT INTO public.session_deliveries
  (id, session_id, teacher_id, duration_minutes, hourly_rate_usd, delivered_at, payroll_period_month) VALUES
  ('00000000-0000-4000-9000-0000000000d3', '00000000-0000-4000-9000-0000000000c3',
   '00000000-0000-4000-9000-00000000000a', 30, 20.00, now() - interval '20 days', date_trunc('month', now())::date);

-- Transfer and hold rows are seeded HERE, before any role switch, on purpose:
-- a "non-owner reads 0 rows" assertion against an EMPTY table passes no matter
-- what the policy says. Every table the RLS section asserts on must hold an
-- owner row first, or the assertion proves nothing.
INSERT INTO public.teacher_transfers
  (id, entry_id, teacher_id, session_delivery_id, kind, amount_cents, idempotency_key, transfer_group)
VALUES ('00000000-0000-4000-9000-00000000001a',
        '00000000-0000-4000-9000-0000000000e2', '00000000-0000-4000-9000-00000000000a',
        '00000000-0000-4000-9000-0000000000d2', 'transfer', 1000,
        'transfer:00000000-0000-4000-9000-0000000000e2', 'tg_walk_e2');

-- source='dispute': created by the Stripe webhook, which has no human actor to
-- attribute — the deliberate exemption in chk_payout_hold_admin_creator.
INSERT INTO public.payout_holds (id, teacher_id, source, reason)
VALUES ('00000000-0000-4000-9000-00000000001b', '00000000-0000-4000-9000-00000000000a',
        'dispute', 'walk-test dispute hold');

-- ── 1. Financial columns are IMMUTABLE (trigger ⇒ must RAISE) ───────────
DO $$
BEGIN
  BEGIN
    UPDATE public.teacher_earning_entries SET amount_cents = 999999
     WHERE id = '00000000-0000-4000-9000-0000000000e1';
    RAISE EXCEPTION 'ASSERT FAILED: amount_cents was mutable';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM LIKE 'ASSERT FAILED%' THEN RAISE; END IF;
    RAISE NOTICE 'ASSERT OK  [1a] amount_cents UPDATE raises (immutable financials)';
  END;
END $$;

DO $$
BEGIN
  BEGIN
    UPDATE public.teacher_earning_entries SET teacher_id = '00000000-0000-4000-9000-00000000000b'
     WHERE id = '00000000-0000-4000-9000-0000000000e1';
    RAISE EXCEPTION 'ASSERT FAILED: teacher_id was mutable (earning could be stolen)';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM LIKE 'ASSERT FAILED%' THEN RAISE; END IF;
    RAISE NOTICE 'ASSERT OK  [1b] teacher_id UPDATE raises (earning cannot be reassigned)';
  END;
END $$;

-- The Stripe linkage columns the guard's own error message claims to protect.
DO $$
BEGIN
  BEGIN
    UPDATE public.teacher_earning_entries SET funding_charge_id = 'ch_tampered'
     WHERE id = '00000000-0000-4000-9000-0000000000e1';
    RAISE EXCEPTION 'ASSERT FAILED: funding_charge_id was mutable (Stripe audit trail forgeable)';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM LIKE 'ASSERT FAILED%' THEN RAISE; END IF;
    RAISE NOTICE 'ASSERT OK  [1d] funding_charge_id UPDATE raises (Stripe linkage frozen)';
  END;
  BEGIN
    UPDATE public.teacher_earning_entries SET transfer_group = 'tg_tampered'
     WHERE id = '00000000-0000-4000-9000-0000000000e1';
    RAISE EXCEPTION 'ASSERT FAILED: transfer_group was mutable (Stripe audit trail forgeable)';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM LIKE 'ASSERT FAILED%' THEN RAISE; END IF;
    RAISE NOTICE 'ASSERT OK  [1e] transfer_group UPDATE raises (Stripe linkage frozen)';
  END;
END $$;

-- Lifecycle columns MUST still be updatable (else the sweep cannot work).
UPDATE public.teacher_earning_entries SET status = 'held', hold_reason = 'walk-test'
 WHERE id = '00000000-0000-4000-9000-0000000000e1';
DO $$
DECLARE s public.earning_entry_status;
BEGIN
  SELECT status INTO s FROM public.teacher_earning_entries WHERE id = '00000000-0000-4000-9000-0000000000e1';
  IF s <> 'held' THEN RAISE EXCEPTION 'ASSERT FAILED: status not updatable (sweep would be impossible)'; END IF;
  RAISE NOTICE 'ASSERT OK  [1c] status/hold_reason remain updatable (lifecycle works)';
END $$;
UPDATE public.teacher_earning_entries SET status = 'pending', hold_reason = NULL
 WHERE id = '00000000-0000-4000-9000-0000000000e1';

-- ── 2. Sign convention is ENFORCED (CHECK ⇒ must RAISE) ─────────────────
DO $$
BEGIN
  BEGIN
    INSERT INTO public.teacher_earning_entries (teacher_id, kind, amount_cents, session_delivery_id)
    VALUES ('00000000-0000-4000-9000-00000000000a', 'session', -500,
            '00000000-0000-4000-9000-0000000000d3');
    RAISE EXCEPTION 'ASSERT FAILED: negative session earning accepted';
  EXCEPTION WHEN check_violation THEN
    RAISE NOTICE 'ASSERT OK  [2a] negative session earning rejected';
  END;
  BEGIN
    INSERT INTO public.teacher_earning_entries (teacher_id, kind, amount_cents)
    VALUES ('00000000-0000-4000-9000-00000000000a', 'clawback', 500);
    RAISE EXCEPTION 'ASSERT FAILED: positive clawback accepted (sign convention broken)';
  EXCEPTION WHEN check_violation THEN
    RAISE NOTICE 'ASSERT OK  [2b] positive clawback rejected (clawback must be negative)';
  END;
END $$;

-- The CASE has an ELSE false so it fails CLOSED. Prove the sign rule is what
-- rejects the row above by showing the same delivery accepts a POSITIVE amount.
DO $$
DECLARE ok_id uuid;
BEGIN
  INSERT INTO public.teacher_earning_entries (teacher_id, kind, amount_cents, session_delivery_id)
  VALUES ('00000000-0000-4000-9000-00000000000a', 'session', 500,
          '00000000-0000-4000-9000-0000000000d3')
  RETURNING id INTO ok_id;
  IF ok_id IS NULL THEN
    RAISE EXCEPTION 'ASSERT FAILED: a VALID positive session earning was rejected';
  END IF;
  DELETE FROM public.teacher_earning_entries WHERE id = ok_id;
  RAISE NOTICE 'ASSERT OK  [2c] same fixture accepts +500 — [2a] failed on the SIGN, not another constraint';
END $$;

-- ── 3. Idempotency backstops (UNIQUE ⇒ must RAISE) ──────────────────────
DO $$
BEGIN
  BEGIN
    INSERT INTO public.teacher_earning_entries (teacher_id, kind, amount_cents, session_delivery_id)
    VALUES ('00000000-0000-4000-9000-00000000000a', 'session', 1000, '00000000-0000-4000-9000-0000000000d1');
    RAISE EXCEPTION 'ASSERT FAILED: duplicate earning for one delivery accepted (double pay)';
  EXCEPTION WHEN unique_violation THEN
    RAISE NOTICE 'ASSERT OK  [3a] second earning for the same delivery rejected (no double pay)';
  END;
END $$;

-- Debt rows: recovery must link both FKs; reversal must link the recovery.
INSERT INTO public.teacher_earning_entries (id, teacher_id, kind, amount_cents)
VALUES ('00000000-0000-4000-9000-0000000000f1', '00000000-0000-4000-9000-00000000000a', 'clawback', -600);

DO $$
BEGIN
  BEGIN
    INSERT INTO public.teacher_earning_entries (teacher_id, kind, amount_cents, consuming_entry_id)
    VALUES ('00000000-0000-4000-9000-00000000000a', 'debt_recovery', 400, '00000000-0000-4000-9000-0000000000e2');
    RAISE EXCEPTION 'ASSERT FAILED: debt_recovery without recovered_against_entry_id accepted';
  EXCEPTION WHEN check_violation THEN
    RAISE NOTICE 'ASSERT OK  [3b] debt_recovery requires both FK links';
  END;
END $$;

INSERT INTO public.teacher_earning_entries
  (id, teacher_id, kind, amount_cents, consuming_entry_id, recovered_against_entry_id)
VALUES ('00000000-0000-4000-9000-0000000000f2', '00000000-0000-4000-9000-00000000000a', 'debt_recovery', 400,
        '00000000-0000-4000-9000-0000000000e2', '00000000-0000-4000-9000-0000000000f1');

DO $$
BEGIN
  BEGIN
    INSERT INTO public.teacher_earning_entries
      (teacher_id, kind, amount_cents, consuming_entry_id, recovered_against_entry_id)
    VALUES ('00000000-0000-4000-9000-00000000000a', 'debt_recovery', 100,
            '00000000-0000-4000-9000-0000000000e2', '00000000-0000-4000-9000-0000000000f1');
    RAISE EXCEPTION 'ASSERT FAILED: second recovery for the same consuming entry accepted (double recovery)';
  EXCEPTION WHEN unique_violation THEN
    RAISE NOTICE 'ASSERT OK  [3c] second debt_recovery for one entry rejected (replay-safe)';
  END;
END $$;

INSERT INTO public.teacher_earning_entries (teacher_id, kind, amount_cents, reverses_recovery_id)
VALUES ('00000000-0000-4000-9000-00000000000a', 'debt_recovery_reversal', -400, '00000000-0000-4000-9000-0000000000f2');

DO $$
BEGIN
  BEGIN
    INSERT INTO public.teacher_earning_entries (teacher_id, kind, amount_cents, reverses_recovery_id)
    VALUES ('00000000-0000-4000-9000-00000000000a', 'debt_recovery_reversal', -400, '00000000-0000-4000-9000-0000000000f2');
    RAISE EXCEPTION 'ASSERT FAILED: duplicate reversal accepted (debt corrupted)';
  EXCEPTION WHEN unique_violation THEN
    RAISE NOTICE 'ASSERT OK  [3d] duplicate debt_recovery_reversal rejected (one per recovery)';
  END;
END $$;

-- ── 4. The signed-balance formula (spec FR-014) ─────────────────────────
-- clawback -600, recovery +400, reversal -400  ⇒  debt = 600 (recovery undone).
DO $$
DECLARE debt integer;
BEGIN
  SELECT GREATEST(0, -1 * COALESCE(SUM(amount_cents), 0)) INTO debt
    FROM public.teacher_earning_entries
   WHERE teacher_id = '00000000-0000-4000-9000-00000000000a'
     AND kind IN ('clawback','debt_recovery','debt_recovery_reversal');
  IF debt <> 600 THEN
    RAISE EXCEPTION 'ASSERT FAILED: outstanding debt = % (want 600) — sign convention broken', debt;
  END IF;
  RAISE NOTICE 'ASSERT OK  [4] outstanding_debt = 600 (-600 clawback +400 recovery -400 reversal); earnings excluded';
END $$;

-- ── 5. Hold-window eligibility: 13 days NO, 14 days YES (FR-010/SC-009) ──
DO $$
DECLARE hold_days integer; n13 integer; n14 integer;
BEGIN
  SELECT value::integer INTO hold_days FROM public.platform_settings WHERE key = 'connect_payout_hold_days';
  -- IS DISTINCT FROM, not <>: `NULL <> 14` is NULL, the IF body is skipped, and
  -- a MISSING setting would pass the assertion that exists to catch it.
  IF hold_days IS DISTINCT FROM 14 THEN RAISE EXCEPTION 'ASSERT FAILED: connect_payout_hold_days = % (want 14)', hold_days; END IF;

  SELECT count(*) INTO n13 FROM public.teacher_earning_entries e
    JOIN public.session_deliveries d ON d.id = e.session_delivery_id
   WHERE e.id = '00000000-0000-4000-9000-0000000000e1'
     AND d.delivered_at + (hold_days || ' days')::interval <= now();
  IF n13 <> 0 THEN RAISE EXCEPTION 'ASSERT FAILED: 13-day-old delivery is eligible (hold window not enforced)'; END IF;
  RAISE NOTICE 'ASSERT OK  [5a] 13-day-old delivery NOT eligible';

  SELECT count(*) INTO n14 FROM public.teacher_earning_entries e
    JOIN public.session_deliveries d ON d.id = e.session_delivery_id
   WHERE e.id = '00000000-0000-4000-9000-0000000000e2'
     AND d.delivered_at + (hold_days || ' days')::interval <= now();
  IF n14 <> 1 THEN RAISE EXCEPTION 'ASSERT FAILED: 14-day+1min-old delivery NOT eligible'; END IF;
  RAISE NOTICE 'ASSERT OK  [5b] 14-day+1min-old delivery IS eligible';
END $$;

-- Hold must remain derived from the refund window (FR-031 / SC-015).
DO $$
DECLARE hold_days integer; refund_days integer;
BEGIN
  SELECT value::integer INTO hold_days   FROM public.platform_settings WHERE key = 'connect_payout_hold_days';
  SELECT value::integer INTO refund_days FROM public.platform_settings WHERE key = 'refund_window_days';
  IF refund_days IS DISTINCT FROM 7 THEN RAISE EXCEPTION 'ASSERT FAILED: refund_window_days = % (want 7)', refund_days; END IF;
  IF hold_days IS NULL THEN RAISE EXCEPTION 'ASSERT FAILED: connect_payout_hold_days missing — sweep would have no window'; END IF;
  IF hold_days < refund_days + 7 THEN
    RAISE EXCEPTION 'ASSERT FAILED: hold (%) < refund window (%) + 7 buffer', hold_days, refund_days;
  END IF;
  RAISE NOTICE 'ASSERT OK  [5c] hold(14) >= refund_window(7) + 7 buffer — derived, not hard-coded twice';
END $$;

-- ── 6. RLS: owner / non-owner boundaries ────────────────────────────────
-- RLS denies do NOT raise: a forbidden UPDATE matches 0 rows and changes
-- nothing; a forbidden SELECT returns 0 rows. Assert exactly that.
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims',
  '{"sub":"00000000-0000-4000-9000-00000000000a","role":"authenticated"}', true);

DO $$
DECLARE n integer;
BEGIN
  SELECT count(*) INTO n FROM public.teacher_earning_entries;
  IF n < 1 THEN RAISE EXCEPTION 'ASSERT FAILED: owner cannot read own entries'; END IF;
  RAISE NOTICE 'ASSERT OK  [6a] owner reads own entries (% rows)', n;

  SELECT count(*) INTO n FROM public.teacher_transfers;
  IF n <> 1 THEN RAISE EXCEPTION 'ASSERT FAILED: owner read % transfer rows (want 1) — [6d] below would be vacuous', n; END IF;
  RAISE NOTICE 'ASSERT OK  [6a2] owner reads own transfers (1 row) — the table is NOT empty';

  SELECT count(*) INTO n FROM public.payout_holds;
  IF n <> 1 THEN RAISE EXCEPTION 'ASSERT FAILED: owner read % hold rows (want 1) — [6e] below would be vacuous', n; END IF;
  RAISE NOTICE 'ASSERT OK  [6a3] owner reads own payout_holds (1 row) — the table is NOT empty';
END $$;

DO $$
DECLARE affected integer; still_pending public.earning_entry_status;
BEGIN
  UPDATE public.teacher_earning_entries SET status = 'transferred'
   WHERE id = '00000000-0000-4000-9000-0000000000e2';
  GET DIAGNOSTICS affected = ROW_COUNT;
  IF affected <> 0 THEN
    RAISE EXCEPTION 'ASSERT FAILED: teacher self-marked an entry transferred (% rows)', affected;
  END IF;
  RESET ROLE;
  SELECT status INTO still_pending FROM public.teacher_earning_entries
   WHERE id = '00000000-0000-4000-9000-0000000000e2';
  IF still_pending <> 'pending' THEN
    RAISE EXCEPTION 'ASSERT FAILED: value changed despite 0 rows (status now %)', still_pending;
  END IF;
  RAISE NOTICE 'ASSERT OK  [6b] teacher UPDATE matches 0 rows AND value unchanged (RLS denies silently)';
END $$;

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims',
  '{"sub":"00000000-0000-4000-9000-00000000000b","role":"authenticated"}', true);

DO $$
DECLARE n integer;
BEGIN
  SELECT count(*) INTO n FROM public.teacher_earning_entries;
  IF n <> 0 THEN RAISE EXCEPTION 'ASSERT FAILED: non-owner read % entry rows (want 0)', n; END IF;
  RAISE NOTICE 'ASSERT OK  [6c] non-owner reads 0 entries';

  SELECT count(*) INTO n FROM public.teacher_transfers;
  IF n <> 0 THEN RAISE EXCEPTION 'ASSERT FAILED: non-owner read % transfer rows (want 0)', n; END IF;
  RAISE NOTICE 'ASSERT OK  [6d] non-owner reads 0 transfers';

  SELECT count(*) INTO n FROM public.payout_holds;
  IF n <> 0 THEN RAISE EXCEPTION 'ASSERT FAILED: non-owner read % hold rows (want 0)', n; END IF;
  RAISE NOTICE 'ASSERT OK  [6e] non-owner reads 0 payout_holds';
END $$;

DO $$
BEGIN
  BEGIN
    INSERT INTO public.teacher_earning_entries (teacher_id, kind, amount_cents)
    VALUES ('00000000-0000-4000-9000-00000000000b', 'clawback', -100);
    RAISE EXCEPTION 'ASSERT FAILED: authenticated INSERT into the ledger was allowed';
  EXCEPTION
    WHEN insufficient_privilege THEN
      RAISE NOTICE 'ASSERT OK  [6f] authenticated INSERT into the ledger denied';
    WHEN check_violation THEN
      RAISE EXCEPTION 'ASSERT FAILED: INSERT reached the CHECK — RLS did not block a client write';
  END;
END $$;

RESET ROLE;

-- ── 7. Anonymous sees nothing ───────────────────────────────────────────
SET LOCAL ROLE anon;
DO $$
DECLARE n integer;
BEGIN
  SELECT count(*) INTO n FROM public.teacher_earning_entries;
  IF n <> 0 THEN RAISE EXCEPTION 'ASSERT FAILED: anon read % entry rows (want 0)', n; END IF;
  RAISE NOTICE 'ASSERT OK  [7] anonymous reads 0 entries';

  SELECT count(*) INTO n FROM public.teacher_transfers;
  IF n <> 0 THEN RAISE EXCEPTION 'ASSERT FAILED: anon read % transfer rows (want 0)', n; END IF;
  RAISE NOTICE 'ASSERT OK  [7b] anonymous reads 0 transfers';

  SELECT count(*) INTO n FROM public.payout_holds;
  IF n <> 0 THEN RAISE EXCEPTION 'ASSERT FAILED: anon read % hold rows (want 0)', n; END IF;
  RAISE NOTICE 'ASSERT OK  [7c] anonymous reads 0 payout_holds';
END $$;
RESET ROLE;

-- ── 8. Transfer identity is entry-scoped (covers course earnings) ───────
-- The transfer for e2 (id t1) is seeded at the top of this walk — the RLS
-- section needs the table non-empty before any role switch. These assertions
-- build on that row.
DO $$
BEGIN
  BEGIN
    INSERT INTO public.teacher_transfers (entry_id, teacher_id, kind, amount_cents, idempotency_key)
    VALUES ('00000000-0000-4000-9000-0000000000e2', '00000000-0000-4000-9000-00000000000a',
            'transfer', 1000, 'transfer:different-key');
    RAISE EXCEPTION 'ASSERT FAILED: second transfer for one entry accepted (double pay)';
  EXCEPTION WHEN unique_violation THEN
    RAISE NOTICE 'ASSERT OK  [8a] second transfer for the same entry rejected';
  END;
  BEGIN
    INSERT INTO public.teacher_transfers (entry_id, teacher_id, kind, amount_cents, idempotency_key)
    VALUES ('00000000-0000-4000-9000-0000000000e1', '00000000-0000-4000-9000-00000000000a',
            'transfer', 1000, 'transfer:00000000-0000-4000-9000-0000000000e2');
    RAISE EXCEPTION 'ASSERT FAILED: duplicate idempotency_key accepted';
  EXCEPTION WHEN unique_violation THEN
    RAISE NOTICE 'ASSERT OK  [8b] duplicate idempotency_key rejected';
  END;
END $$;

-- A COURSE earning (no session_delivery_id) can carry a transfer — the defect
-- that an entry-scoped identity fixes.
-- payments enforces amount_usd = amount_before_tax + tax_amount.
-- payments enforces amount_usd = amount_before_tax + tax_amount, and a
-- provider/reference pairing (stripe ⇒ stripe_payment_intent NOT NULL).
INSERT INTO public.payments (id, student_id, amount_usd, amount_before_tax, tax_amount, provider, stripe_payment_intent)
VALUES ('00000000-0000-4000-9000-0000000000a1', '00000000-0000-4000-9000-00000000000b',
        49.00, 49.00, 0.00, 'stripe', 'pi_walk_040_course');

INSERT INTO public.teacher_earning_entries (id, teacher_id, kind, amount_cents, payment_id)
VALUES ('00000000-0000-4000-9000-0000000000e3', '00000000-0000-4000-9000-00000000000a', 'course', 3430,
        '00000000-0000-4000-9000-0000000000a1');

INSERT INTO public.teacher_transfers (entry_id, teacher_id, kind, amount_cents, idempotency_key)
VALUES ('00000000-0000-4000-9000-0000000000e3', '00000000-0000-4000-9000-00000000000a', 'transfer', 3430,
        'transfer:00000000-0000-4000-9000-0000000000e3');

DO $$
BEGIN
  BEGIN
    INSERT INTO public.teacher_transfers (entry_id, teacher_id, kind, amount_cents, idempotency_key)
    VALUES ('00000000-0000-4000-9000-0000000000e3', '00000000-0000-4000-9000-00000000000a', 'transfer', 3430,
            'transfer:course-dup');
    RAISE EXCEPTION 'ASSERT FAILED: course entry could be transferred twice';
  EXCEPTION WHEN unique_violation THEN
    RAISE NOTICE 'ASSERT OK  [8c] course earning is transfer-protected too (entry-scoped identity)';
  END;
END $$;

-- ── 8d. The transfer immutability trigger must BITE (mutation-tested) ───
-- Uniqueness (8a–8c) says nothing about immutability. Mutate each protected
-- column and require a RAISE; then prove the lifecycle columns still move.
DO $$
BEGIN
  BEGIN
    UPDATE public.teacher_transfers SET amount_cents = 999999
     WHERE id = '00000000-0000-4000-9000-00000000001a';
    RAISE EXCEPTION 'ASSERT FAILED: transfer amount_cents was mutable';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM LIKE 'ASSERT FAILED%' THEN RAISE; END IF;
    RAISE NOTICE 'ASSERT OK  [8d] transfer amount_cents UPDATE raises';
  END;
  BEGIN
    UPDATE public.teacher_transfers SET entry_id = '00000000-0000-4000-9000-0000000000e1'
     WHERE id = '00000000-0000-4000-9000-00000000001a';
    RAISE EXCEPTION 'ASSERT FAILED: transfer entry_id was mutable (transfer could be re-pointed)';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM LIKE 'ASSERT FAILED%' THEN RAISE; END IF;
    RAISE NOTICE 'ASSERT OK  [8e] transfer entry_id UPDATE raises (cannot be re-pointed)';
  END;
  BEGIN
    UPDATE public.teacher_transfers SET transfer_group = 'tg_tampered'
     WHERE id = '00000000-0000-4000-9000-00000000001a';
    RAISE EXCEPTION 'ASSERT FAILED: transfer transfer_group was mutable (Stripe trace forgeable)';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM LIKE 'ASSERT FAILED%' THEN RAISE; END IF;
    RAISE NOTICE 'ASSERT OK  [8f] transfer transfer_group UPDATE raises (Stripe trace frozen)';
  END;
END $$;

-- Reconciliation must still work: the transfer.* webhook writes exactly these.
UPDATE public.teacher_transfers
   SET status = 'succeeded', stripe_transfer_id = 'tr_walk_040'
 WHERE id = '00000000-0000-4000-9000-00000000001a';
DO $$
DECLARE st public.teacher_transfer_status;
BEGIN
  SELECT status INTO st FROM public.teacher_transfers
   WHERE id = '00000000-0000-4000-9000-00000000001a';
  IF st IS DISTINCT FROM 'succeeded' THEN
    RAISE EXCEPTION 'ASSERT FAILED: transfer status not updatable (webhook reconciliation impossible), got %', st;
  END IF;
  RAISE NOTICE 'ASSERT OK  [8g] transfer status/stripe_transfer_id remain updatable (reconciliation works)';
END $$;

-- ── 9. Manual settlement evidence is all-or-nothing ─────────────────────
-- Rejecting the no-evidence case alone does not prove the three columns are
-- JOINTLY required. Each partial combination must also be rejected, and the
-- complete one accepted — otherwise a half-evidenced payout could be recorded.
DO $$
BEGIN
  BEGIN
    UPDATE public.teacher_earning_entries SET status = 'manual_paid'
     WHERE id = '00000000-0000-4000-9000-0000000000e1';
    RAISE EXCEPTION 'ASSERT FAILED: manual_paid with NO evidence accepted';
  EXCEPTION WHEN check_violation THEN
    RAISE NOTICE 'ASSERT OK  [9a] manual_paid with no evidence rejected';
  END;
  BEGIN
    UPDATE public.teacher_earning_entries
       SET status = 'manual_paid', external_reference_id = 'WIRE-1'
     WHERE id = '00000000-0000-4000-9000-0000000000e1';
    RAISE EXCEPTION 'ASSERT FAILED: manual_paid with reference only accepted (no settler, no timestamp)';
  EXCEPTION WHEN check_violation THEN
    RAISE NOTICE 'ASSERT OK  [9b] manual_paid with reference ONLY rejected';
  END;
  BEGIN
    UPDATE public.teacher_earning_entries
       SET status = 'manual_paid', external_reference_id = 'WIRE-1',
           settled_by = '00000000-0000-4000-9000-00000000000b'
     WHERE id = '00000000-0000-4000-9000-0000000000e1';
    RAISE EXCEPTION 'ASSERT FAILED: manual_paid without settled_at accepted';
  EXCEPTION WHEN check_violation THEN
    RAISE NOTICE 'ASSERT OK  [9c] manual_paid with reference + settler but NO timestamp rejected';
  END;
  BEGIN
    UPDATE public.teacher_earning_entries
       SET status = 'manual_paid', settled_by = '00000000-0000-4000-9000-00000000000b',
           settled_at = now()
     WHERE id = '00000000-0000-4000-9000-0000000000e1';
    RAISE EXCEPTION 'ASSERT FAILED: manual_paid without a reference accepted';
  EXCEPTION WHEN check_violation THEN
    RAISE NOTICE 'ASSERT OK  [9d] manual_paid with settler + timestamp but NO reference rejected';
  END;
  -- Every OTHER column is valid here on purpose, so chk_entry_manual_settlement
  -- is SATISFIED and only chk_entry_reference_nonblank can reject the row.
  -- Omitting settled_by would trip both, and the assertion would survive the
  -- blank-check being deleted.
  BEGIN
    UPDATE public.teacher_earning_entries
       SET status = 'manual_paid', external_reference_id = '   ',
           settled_by = '00000000-0000-4000-9000-00000000000b', settled_at = now()
     WHERE id = '00000000-0000-4000-9000-0000000000e1';
    RAISE EXCEPTION 'ASSERT FAILED: blank external_reference_id accepted (unauditable settlement)';
  EXCEPTION WHEN check_violation THEN
    RAISE NOTICE 'ASSERT OK  [9e] whitespace-only reference rejected (only the blank-check can fire here)';
  END;
END $$;

-- The complete evidence set MUST be accepted, or the manual rail is unusable.
UPDATE public.teacher_earning_entries
   SET status = 'manual_paid', external_reference_id = 'WIRE-1',
       settled_by = '00000000-0000-4000-9000-00000000000b', settled_at = now()
 WHERE id = '00000000-0000-4000-9000-0000000000e1';
DO $$
DECLARE st public.earning_entry_status;
BEGIN
  SELECT status INTO st FROM public.teacher_earning_entries
   WHERE id = '00000000-0000-4000-9000-0000000000e1';
  IF st IS DISTINCT FROM 'manual_paid' THEN
    RAISE EXCEPTION 'ASSERT FAILED: complete evidence set was rejected (manual rail unusable), status %', st;
  END IF;
  RAISE NOTICE 'ASSERT OK  [9f] reference + settler + timestamp together ACCEPTED (manual rail works)';
END $$;

-- ── 9g. payout_holds attribution (audit trail for the legal-hold predicate) ──
DO $$
BEGIN
  BEGIN
    INSERT INTO public.payout_holds (teacher_id, source, reason)
    VALUES ('00000000-0000-4000-9000-00000000000a', 'admin', 'no creator named');
    RAISE EXCEPTION 'ASSERT FAILED: admin hold without created_by accepted (unattributable)';
  EXCEPTION WHEN check_violation THEN
    RAISE NOTICE 'ASSERT OK  [9g] admin hold requires created_by';
  END;
  BEGIN
    UPDATE public.payout_holds SET released_at = now()
     WHERE id = '00000000-0000-4000-9000-00000000001b';
    RAISE EXCEPTION 'ASSERT FAILED: hold released with no releaser named';
  EXCEPTION WHEN check_violation THEN
    RAISE NOTICE 'ASSERT OK  [9h] release requires released_by (paired attribution)';
  END;
END $$;

-- A dispute hold (webhook-created, no human actor) must still be insertable —
-- the deliberate exemption in chk_payout_hold_admin_creator.
INSERT INTO public.payout_holds (teacher_id, source, reason)
VALUES ('00000000-0000-4000-9000-00000000000a', 'dispute', 'chargeback opened');
DO $$
DECLARE n integer;
BEGIN
  SELECT count(*) INTO n FROM public.payout_holds
   WHERE teacher_id = '00000000-0000-4000-9000-00000000000a' AND source = 'dispute';
  IF n <> 2 THEN RAISE EXCEPTION 'ASSERT FAILED: dispute hold without created_by rejected (webhook path broken), n=%', n; END IF;
  RAISE NOTICE 'ASSERT OK  [9i] dispute hold without created_by accepted (webhook has no human actor)';
END $$;

-- ── 10. Dormancy: the Connect path is inert until cutover ───────────────
DO $$
DECLARE cutover text;
BEGIN
  SELECT value INTO cutover FROM public.platform_settings WHERE key = 'connect_cutover_date';
  IF cutover IS NOT NULL AND btrim(cutover) <> '' THEN
    RAISE EXCEPTION 'ASSERT FAILED: connect_cutover_date is set (%) — the new path is NOT dormant', cutover;
  END IF;
  RAISE NOTICE 'ASSERT OK  [10] connect_cutover_date unset — Connect path dormant in this DB';
END $$;

ROLLBACK;
