-- Fix a production P0 in finalize_attendance (spec 019 attendance/payroll).
--
-- BUG (restore-guard). finalize_attendance restores a student's session credit on
--   the teacher_absent / excused_carried branch, guarded by
--   `v_existing_credit_action IS DISTINCT FROM 'restored'`. But the attendance_records
--   INSERT two statements earlier ALREADY stamps credit_action='restored' for those
--   outcomes (the CASE from 20260619000004 / 20260714000000). So on a first-time
--   (and only) teacher_absent finalize, the SELECT reads 'restored', the guard is
--   FALSE, and the restore body — PERFORM restore_student_package(...) + the
--   credit flip — is SKIPPED. The student's credit is never restored.
--
--   Verified locally (2026-07-06): a teacher_absent finalize on a booking whose
--   charged package had a used credit left sessions_used unchanged (no restore).
--   Confirmed no other path restores it: nothing in the app cancels the booking on
--   teacher_absent, so the t_restore_student_package (AFTER UPDATE OF status) trigger
--   never fires for this outcome — finalize_attendance is the sole restore path.
--
--   (Related: #661 added the missing restore_student_package(uuid) overload so the
--   PERFORM resolves; but with this guard bug the PERFORM was never reached on a
--   fresh call. Both fixes are needed for teacher_absent restore to actually work.)
--
-- FIX. Do NOT pre-stamp credit_action='restored' at INSERT. Insert 'none'; the
--   restore branch below sets 'restored' AFTER actually restoring the credit. Then:
--     - first teacher_absent finalize: INSERT 'none' → guard TRUE → restore runs →
--       credit flipped to 'restored';
--     - any re-call: INSERT no-ops (ON CONFLICT), SELECT 'restored', guard FALSE →
--       skip (idempotent, no double-restore).
--
--   Body is otherwise byte-identical to 20260714000000 (BUG 1/2/3 fixes retained:
--   b.subscription_id read, END::credit_action cast, sessions.booking_id reverse
--   link). Only the INSERT's credit_action expression changes.
--
-- Expand/contract: CREATE OR REPLACE with the SAME signature; no DROP/RENAME, no
--   enum/type/column change. Safe under concurrent migration + Vercel deploy.

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

  -- Idempotently upsert attendance_records. Start credit_action at 'none' (the
  -- FIX): the restore branch below sets 'restored' only after the credit is
  -- actually restored, so the guard cannot skip its own work.
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

  SELECT credit_action INTO v_existing_credit_action
  FROM attendance_records WHERE booking_id = p_booking_id;

  IF p_outcome IN ('teacher_absent', 'excused_carried')
     AND v_existing_credit_action IS DISTINCT FROM 'restored' THEN
    PERFORM restore_student_package(p_booking_id);
    UPDATE attendance_records SET credit_action = 'restored', finalized_at = now()
      WHERE booking_id = p_booking_id AND credit_action <> 'restored';
  END IF;

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
