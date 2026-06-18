-- T021: Atomic teacher reassignment + future-booking cancellation.
--
-- Closes the critical atomicity gap called out by CodeRabbit: the previous
-- TS implementation performed (1) fetch assignment, (2) update assignment
-- with cancelled_future_bookings_at, (3) bulk-cancel future bookings as
-- three independent statements. If step 3 failed, the assignment row showed
-- a cancellation timestamp while the bookings remained active under the old
-- teacher — a silent data-integrity violation.
--
-- This SECURITY DEFINER RPC wraps all three steps in a single transaction,
-- locks the assignment row (FOR UPDATE) to prevent concurrent reassign
-- races, and only writes cancelled_future_bookings_at after the bulk cancel
-- has succeeded. Returns student_id + cancellation_count for event emission.

CREATE OR REPLACE FUNCTION reassign_teacher_atomic(
  p_assignment_id uuid,
  p_new_teacher_id uuid,
  p_admin_id uuid
)
RETURNS TABLE(student_id uuid, cancellation_count integer)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_student_id uuid;
  v_count integer;
BEGIN
  -- 1. Lock + fetch assignment row. SELECT INTO STRICT raises
  -- P0002 (no_data_found) if the row is missing, which surfaces as a
  -- PostgrestError to the caller — no silent fall-through.
  SELECT sta.student_id INTO STRICT v_student_id
  FROM subscription_teacher_assignments sta
  WHERE sta.id = p_assignment_id
  FOR UPDATE;

  -- 2. Bulk-cancel future pending/confirmed bookings BEFORE writing the
  -- audit timestamp, so a failure here rolls back the whole transaction.
  UPDATE bookings
  SET status = 'cancelled'
  WHERE student_id = v_student_id
    AND status IN ('pending', 'confirmed')
    AND scheduled_at > now();
  GET DIAGNOSTICS v_count = ROW_COUNT;

  -- 3. Update assignment: new teacher + audit trail. Runs in the same
  -- transaction, so cancelled_future_bookings_at only lands if the cancel
  -- above succeeded.
  UPDATE subscription_teacher_assignments
  SET teacher_id = p_new_teacher_id,
      approved_by = p_admin_id,
      cancelled_future_bookings_at = now()
  WHERE id = p_assignment_id;

  RETURN QUERY SELECT v_student_id, v_count;
END;
$$;

REVOKE EXECUTE ON FUNCTION reassign_teacher_atomic(uuid, uuid, uuid) FROM public, anon, authenticated;
GRANT  EXECUTE ON FUNCTION reassign_teacher_atomic(uuid, uuid, uuid) TO service_role;
