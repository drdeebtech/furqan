-- Fix three latent bugs in finalize_attendance (spec 019 payroll/attendance).
--
-- Discovered 2026-07-06 by rebuilding a staging DB from the faithful prod schema
-- and walking the money/attendance chain: finalize_attendance threw on EVERY call
-- (bugs 1 & 2), and even once it ran, teacher-payroll accrual (session_deliveries)
-- silently never happened (bug 3). Net effect in production: attendance recording
-- and teacher payroll are broken.
--
-- BUG 1 — missing column. finalize_attendance (migration 20260619000004) reads
--   `SELECT b.subscription_id FROM bookings b` and uses it for the excused_carried
--   carry-over branch, but NO migration ever added bookings.subscription_id. Because
--   the function was created with check_function_bodies=off, the phantom reference
--   was accepted at CREATE time and only failed at runtime
--   ("column b.subscription_id does not exist"). Add the column (nullable, FK to
--   subscriptions, NO ACTION on delete — matching student_packages.subscription_id).
--
-- BUG 2 — enum cast. The attendance_records INSERT builds credit_action from
--   `CASE ... THEN 'restored' ELSE 'none' END`. A CASE over two unknown literals
--   resolves to `text`, and Postgres will not implicitly cast text -> the
--   credit_action ENUM, so the INSERT failed
--   ("column credit_action is of type credit_action but expression is of type text").
--   Cast the CASE result explicitly.
--
-- BUG 3 — payroll never accrues (silent). The delivery branch is gated on the
--   booking's session id, which the function read from bookings.session_id. But
--   nothing ever populates bookings.session_id (verified: no DB function, trigger,
--   or app code writes it — the session lifecycle only sets sessions.booking_id).
--   So session_deliveries never accrued and teachers were never paid, with no
--   error. Resolve the session via the reverse link (sessions.booking_id) when the
--   forward link is unset. (Root cause — bookings.session_id being unpopulated —
--   also affects other readers e.g. single-session my-bookings and talqeen; those
--   are separate features and out of scope for this payroll fix.)
--
-- Expand/contract: both changes are additive/backward-compatible. ADD COLUMN is
-- nullable with no default; CREATE OR REPLACE FUNCTION keeps the same signature and
-- grants; no drop/rename/type-narrowing. The column is added BEFORE the function is
-- (re)created so the body validates even under check_function_bodies=on.
--
-- NOTE (follow-up, not this fix): nothing currently WRITES bookings.subscription_id,
-- so the excused_carried -> subscription_extensions branch stays dormant (harmless:
-- the function guards on `subscription_id IS NOT NULL`). Wiring subscription-granted
-- bookings to set this column is a separate feature task.

-- ── BUG 1: add the missing column (before the function that reads it) ──────────
ALTER TABLE public.bookings
  ADD COLUMN IF NOT EXISTS subscription_id uuid REFERENCES public.subscriptions(id);

CREATE INDEX IF NOT EXISTS bookings_subscription_id_idx
  ON public.bookings (subscription_id);

-- ── BUG 2: recreate finalize_attendance with the credit_action cast fixed ──────
-- Body is identical to 20260619000004 except the single `END::credit_action` cast.
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
BEGIN
  -- 1. Fetch the booking + its student/teacher/subscription context.
  --    BUG 3 fix (silent, no crash): bookings.session_id is never populated —
  --    no DB function, trigger, or app code writes it (the session lifecycle only
  --    sets sessions.booking_id, the reverse link). The payroll branch (step 5)
  --    is gated on this session id, so teacher session_deliveries NEVER accrued
  --    in production. Resolve the session via the reverse link when the forward
  --    link is unset, so payroll accrues for real sessions.
  SELECT b.student_id, b.teacher_id,
         COALESCE(
           b.session_id,
           (SELECT s.id FROM sessions s WHERE s.booking_id = b.id ORDER BY s.created_at DESC LIMIT 1)
         ) AS session_id,
         b.subscription_id, b.scheduled_at, b.duration_min
  INTO v_booking
  FROM bookings b
  WHERE b.id = p_booking_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'finalize_attendance: booking % not found', p_booking_id
      USING ERRCODE = 'P0002';
  END IF;

  -- 2. Idempotently upsert the attendance_records row (unique on booking_id).
  --    ON CONFLICT preserves the FIRST finalized outcome; subsequent calls
  --    no-op on credit to prevent double-restore.
  INSERT INTO attendance_records (booking_id, student_id, teacher_id, session_id, outcome, credit_action, finalized_at)
  VALUES (
    p_booking_id,
    v_booking.student_id,
    v_booking.teacher_id,
    v_booking.session_id,
    p_outcome,
    CASE
      WHEN p_outcome IN ('teacher_absent', 'excused_carried') THEN 'restored'
      ELSE 'none'
    END::credit_action,
    now()
  )
  ON CONFLICT (booking_id) DO NOTHING;

  -- 3. Credit restore branches (idempotent: check existing credit_action first).
  SELECT credit_action INTO v_existing_credit_action
  FROM attendance_records WHERE booking_id = p_booking_id;

  IF p_outcome IN ('teacher_absent', 'excused_carried')
     AND v_existing_credit_action IS DISTINCT FROM 'restored' THEN
    PERFORM restore_student_package(p_booking_id);
    UPDATE attendance_records SET credit_action = 'restored', finalized_at = now()
      WHERE booking_id = p_booking_id AND credit_action <> 'restored';
  END IF;

  -- 4. Excused carry-over: insert subscription_extensions (idempotent on booking_id).
  IF p_outcome = 'excused_carried' AND v_booking.subscription_id IS NOT NULL THEN
    -- Compute the extension: booking duration in seconds (fallback 60 min if NULL).
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

  -- 5. Session delivery rows (rate snapshot).
  --    present → deliverer = assigned teacher (or substitute if provided).
  --    teacher_absent → deliverer = substitute ONLY (absent teacher never credited).
  --    student_absent / excused_carried → no delivery (student didn't get taught).
  IF p_outcome IN ('present', 'teacher_absent') AND v_booking.session_id IS NOT NULL THEN
    v_deliverer_id := COALESCE(p_actual_teacher_id, v_booking.teacher_id);
    -- For teacher_absent without a substitute, skip delivery entirely.
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

REVOKE EXECUTE ON FUNCTION finalize_attendance(uuid, attendance_outcome, uuid) FROM public, anon, authenticated;
GRANT  EXECUTE ON FUNCTION finalize_attendance(uuid, attendance_outcome, uuid) TO service_role;
