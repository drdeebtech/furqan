-- 20260810000000_connect_place_hold_teacher_check.sql
--
-- Spec 040 Phase 5 security-pass follow-up (P3): connect_admin_place_hold
-- validated its target against `profiles`, so an admin (via a UI bug or a
-- crafted action call — zod only checks uuid shape) could place a hold on a
-- STUDENT's profile id; the orphan hold then dragged that non-teacher into the
-- connect_admin_payouts_overview teacher list (its EXISTS payout_holds branch).
-- Admin-only and fully attributed, no money impact — but inconsistent with
-- connect_accept_agreement, which correctly checks `teacher_profiles`.
-- Expand-only: CREATE OR REPLACE with the corrected existence check; the
-- function body is otherwise identical to 20260808.

CREATE OR REPLACE FUNCTION connect_admin_place_hold(
  p_teacher_id uuid,
  p_reason     text,
  p_actor      uuid
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_id uuid;
BEGIN
  IF p_reason IS NULL OR btrim(p_reason) = '' THEN
    RAISE EXCEPTION 'connect_admin_place_hold: reason must be non-empty';
  END IF;
  IF p_actor IS NULL THEN
    RAISE EXCEPTION 'connect_admin_place_hold: actor is required';
  END IF;
  -- Corrected: a payout hold only makes sense on a TEACHER (security pass P3).
  IF NOT EXISTS (SELECT 1 FROM teacher_profiles WHERE teacher_id = p_teacher_id) THEN
    RAISE EXCEPTION 'connect_admin_place_hold: % is not a teacher', p_teacher_id;
  END IF;

  -- Replay-safe (DB-review P2): a double-click/retry with the same reason
  -- returns the existing ACTIVE hold instead of stacking a duplicate an
  -- admin would have to discover and lift separately. The advisory xact lock
  -- serializes concurrent retries so the SELECT/INSERT pair cannot race
  -- (same idiom as connect_link_account, #720).
  PERFORM pg_advisory_xact_lock(hashtext('connect_admin_place_hold:' || p_teacher_id::text));
  SELECT ph.id INTO v_id FROM payout_holds ph
   WHERE ph.teacher_id = p_teacher_id AND ph.source = 'admin'
     AND ph.reason = btrim(p_reason) AND ph.released_at IS NULL
   LIMIT 1;
  IF FOUND THEN
    RETURN v_id;
  END IF;

  INSERT INTO payout_holds (teacher_id, source, reason, created_by)
  VALUES (p_teacher_id, 'admin', btrim(p_reason), p_actor)
  RETURNING id INTO v_id;
  RETURN v_id;
END;
$$;

ALTER FUNCTION connect_admin_place_hold(uuid, text, uuid) OWNER TO postgres;
REVOKE EXECUTE ON FUNCTION connect_admin_place_hold(uuid, text, uuid)
  FROM public, anon, authenticated;
GRANT  EXECUTE ON FUNCTION connect_admin_place_hold(uuid, text, uuid)
  TO service_role;

COMMENT ON FUNCTION connect_admin_place_hold(uuid, text, uuid) IS
  'Spec 040 FR-023: place (or reuse) an active admin payout hold on a TEACHER. Replay-safe; target must exist in teacher_profiles (Phase 5 security-pass fix). Service-role only.';
