-- Fix teacher_absent / excused_carried credit restore in finalize_attendance.
--
-- Confirmed 2026-07-06 by local repro: after 20260714000000 made finalize_attendance
-- runnable, its credit-restore branch still NEVER restores the student's package:
--   1. It PERFORMs restore_student_package(p_booking_id) — a 1-arg function that does
--      NOT exist (only the 0-arg trigger fn restore_student_package() does). A phantom
--      reference, accepted at CREATE because check_function_bodies was off.
--   2. Step 2 optimistically stamped credit_action='restored', so step 3's guard
--      (IS DISTINCT FROM 'restored') was already false on a fresh call → the branch was
--      skipped. That skip is the only reason the phantom ref above never errored.
--   3. The real restore trigger (t_restore_student_package) fires ONLY on
--      bookings.status confirmed→cancelled, but the attendance flow
--      (api/attendance/record, excuses.ts) never changes the booking status. So a
--      teacher_absent booking keeps sessions_used incremented forever: the student
--      paid for a session the teacher missed and never gets it back.
--
-- Fix: do the restore INLINE, mirroring t_restore_student_package's own logic
-- (decrement the exact package that was charged, clamped at 0, credit ONLY when a
-- package was actually debited), stamp credit_action='restored' only AFTER the
-- restore, and drop the phantom restore_student_package(p_booking_id) call. The
-- FOR UPDATE lock (step 1) + the credit_action flip keep it idempotent (no
-- double-restore on repeat/auto calls). Body otherwise identical to 20260714000000.
--
-- Expand/contract: CREATE OR REPLACE FUNCTION, same signature + grants; no schema
-- change (bookings.student_package_id already exists). Backward-compatible.
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
  -- 1. Fetch the booking + its student/teacher/subscription/package context.
  --    session_id: bookings.session_id is never populated (only sessions.booking_id
  --    is), so resolve via the reverse link when the forward link is unset.
  --    student_package_id: the exact package charged on deduct — needed to restore.
  SELECT b.student_id, b.teacher_id,
         COALESCE(
           b.session_id,
           (SELECT s.id FROM sessions s WHERE s.booking_id = b.id ORDER BY s.created_at DESC LIMIT 1)
         ) AS session_id,
         b.subscription_id, b.student_package_id, b.scheduled_at, b.duration_min
  INTO v_booking
  FROM bookings b
  WHERE b.id = p_booking_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'finalize_attendance: booking % not found', p_booking_id
      USING ERRCODE = 'P0002';
  END IF;

  -- 2. Idempotently upsert the attendance_records row (unique on booking_id).
  --    credit_action starts at 'none'; step 3 is the SINGLE authority that performs
  --    the restore and flips it to 'restored'. (Previously this optimistically wrote
  --    'restored' here, which silently skipped the actual restore in step 3.)
  INSERT INTO attendance_records (booking_id, student_id, teacher_id, session_id, outcome, credit_action, finalized_at)
  VALUES (
    p_booking_id,
    v_booking.student_id,
    v_booking.teacher_id,
    v_booking.session_id,
    p_outcome,
    'none'::credit_action,
    now()
  )
  ON CONFLICT (booking_id) DO NOTHING;

  -- 3. Credit restore for absence outcomes — idempotent (checks credit_action first).
  --    Restores the EXACT package that was charged, mirroring t_restore_student_package:
  --    a NULL student_package_id means nothing was debited → nothing to restore (never
  --    re-derive a package; that would be a free session, #363). Clamp at 0.
  SELECT credit_action INTO v_existing_credit_action
  FROM attendance_records WHERE booking_id = p_booking_id;

  IF p_outcome IN ('teacher_absent', 'excused_carried')
     AND v_existing_credit_action IS DISTINCT FROM 'restored' THEN
    IF v_booking.student_package_id IS NOT NULL THEN
      UPDATE student_packages
      SET sessions_used = greatest(sessions_used - 1, 0)
      WHERE id = v_booking.student_package_id
        AND sessions_used > 0;
    END IF;
    UPDATE attendance_records SET credit_action = 'restored', finalized_at = now()
      WHERE booking_id = p_booking_id AND credit_action <> 'restored';
  END IF;

  -- 4. Excused carry-over: insert subscription_extensions (idempotent on booking_id).
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

  -- 5. Session delivery rows (rate snapshot).
  --    present → deliverer = assigned teacher (or substitute if provided).
  --    teacher_absent → deliverer = substitute ONLY (absent teacher never credited).
  --    student_absent / excused_carried → no delivery (student didn't get taught).
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

REVOKE EXECUTE ON FUNCTION finalize_attendance(uuid, attendance_outcome, uuid) FROM public, anon, authenticated;
GRANT  EXECUTE ON FUNCTION finalize_attendance(uuid, attendance_outcome, uuid) TO service_role;
