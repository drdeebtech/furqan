-- T006: finalize_attendance + run_monthly_payroll SECURITY DEFINER functions.
--
-- Both are SECURITY DEFINER with SET search_path = public (closes the
-- search-path hijack vector — consistent with spec 020 hardening pattern).
-- REVOKE FROM public/anon/authenticated; GRANT TO service_role only.

-- ────────────────────────────────────────────────────────────────────────
-- finalize_attendance: atomic outcome finalization for a booking.
--
-- Branches:
--   present / teacher_absent-with-substitute → insert session_deliveries
--     (rate snapshot from teacher profile)
--   student_absent → no credit restore, no delivery (credit stays debited)
--   teacher_absent → restore student credit, no delivery for absent teacher
--   excused_carried → restore student credit exactly once + insert
--     subscription_extensions row (idempotent on booking_id anchor)
-- ────────────────────────────────────────────────────────────────────────
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
  v_session RECORD;
  v_existing_credit_action credit_action;
  v_extension_seconds bigint;
  v_deliverer_id uuid;
  v_rate numeric(10,2);
  v_duration_min integer;
BEGIN
  -- 1. Fetch the booking + its student/teacher/subscription context.
  SELECT b.student_id, b.teacher_id, b.session_id, b.subscription_id, b.scheduled_at, b.duration_min
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
    END,
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

-- ────────────────────────────────────────────────────────────────────────
-- run_monthly_payroll: idempotent monthly aggregation.
--
-- FR-029: skip teacher/months with non-uniform snapshotted rates (do NOT
--        silently MAX-pick). Surfaced as exceptions.
-- FR-030: skip teacher/months with NULL or 0 effective rate. Surfaced.
-- Returns: count of payout rows inserted.
-- ────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION run_monthly_payroll(p_month date)
RETURNS int
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_inserted int;
  v_offending RECORD;
BEGIN
  WITH agg AS (
    SELECT
      teacher_id,
      ROUND(SUM(duration_minutes) / 60.0, 2)                    AS total_hours,
      MAX(hourly_rate_usd)                                      AS rate_max,
      MIN(hourly_rate_usd)                                      AS rate_min,
      ROUND(SUM(duration_minutes / 60.0 * hourly_rate_usd), 2)  AS total_amount_usd
    FROM session_deliveries
    WHERE payroll_period_month = p_month
    GROUP BY teacher_id
  )
  INSERT INTO teacher_payouts (
    teacher_id, payroll_period_month, total_hours, hourly_rate_usd, total_amount_usd
  )
  SELECT teacher_id, p_month, total_hours, rate_max, total_amount_usd
  FROM agg
  WHERE rate_max IS NOT NULL AND rate_max > 0   -- FR-030: skip NULL/zero rate
    AND rate_min = rate_max                     -- FR-029: skip non-uniform rate
  ON CONFLICT (teacher_id, payroll_period_month) DO NOTHING;

  GET DIAGNOSTICS v_inserted = ROW_COUNT;

  -- Surface exceptions (ops-visible warnings). The TS wrapper re-derives a
  -- structured list for the API response (see runMonthlyPayroll in payroll.ts).
  FOR v_offending IN
    SELECT teacher_id,
           CASE
             WHEN MAX(hourly_rate_usd) IS NULL OR MAX(hourly_rate_usd) = 0
               THEN 'missing_or_zero_rate'
             WHEN MIN(hourly_rate_usd) <> MAX(hourly_rate_usd)
               THEN 'non_uniform_rate'
           END AS reason
    FROM session_deliveries
    WHERE payroll_period_month = p_month
    GROUP BY teacher_id
    HAVING MAX(hourly_rate_usd) IS NULL OR MAX(hourly_rate_usd) = 0
           OR MIN(hourly_rate_usd) <> MAX(hourly_rate_usd)
  LOOP
    RAISE WARNING 'run_monthly_payroll: skipped teacher % for month % — %',
      v_offending.teacher_id, p_month, v_offending.reason;
  END LOOP;

  RETURN v_inserted;
END;
$$;

REVOKE EXECUTE ON FUNCTION run_monthly_payroll(date) FROM public, anon, authenticated;
GRANT  EXECUTE ON FUNCTION run_monthly_payroll(date) TO service_role;
