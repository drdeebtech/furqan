-- Reconcile finalize_attendance after the #662 prod hotfix (spec 038, Phase 2).
--
-- WHY. 038's finalize_attendance (20260715000100) added the prepaid_hours restore
--   branch. The production restore-guard hotfix #662 (20260716000000) then
--   re-created finalize_attendance WITHOUT that branch (it was cut off main, which
--   has no 038 code) and, sorting AFTER 20260715000100, it wins the from-zero
--   apply — silently reverting 038's wallet restore. This migration re-asserts the
--   038 (prepaid-aware) body so it is the final state, and is timestamped after
--   20260716000000 so it applies last.
--
--   The body is 20260715000100's finalize_attendance verbatim (already carries the
--   #662 restore-guard fix — credit_action starts 'none' — plus the FOR UPDATE OF b
--   nullable-side fix and the prepaid restore branch). Only the stale ELSE-branch
--   comment is corrected: on main (post #661/#662) restore_student_package(uuid)
--   now exists and the guard is fixed, so the subscription PERFORM resolves and
--   actually restores — it is no longer a "no-arg trigger / redundant label".
--
-- Expand/contract: CREATE OR REPLACE, same signature; no DROP/RENAME/type change.

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
  -- 1. Fetch booking + charged-lot product_type (LEFT JOIN → FOR UPDATE OF b only,
  --    since FOR UPDATE cannot lock the nullable side of an outer join). BUG 3 fix
  --    retained: resolve session via sessions.booking_id reverse link.
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
  FOR UPDATE OF b;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'finalize_attendance: booking % not found', p_booking_id
      USING ERRCODE = 'P0002';
  END IF;

  -- 2. Idempotent attendance row. credit_action starts 'none' (#662 restore-guard
  --    fix): the restore branch sets 'restored' only AFTER restoring the credit.
  INSERT INTO attendance_records (booking_id, student_id, teacher_id, session_id, outcome, credit_action, finalized_at)
  VALUES (
    p_booking_id, v_booking.student_id, v_booking.teacher_id, v_booking.session_id, p_outcome,
    'none'::credit_action, now()
  )
  ON CONFLICT (booking_id) DO NOTHING;

  -- 3. Restore branch (idempotent via the guard below).
  SELECT credit_action INTO v_existing_credit_action
    FROM attendance_records WHERE booking_id = p_booking_id;

  IF p_outcome IN ('teacher_absent', 'excused_carried')
     AND v_existing_credit_action IS DISTINCT FROM 'restored' THEN

    IF v_booking.student_package_id IS NOT NULL
       AND v_booking.charged_product_type = 'prepaid_hours' THEN
      -- Prepaid wallet restore (H4): restore the EXACT charged lot, reactivating
      -- it (status='active' + fresh expires_at) if a sweep expired it meanwhile.
      SELECT COALESCE(NULLIF(TRIM(value), '')::integer, 12)
        INTO v_prepaid_window_months
        FROM public.platform_settings WHERE key = 'prepaid_hours_expiry_months';
      v_prepaid_window_months := COALESCE(v_prepaid_window_months, 12);

      UPDATE public.student_packages
        SET sessions_used = GREATEST(sessions_used - 1, 0),
            status = 'active',
            expires_at = now() + (v_prepaid_window_months * interval '1 month')
        WHERE id = v_booking.student_package_id
          AND product_type = 'prepaid_hours';   -- defense-in-depth: never a sub lot

      PERFORM public.record_prepaid_event(v_booking.student_package_id, 'restore', 1, NULL);
    ELSE
      -- Subscription / legacy restore: restore_student_package(uuid) (added #661)
      -- credits the exact charged package (bookings.student_package_id), clamp >=0,
      -- NULL-stamp no-op. With #662 this branch now actually runs and restores.
      PERFORM restore_student_package(p_booking_id);
    END IF;

    UPDATE attendance_records SET credit_action = 'restored', finalized_at = now()
      WHERE booking_id = p_booking_id AND credit_action <> 'restored';
  END IF;

  -- 4. Excused carry-over → subscription_extensions (idempotent).
  IF p_outcome = 'excused_carried' AND v_booking.subscription_id IS NOT NULL THEN
    v_extension_seconds := COALESCE(v_booking.duration_min, 60) * 60;
    INSERT INTO subscription_extensions (
      subscription_id, booking_id, session_id, granted_by_user_id, reason, extension_seconds
    )
    SELECT
      v_booking.subscription_id, p_booking_id, v_booking.session_id,
      v_booking.student_id, 'excused absence carry-over', v_extension_seconds
    WHERE NOT EXISTS (
      SELECT 1 FROM subscription_extensions
      WHERE subscription_id = v_booking.subscription_id AND booking_id = p_booking_id
    );
  END IF;

  -- 5. Session delivery rows (rate snapshot).
  IF p_outcome IN ('present', 'teacher_absent') AND v_booking.session_id IS NOT NULL THEN
    v_deliverer_id := COALESCE(p_actual_teacher_id, v_booking.teacher_id);
    IF NOT (p_outcome = 'teacher_absent' AND p_actual_teacher_id IS NULL) THEN
      SELECT hourly_rate_usd INTO v_rate FROM profiles WHERE id = v_deliverer_id;
      v_duration_min := COALESCE(v_booking.duration_min, 60);

      INSERT INTO session_deliveries (
        session_id, teacher_id, duration_minutes, hourly_rate_usd, delivered_at, payroll_period_month
      )
      SELECT
        v_booking.session_id, v_deliverer_id, v_duration_min,
        COALESCE(v_rate, 0), COALESCE(v_booking.scheduled_at, now()),
        date_trunc('month', COALESCE(v_booking.scheduled_at, now()))::date
      WHERE NOT EXISTS (
        SELECT 1 FROM session_deliveries WHERE session_id = v_booking.session_id
      );
    END IF;
  END IF;
END;
$$;

ALTER FUNCTION finalize_attendance(uuid, attendance_outcome, uuid) OWNER TO postgres;
REVOKE EXECUTE ON FUNCTION finalize_attendance(uuid, attendance_outcome, uuid) FROM public, anon, authenticated;
GRANT  EXECUTE ON FUNCTION finalize_attendance(uuid, attendance_outcome, uuid) TO service_role;
