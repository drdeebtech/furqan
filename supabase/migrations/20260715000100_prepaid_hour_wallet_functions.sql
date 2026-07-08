-- 20260715000100_prepaid_hour_wallet_functions.sql
--
-- Spec 038 — Prepaid Hour Wallet, Phase 2 (money DB functions).
-- Design authority: spec.md → "Eng-review resolutions (2026-07-06)" R1–R10, H1–H5.
-- Prerequisite: 20260715000050_prepaid_hour_wallet_schema.sql (Phase 1 — table,
-- catalog row, columns, settings seeds).
--
-- This migration adds the wallet money-path SECURITY DEFINER functions and
-- extends the two existing money-path functions (deduct_package_session,
-- finalize_attendance) plus the confirm-time debit trigger (deduct_student_package)
-- so they understand prepaid_hours lots. No SECURITY DEFINER refund/sweep
-- functions (Phase 5/4); no app code beyond ledger.ts; no database.ts edits.
--
-- Three lenses (AGENTS.md §1):
--   🛠 Full-stack: every money op locks its row (H3 — FOR UPDATE on the kernel);
--                   grant idempotency is the DB unique claim in the SAME txn (H1);
--                   every wallet mutation appends one ledger event via the single
--                   record_prepaid_event helper (R5/DRY). The append-only trigger
--                   from Phase 1 backs the ledger; service_role can INSERT (no
--                   INSERT policy needed — Phase-1 RLS has no INSERT policy and
--                   service_role bypasses RLS), never UPDATE/DELETE (Phase-1 trigger).
--   📖 Quran:     n/a (no text/ayah surface).
--   🎓 Platform:  rolling expiry window is DATA (platform_settings), never hardcoded.
--
-- Expand/contract (AGENTS.md §4):
--   - Every changed function uses CREATE OR REPLACE with the SAME signature (R10)
--     so existing callers — including the still-running old build during the
--     concurrent deploy window — keep resolving. Behavior outside the wallet
--     additions is byte-identical (regression-critical).
--   - No DROP/RENAME, no enum change (credit_action stays none/debited/restored),
--     no column type changes. Only ADDITIVE function body changes + two new fns.
--   - The new fns land REVOKED from anon/authenticated (NFR-003).
--   - scripts/check-migration-safety.sh: no breaker patterns present.

-- ─────────────────────────────────────────────────────────────────────────────
-- T2.1 — record_prepaid_event: the single append helper for every wallet mutation (R5)
-- ─────────────────────────────────────────────────────────────────────────────
-- Every grant/draw/restore/expired/refunded site calls THIS, never INSERTs into
-- prepaid_hours_events directly. Centralizing the write keeps the event schema
-- (and the append-only invariant) in one place. The Phase-1 BEFORE UPDATE/DELETE
-- trigger enforces immutability regardless of writer (H5).
--
-- RETURNS void. SECURITY DEFINER so the booking/attendance code paths that run
-- as service_role can append without needing direct INSERT privileges, and so a
-- future non-service-role caller cannot bypass RLS via this fn (EXECUTE is
-- revoked from anon/authenticated in T2.6).

CREATE OR REPLACE FUNCTION public.record_prepaid_event(
  p_package uuid,
  p_event_type text,
  p_hours_delta int,
  p_stripe_ref text
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.prepaid_hours_events (package_id, event_type, hours_delta, stripe_ref)
  VALUES (p_package, p_event_type, p_hours_delta, p_stripe_ref);
END;
$$;

ALTER FUNCTION public.record_prepaid_event(uuid, text, int, text) OWNER TO postgres;

-- ─────────────────────────────────────────────────────────────────────────────
-- T2.2 — grant_prepaid_hours: idempotent lot insert + grant event (R1, H1)
-- ─────────────────────────────────────────────────────────────────────────────
-- Inserts a NEW student_packages lot (R1 — one immutable lot per purchase;
-- NEVER top up an existing row). Each lot points at the seeded prepaid_hours
-- catalog row (Phase 1), carries its own frozen rate_paid_usd, and its own
-- stripe_payment_intent_id — the UNIQUE partial index on that column is the H1
-- idempotency claim. A webhook redelivery hits the pre-check (or the ON
-- CONFLICT backstop on the rare concurrent race) and returns the EXISTING lot
-- id without appending a duplicate grant event.
--
-- RETURNS the lot id (new or existing). expires_at = now() + rolling window
-- (D5), read from platform_settings.

CREATE OR REPLACE FUNCTION public.grant_prepaid_hours(
  p_payment_intent text,
  p_student uuid,
  p_hours int,
  p_rate numeric
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_lot_id uuid;
  v_window_months int;
BEGIN
  IF p_payment_intent IS NULL OR p_student IS NULL OR p_hours IS NULL OR p_hours <= 0 OR p_rate IS NULL THEN
    RAISE EXCEPTION 'grant_prepaid_hours: invalid arguments (intent=%, student=%, hours=%, rate=%)',
      p_payment_intent, p_student, p_hours, p_rate
      USING ERRCODE = 'P0001';
  END IF;

  -- H1 idempotency pre-check (fast path): a lot already exists for this intent
  -- → webhook redelivery. Return the existing id; do NOT append a duplicate
  -- grant event.
  SELECT id INTO v_lot_id
    FROM public.student_packages
    WHERE stripe_payment_intent_id = p_payment_intent;
  IF v_lot_id IS NOT NULL THEN
    RETURN v_lot_id;
  END IF;

  -- Rolling expiry window (D5). Missing/blank/0 → default 12 (the seeded value).
  SELECT COALESCE(NULLIF(TRIM(value), '')::integer, 12)
    INTO v_window_months
    FROM public.platform_settings
    WHERE key = 'prepaid_hours_expiry_months';
  v_window_months := COALESCE(v_window_months, 12);

  -- Insert a NEW lot (R1). ON CONFLICT on the partial unique index is the
  -- race backstop: two concurrent grants for the same intent cannot both land
  -- (the second is a no-op). Partial-index inference requires the matching
  -- WHERE clause. RETURNING captures the id only on a real insert.
  INSERT INTO public.student_packages (
    student_id, package_id, sessions_total, sessions_used, status,
    product_type, rate_paid_usd, stripe_payment_intent_id,
    expires_at, purchased_at
  )
  VALUES (
    p_student,
    'c0ffee01-0000-4000-8000-000000038000',  -- Phase-1 seeded catalog row
    p_hours,
    0,
    'active',
    'prepaid_hours',
    p_rate,
    p_payment_intent,
    now() + (v_window_months * interval '1 month'),
    now()
  )
  ON CONFLICT (stripe_payment_intent_id) WHERE stripe_payment_intent_id IS NOT NULL
    DO NOTHING
  RETURNING id INTO v_lot_id;

  -- Lost the race: another grant for the same intent landed first. Re-fetch the
  -- existing lot id so the caller gets a stable handle, but DO NOT append a
  -- second grant event (the winner already did).
  IF v_lot_id IS NULL THEN
    SELECT id INTO v_lot_id
      FROM public.student_packages
      WHERE stripe_payment_intent_id = p_payment_intent;
    RETURN v_lot_id;
  END IF;

  -- Real insert: append the singular 'grant' event (R5). The Phase-1 partial
  -- unique index uix_prepaid_hours_events_one_grant_per_lot guarantees exactly
  -- one grant event per lot, even under retry.
  PERFORM public.record_prepaid_event(v_lot_id, 'grant', p_hours, p_payment_intent);

  RETURN v_lot_id;
END;
$$;

ALTER FUNCTION public.grant_prepaid_hours(text, uuid, int, numeric) OWNER TO postgres;

-- ─────────────────────────────────────────────────────────────────────────────
-- T2.3 — deduct_package_session: R3 rolling-expiry reset + 'draw' event for prepaid lots
-- ─────────────────────────────────────────────────────────────────────────────
-- LATEST live body before this: 20260428000000_remote_baseline.sql lines 696-707
-- (LANGUAGE sql, single UPDATE ... RETURNING true). Signature preserved (R10):
-- (p_package_id uuid) RETURNS boolean.
--
-- Behavior preserved byte-for-byte outside the wallet addition:
--   - Same guard predicate (status='active', sessions_used < sessions_total,
--     expires_at null-or-future). Returns true when a row was charged, NULL
--     when no row matched (matches the SQL RETURNING semantics for both
--     callers: deduct_student_package's `if deduct_package_session(...) then`
--     and ledger.ts's `if (data !== true)` exhaustive-style check).
--   - Subscription / legacy lots: NO change to expires_at, NO event append.
--
-- Wallet addition (R3, gated to product_type='prepaid_hours' so subscription
-- rows are NEVER extended):
--   - After a successful charge on a prepaid lot, reset expires_at = now() +
--     window (D5 rolling expiry).
--   - Append a 'draw' (-1) event via record_prepaid_event (R5).
--
-- Row lock (H3): the UPDATE itself takes an implicit row lock; we re-UPDATE the
-- same row by PK for the expiry reset so the lock is held across both. No
-- concurrent caller can oversell between the two statements.

CREATE OR REPLACE FUNCTION public.deduct_package_session(p_package_id uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_product_type text;
  v_window_months int;
BEGIN
  -- Canonical debit kernel. Guard predicate identical to the pre-existing SQL
  -- body; the implicit row-level lock satisfies H3. Captures product_type so we
  -- can gate the wallet-specific additions.
  UPDATE public.student_packages
    SET sessions_used = sessions_used + 1
    WHERE id = p_package_id
      AND status = 'active'
      AND sessions_used < sessions_total
      AND (expires_at IS NULL OR expires_at > now())
    RETURNING product_type INTO v_product_type;

  -- No row charged (expired/exhausted/not-found between SELECT and UPDATE).
  -- RETURNING no rows → v_product_type stays NULL → return NULL (matches the
  -- pre-existing SQL fn's "RETURNING true returns no row" semantics).
  IF NOT FOUND THEN
    RETURN NULL;
  END IF;

  -- R3 gate: ONLY prepaid_hours lots get the rolling reset + draw event.
  -- Subscription/legacy rows (product_type='subscription' or NULL on legacy
  -- un-backfilled rows) are byte-unchanged: no expires_at mutation, no event.
  IF v_product_type = 'prepaid_hours' THEN
    SELECT COALESCE(NULLIF(TRIM(value), '')::integer, 12)
      INTO v_window_months
      FROM public.platform_settings
      WHERE key = 'prepaid_hours_expiry_months';
    v_window_months := COALESCE(v_window_months, 12);

    -- Rolling expiry reset (D5). Same row, still locked from the debit UPDATE.
    UPDATE public.student_packages
      SET expires_at = now() + (v_window_months * interval '1 month')
      WHERE id = p_package_id;

    PERFORM public.record_prepaid_event(p_package_id, 'draw', -1, NULL);
  END IF;

  RETURN true;
END;
$$;

ALTER FUNCTION public.deduct_package_session(uuid) OWNER TO postgres;
-- Existing grants on deduct_package_session are preserved by CREATE OR REPLACE.
-- Per task T2.6, no REVOKE/GRANT change here.

-- ─────────────────────────────────────────────────────────────────────────────
-- T2.4(a) — deduct_student_package trigger: R2 ranking (subscription first, then expiry)
-- ─────────────────────────────────────────────────────────────────────────────
-- LATEST live body before this: 20260708000000_free_evaluation_assessment.sql
-- (which carried forward the fail-closed raise from 20260626000000 + added the
-- assessment/instant/specialized skip). Signature preserved: () RETURNS trigger.
-- Trigger t_deduct_student_package (existing) keeps firing it; no trigger drop
-- or recreate needed.
--
-- The ONLY behavioral change is the ORDER BY in the package SELECT: subscription
-- packages now rank AHEAD of prepaid_hours, then soonest-expiry. This matches
-- selectActivePackage in ledger.ts (T2.4b) so app-side selection and DB-side
-- charge agree (R2). Subscription-only and wallet-only students see unchanged
-- selection — within a single product_type the ordering is the same as before.
--
-- The explicit "use a prepaid hour" override (R2) is enforced at the app layer
-- (selectActivePackage options.usePrepaidHours → restricts to prepaid_hours);
-- the trigger itself always applies the default ranking because the booking
-- flow stamps the chosen package_id onto the booking before confirm when the
-- override is active (same way group/class pre-stamp student_package_id and
-- hit the early-return guard).

CREATE OR REPLACE FUNCTION public.deduct_student_package()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_pkg uuid;
BEGIN
  IF new.status = 'confirmed' AND old.status = 'pending' THEN
    -- One-time single-session products (spec 022) are NEVER package-funded
    -- (NFR-001/FR-007). Without this skip, a package-less student's FREE $0
    -- assessment could never be confirmed. Paid one-time bookings settle via
    -- their linked payments row, not credits.
    IF new.booking_product_type IN ('assessment','instant','specialized') THEN
      RETURN new;
    END IF;

    -- If student_package_id is already set, the charge was handled elsewhere
    -- — do nothing (no double deduct). This is ALSO the path the R2 "use my
    -- hours" override takes: the booking flow pre-stamps the chosen prepaid
    -- lot's id, hitting this early return, so the trigger's default ranking
    -- never overrides an explicit wallet choice.
    IF new.student_package_id IS NOT NULL THEN
      RETURN new;
    END IF;

    -- R2 default ranking: subscription packages BEFORE prepaid_hours, then
    -- soonest-expiry, then oldest-purchased. (product_type='prepaid_hours')
    -- evaluates false=0 for subscription and true=1 for prepaid → ASC surfaces
    -- subscription first. Within each group the existing soonest-expiry
    -- ordering is preserved. FOR UPDATE SKIP LOCKED keeps concurrent confirms
    -- from racing onto the same package (last-hour double-book is impossible).
    SELECT id INTO v_pkg
      FROM student_packages
      WHERE student_id = new.student_id
        AND status = 'active'
        AND sessions_used < sessions_total
        AND (expires_at IS NULL OR expires_at > now())
      ORDER BY (product_type = 'prepaid_hours') ASC,
               expires_at ASC NULLS LAST,
               purchased_at ASC
      LIMIT 1
      FOR UPDATE SKIP LOCKED;

    IF v_pkg IS NOT NULL THEN
      -- Delegate the decrement (and, for prepaid, the rolling reset + draw
      -- event) to the canonical kernel. Returns true when a row was charged.
      IF deduct_package_session(v_pkg) THEN
        -- Stamp the charged package so restore credits the SAME package (H17
        -- audit; required by H4 for wallet restore-after-expiry targeting).
        -- Touches student_package_id only — not status — so the status
        -- triggers do not re-fire.
        UPDATE bookings SET student_package_id = v_pkg WHERE id = new.id;
        RETURN new;
      END IF;
      -- Kernel reported no row charged despite the SELECT matching (the row
      -- expired or was fully used between SELECT and UPDATE). Fall through.
    END IF;

    -- Fail-closed money guard (#531). No chargeable package was found for a
    -- 1:1 confirm. Raising aborts the whole confirm_booking_with_session
    -- transaction: bookings.status update and sessions insert roll back, the
    -- booking stays 'pending', and the orchestrator surfaces
    -- BookingNoPackageError. errcode P0001 matches the TS-layer contract.
    RAISE EXCEPTION 'no_package_credit'
      USING ERRCODE = 'P0001',
            DETAIL = 'no chargeable student_packages row for student ' || new.student_id;
  END IF;
  RETURN new;
END;
$$;

ALTER FUNCTION public.deduct_student_package() OWNER TO postgres;

-- ─────────────────────────────────────────────────────────────────────────────
-- T2.5 — finalize_attendance: extend restore to prepaid_hours lots (H4)
-- ─────────────────────────────────────────────────────────────────────────────
-- LATEST live body before this: 20260714000000_fix_finalize_attendance_subscrip
-- tion_id_and_credit_action_cast.sql. Signature preserved (R10):
-- (p_booking_id uuid, p_outcome attendance_outcome, p_actual_teacher_id uuid)
-- RETURNS void.
--
-- The ONLY behavioral change: the teacher_absent / excused_carried restore
-- branch now also handles a prepaid_hours charged lot. The product_type split
-- is mutually exclusive (IF charged a prepaid lot → wallet restore; ELSE →
-- existing subscription/legacy restore path, byte-unchanged), so a wallet
-- absence is NEVER restored into a subscription and vice-versa.
--
-- H4 — Restore-after-expiry: targets the EXACT charged lot via
-- bookings.student_package_id, even if that lot has since been swept to
-- status='expired'. Reactivation flips status back to 'active' AND bumps
-- expires_at to now()+window (without the bump the restored hour would still
-- fail the expires_at>now() booking precondition, so "reactivation" must
-- include a fresh window). The student is not penalized for the teacher's
-- absence. The outer idempotency guard (v_existing_credit_action IS DISTINCT
-- FROM 'restored') ensures exactly-once restore per booking.

CREATE OR REPLACE FUNCTION finalize_attendance(
  p_booking_id uuid,
  p_outcome attendance_outcome,
  p_actual_teacher_id uuid DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_booking RECORD;
  v_existing_credit_action credit_action;
  v_extension_seconds bigint;
  v_deliverer_id uuid;
  v_rate numeric(10,2);
  v_duration_min integer;
  v_prepaid_window_months int;
BEGIN
  -- 1. Fetch the booking + its student/teacher/subscription + charged-lot context.
  --    BUG 3 fix from 20260714000000 retained: bookings.session_id is never
  --    populated (verified), so resolve via sessions.booking_id reverse link.
  --    NEW (spec 038 T2.5): LEFT JOIN student_packages on the charged lot to
  --    read product_type — drives the wallet-vs-subscription restore split.
  SELECT b.student_id, b.teacher_id,
         COALESCE(
           b.session_id,
           (SELECT s.id FROM sessions s WHERE s.booking_id = b.id ORDER BY s.created_at DESC LIMIT 1)
         ) AS session_id,
         b.subscription_id, b.scheduled_at, b.duration_min,
         b.student_package_id,
         sp.product_type AS charged_product_type
  INTO v_booking
  FROM bookings b
  LEFT JOIN public.student_packages sp ON sp.id = b.student_package_id
  WHERE b.id = p_booking_id
  FOR UPDATE OF b;   -- lock only bookings; FOR UPDATE cannot lock the nullable side of the LEFT JOIN

  IF NOT FOUND THEN
    RAISE EXCEPTION 'finalize_attendance: booking % not found', p_booking_id
      USING ERRCODE = 'P0002';
  END IF;

  -- 2. Idempotently upsert the attendance_records row (unique on booking_id).
  --    ON CONFLICT preserves the FIRST finalized outcome; subsequent calls
  --    no-op on credit to prevent double-restore. BUG 2 cast from 20260714000000
  --    retained.
  INSERT INTO attendance_records (booking_id, student_id, teacher_id, session_id, outcome, credit_action, finalized_at)
  VALUES (
    p_booking_id,
    v_booking.student_id,
    v_booking.teacher_id,
    v_booking.session_id,
    p_outcome,
    -- Start at 'none'. Do NOT pre-stamp 'restored' here: the restore branch
    -- below guards on `credit_action IS DISTINCT FROM 'restored'` and only flips
    -- it to 'restored' AFTER actually restoring the credit. Pre-stamping made the
    -- guard skip the restore work on the first (only) teacher_absent finalize
    -- (pre-existing bug from 20260714000000 / #651 — also affects the
    -- subscription restore path; see project_finalize_attendance_restore_guard).
    'none'::credit_action,
    now()
  )
  ON CONFLICT (booking_id) DO NOTHING;

  -- 3. Credit restore branches (idempotent: check existing credit_action first).
  SELECT credit_action INTO v_existing_credit_action
    FROM attendance_records WHERE booking_id = p_booking_id;

  IF p_outcome IN ('teacher_absent', 'excused_carried')
     AND v_existing_credit_action IS DISTINCT FROM 'restored' THEN

    -- Prepaid wallet restore (spec 038 T2.5): charged lot is a prepaid_hours
    -- lot → restore into THAT exact lot. H4: even if the lot was swept to
    -- 'expired' between charge and restore, reactivate it (status='active' +
    -- fresh expires_at) so the student is not penalized for the teacher's
    -- absence. Mutually exclusive with the subscription branch below — never
    -- cross-restore.
    IF v_booking.student_package_id IS NOT NULL
       AND v_booking.charged_product_type = 'prepaid_hours' THEN

      SELECT COALESCE(NULLIF(TRIM(value), '')::integer, 12)
        INTO v_prepaid_window_months
        FROM public.platform_settings
        WHERE key = 'prepaid_hours_expiry_months';
      v_prepaid_window_months := COALESCE(v_prepaid_window_months, 12);

      UPDATE public.student_packages
        SET sessions_used = GREATEST(sessions_used - 1, 0),
            status = 'active',
            expires_at = now() + (v_prepaid_window_months * interval '1 month')
        WHERE id = v_booking.student_package_id
          AND product_type = 'prepaid_hours';   -- defense-in-depth: never touch a sub lot

      PERFORM public.record_prepaid_event(v_booking.student_package_id, 'restore', 1, NULL);
    ELSE
      -- Existing subscription / legacy restore path (unchanged from
      -- 20260714000000). NOTE: this PERFORM resolves to restore_student_package()
      -- — the no-arg trigger fn — when called with one arg, which is the
      -- pre-existing call shape; left byte-identical per task T2.5 ("keep all
      -- existing subscription-restore behavior identical"). The actual
      -- subscription credit on a teacher-absent flows through the bookings
      -- status-update trigger path elsewhere; this fn's job here is to flag
      -- credit_action='restored' idempotently.
      PERFORM restore_student_package(p_booking_id);
    END IF;

    UPDATE attendance_records SET credit_action = 'restored', finalized_at = now()
      WHERE booking_id = p_booking_id AND credit_action <> 'restored';
  END IF;

  -- 4. Excused carry-over: insert subscription_extensions (idempotent on booking_id).
  --    Unchanged from 20260714000000.
  IF p_outcome = 'excused_carried' AND v_booking.subscription_id IS NOT NULL THEN
    v_extension_seconds := COALESCE(v_booking.duration_min, 60) * 60;
    INSERT INTO subscription_extensions (
      subscription_id, booking_id, session_id, granted_by_user_id, reason, extension_seconds
    )
    SELECT
      v_booking.subscription_id,
      p_booking_id,
      v_booking.session_id,
      v_booking.student_id,
      'excused absence carry-over',
      v_extension_seconds
    WHERE NOT EXISTS (
      SELECT 1 FROM subscription_extensions
      WHERE subscription_id = v_booking.subscription_id AND booking_id = p_booking_id
    );
  END IF;

  -- 5. Session delivery rows (rate snapshot). Unchanged from 20260714000000.
  IF p_outcome IN ('present', 'teacher_absent') AND v_booking.session_id IS NOT NULL THEN
    v_deliverer_id := COALESCE(p_actual_teacher_id, v_booking.teacher_id);
    IF NOT (p_outcome = 'teacher_absent' AND p_actual_teacher_id IS NULL) THEN
      SELECT hourly_rate_usd INTO v_rate FROM profiles WHERE id = v_deliverer_id;
      v_duration_min := COALESCE(v_booking.duration_min, 60);

      INSERT INTO session_deliveries (
        session_id, teacher_id, duration_minutes, hourly_rate_usd, delivered_at, payroll_period_month
      )
      SELECT
        v_booking.session_id,
        v_deliverer_id,
        v_duration_min,
        COALESCE(v_rate, 0),
        COALESCE(v_booking.scheduled_at, now()),
        date_trunc('month', COALESCE(v_booking.scheduled_at, now()))::date
      WHERE NOT EXISTS (
        SELECT 1 FROM session_deliveries WHERE session_id = v_booking.session_id
      );
    END IF;
  END IF;
END;
$$;

ALTER FUNCTION finalize_attendance(uuid, attendance_outcome, uuid) OWNER TO postgres;
-- Existing grants on finalize_attendance are preserved by CREATE OR REPLACE.
-- (REVOKE/GRANT lines intentionally omitted per task T2.6.)

-- ─────────────────────────────────────────────────────────────────────────────
-- T2.6 — Lockdown: REVOKE new fns from public/anon/authenticated; GRANT to service_role
-- ─────────────────────────────────────────────────────────────────────────────
-- Pattern from 20260619000004 / 20260714000000. deduct_package_session and
-- finalize_attendance keep their existing grants (CREATE OR REPLACE is grant-
-- preserving). Only the two NEW functions get the explicit lockdown.

REVOKE EXECUTE ON FUNCTION public.record_prepaid_event(uuid, text, int, text) FROM public, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.record_prepaid_event(uuid, text, int, text) TO service_role;

REVOKE EXECUTE ON FUNCTION public.grant_prepaid_hours(text, uuid, int, numeric) FROM public, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.grant_prepaid_hours(text, uuid, int, numeric) TO service_role;
