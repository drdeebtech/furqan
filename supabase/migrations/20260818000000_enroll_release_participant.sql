-- Task 10 (round-2 architecture plan): atomic halaqa enroll/release kernel.
--
-- enrollInHalaqa / cancelHalaqaEnrollment (src/app/student/halaqas/actions.ts)
-- each did a snapshot-read -> INSERT/DELETE session_participants -> guarded
-- UPDATE sessions.current_enrollment -> app-side rollback on a lost race, as
-- 2-3 separate non-transactional statements. A crash between the INSERT and
-- the counter UPDATE leaves a ghost participant row / drifted counter with
-- no way to roll back. Collapsing each into one SECURITY DEFINER function
-- makes the whole sequence one transaction: any failure (duplicate
-- enrollment, over-capacity) aborts the entire thing automatically, so a
-- crash mid-sequence can no longer happen. Mirrors the confirm_booking_with_
-- session / deduct_package_session / start_instant_session_booking atomic
-- pattern (ADR-0004).
--
-- Scope note: increment_enrollment (20260618000004) is a DIFFERENT function
-- on class_offerings (the group-join-request / cohort-overflow path) — not
-- touched here. This migration only adds the two NEW functions used by the
-- halaqa session_participants enroll/cancel pair.

-- ────────────────────────────────────────────────────────────────────────
-- enroll_participant: atomic INSERT session_participants + capacity-guarded
-- increment of sessions.current_enrollment, one transaction.
--
-- FOR UPDATE on the session row serializes concurrent enrollments for the
-- same session (same idiom as open_overflow_halaqa), so the capacity check
-- below is deterministic rather than a best-effort race guard.
--
-- Raises 23505 (unique_violation) on duplicate enrollment — unchanged
-- behaviour vs. the old direct .insert(), so existing insErr.code check at
-- call sites keeps working against the RPC error's .code field.
-- Raises P0003 when the session is already at capacity.
-- ────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION "public"."enroll_participant"(
  "p_session_id" uuid,
  "p_user_id" uuid
) RETURNS void
    LANGUAGE "plpgsql"
    SECURITY DEFINER
    SET "search_path" TO 'pg_catalog', 'public'
    AS $$
DECLARE
  v_rows_updated integer;
BEGIN
  PERFORM 1 FROM public.sessions WHERE id = p_session_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'enroll_participant: session % not found', p_session_id
      USING ERRCODE = 'P0002';
  END IF;

  INSERT INTO public.session_participants (session_id, user_id, role, attendance_status)
  VALUES (p_session_id, p_user_id, 'student', 'registered');

  UPDATE public.sessions
  SET current_enrollment = current_enrollment + 1
  WHERE id = p_session_id
    AND current_enrollment < capacity;

  GET DIAGNOSTICS v_rows_updated = ROW_COUNT;
  IF v_rows_updated = 0 THEN
    -- Over-capacity: raising aborts the whole transaction, so the INSERT
    -- above rolls back with it — no app-side compensating DELETE needed.
    RAISE EXCEPTION 'enroll_participant: session % at capacity', p_session_id
      USING ERRCODE = 'P0003';
  END IF;
END;
$$;

COMMENT ON FUNCTION "public"."enroll_participant"("p_session_id" uuid, "p_user_id" uuid) IS
  'Atomic halaqa enrollment. INSERT session_participants(role=student) + capacity-guarded increment of sessions.current_enrollment in one transaction. Raises unique_violation (23505) on duplicate enrollment, P0003 when at capacity. Called by src/app/student/halaqas/actions.ts enrollInHalaqa(). See ADR-0004, Task 10.';

REVOKE ALL ON FUNCTION "public"."enroll_participant"("p_session_id" uuid, "p_user_id" uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION "public"."enroll_participant"("p_session_id" uuid, "p_user_id" uuid) FROM "anon";
REVOKE ALL ON FUNCTION "public"."enroll_participant"("p_session_id" uuid, "p_user_id" uuid) FROM "authenticated";
GRANT EXECUTE ON FUNCTION "public"."enroll_participant"("p_session_id" uuid, "p_user_id" uuid) TO "service_role";

-- ────────────────────────────────────────────────────────────────────────
-- release_participant: atomic DELETE session_participants + decrement of
-- sessions.current_enrollment (never below 0), one transaction.
--
-- Returns false (no exception) when the user had no student participant
-- row for the session — that is a normal "not enrolled" outcome, not an
-- error, so callers can branch on the boolean instead of parsing errors.
-- ────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION "public"."release_participant"(
  "p_session_id" uuid,
  "p_user_id" uuid
) RETURNS boolean
    LANGUAGE "plpgsql"
    SECURITY DEFINER
    SET "search_path" TO 'pg_catalog', 'public'
    AS $$
DECLARE
  v_deleted integer;
BEGIN
  PERFORM 1 FROM public.sessions WHERE id = p_session_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'release_participant: session % not found', p_session_id
      USING ERRCODE = 'P0002';
  END IF;

  DELETE FROM public.session_participants
  WHERE session_id = p_session_id
    AND user_id = p_user_id
    AND role = 'student';

  GET DIAGNOSTICS v_deleted = ROW_COUNT;
  IF v_deleted = 0 THEN
    RETURN false;
  END IF;

  UPDATE public.sessions
  SET current_enrollment = GREATEST(current_enrollment - 1, 0)
  WHERE id = p_session_id;

  RETURN true;
END;
$$;

COMMENT ON FUNCTION "public"."release_participant"("p_session_id" uuid, "p_user_id" uuid) IS
  'Atomic halaqa enrollment release. DELETE session_participants(role=student) + decrement of sessions.current_enrollment (floored at 0) in one transaction. Returns false when the user had no student participant row (not an error). Called by src/app/student/halaqas/actions.ts cancelHalaqaEnrollment(). See ADR-0004, Task 10.';

REVOKE ALL ON FUNCTION "public"."release_participant"("p_session_id" uuid, "p_user_id" uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION "public"."release_participant"("p_session_id" uuid, "p_user_id" uuid) FROM "anon";
REVOKE ALL ON FUNCTION "public"."release_participant"("p_session_id" uuid, "p_user_id" uuid) FROM "authenticated";
GRANT EXECUTE ON FUNCTION "public"."release_participant"("p_session_id" uuid, "p_user_id" uuid) TO "service_role";
