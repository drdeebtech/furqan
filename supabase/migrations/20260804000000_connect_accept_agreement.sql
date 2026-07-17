-- 20260804000000_connect_accept_agreement.sql
--
-- Spec 040 Phase 2 (backend) — the ONE atomic acceptance path for the Teacher
-- Agreement (FR-028) + the SC-014 consent-invariant release: recording the
-- acceptance and releasing that teacher's `held/agreement_pending` earning
-- entries happen in the SAME transaction, so there is no window where consent
-- exists but the money stays held (or worse, the reverse).
--
-- Idiom mirrors 20260803000000_connect_account_functions.sql: SECURITY
-- DEFINER, REVOKE from public+anon+authenticated / GRANT service_role
-- (spec-016 lesson), pinned search_path, OWNER TO postgres. EXPAND-only.
--
-- DORMANT: nothing calls this until the Phase 2 server action ships (same
-- PR), and the acceptance UI is reachable only by authenticated teachers.
-- The booking gate itself stays off until `teacher_agreement_gate_enabled`
-- is set true (owner action).

CREATE OR REPLACE FUNCTION connect_accept_agreement(
  p_teacher_id  uuid,
  p_accepted_by uuid,
  p_ip          text,
  p_user_agent  text,
  -- The version the UI actually RENDERED (attestation). NULL skips the check
  -- (non-UI/admin-assisted paths). A mismatch with the current version means
  -- the owner bumped the agreement between render and click — recording
  -- consent to text the teacher never saw would be a hollow legal record, so
  -- we refuse softly and the UI re-renders the new version (review finding).
  -- The client still cannot CHOOSE what it consents to: the row always
  -- records the server-side current version; a mismatch can only refuse.
  p_expected_version text DEFAULT NULL
)
RETURNS TABLE (
  outcome           text, -- 'accepted' | 'version_changed'
  agreement_version text,
  newly_accepted    boolean,
  released_entries  integer
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_version  text;
  v_newly    boolean;
  v_released integer;
BEGIN
  -- Consent must name a version. A missing/blank setting is a config fault —
  -- fail LOUD (constitution II); never record consent to nothing.
  SELECT value INTO v_version
    FROM platform_settings
   WHERE key = 'teacher_agreement_current_version';
  IF v_version IS NULL OR btrim(v_version) = '' THEN
    RAISE EXCEPTION 'connect_accept_agreement: teacher_agreement_current_version is unset — cannot record consent';
  END IF;

  IF p_expected_version IS NOT NULL AND p_expected_version <> v_version THEN
    RETURN QUERY SELECT 'version_changed'::text, v_version, false, 0;
    RETURN;
  END IF;

  -- Defence in depth: the action layer already gates on role, but a consent
  -- row for a non-teacher would be meaningless — reject it here too.
  IF NOT EXISTS (SELECT 1 FROM teacher_profiles tp WHERE tp.teacher_id = p_teacher_id) THEN
    RAISE EXCEPTION 'connect_accept_agreement: % is not a teacher', p_teacher_id;
  END IF;

  -- Append-only insert; UNIQUE(teacher_id, agreement_version) makes a replay
  -- a clean no-op (FR-028: re-accepting the same version never duplicates).
  -- Evidence minimization: user_agent hard-capped at 255 (plan Phase 0 §4).
  INSERT INTO teacher_agreement_acceptances
    (teacher_id, agreement_version, accepted_by, ip, user_agent)
  VALUES
    (p_teacher_id, v_version, p_accepted_by,
     nullif(btrim(coalesce(p_ip, '')), ''),
     left(nullif(btrim(coalesce(p_user_agent, '')), ''), 255))
  ON CONFLICT ON CONSTRAINT uix_agreement_acceptance DO NOTHING;
  v_newly := FOUND;

  -- SC-014 release — runs on REPLAY too (not only on first insert): if a
  -- prior call crashed between insert and release, the retry must still
  -- release. Idempotent: released rows are no longer held/agreement_pending.
  -- Touches ONLY this teacher's agreement_pending holds — an admin/dispute
  -- hold (payout_holds, other hold_reason values) is never released here.
  -- VERSION-SCOPED (review finding): an entry stamped with a DIFFERENT
  -- agreement_version (accrued under terms not yet accepted, e.g. a bump
  -- racing this acceptance) stays held; unstamped (NULL) legacy entries
  -- release. Consent releases only money accrued under the accepted terms.
  UPDATE teacher_earning_entries e
     SET status = 'pending',
         hold_reason = NULL
   WHERE e.teacher_id = p_teacher_id
     AND e.status = 'held'
     AND e.hold_reason = 'agreement_pending'
     AND (e.agreement_version IS NULL OR e.agreement_version = v_version);
  GET DIAGNOSTICS v_released = ROW_COUNT;

  RETURN QUERY SELECT 'accepted'::text, v_version, v_newly, v_released;
END;
$$;

ALTER FUNCTION connect_accept_agreement(uuid, uuid, text, text, text) OWNER TO postgres;
REVOKE EXECUTE ON FUNCTION connect_accept_agreement(uuid, uuid, text, text, text)
  FROM public, anon, authenticated;
GRANT  EXECUTE ON FUNCTION connect_accept_agreement(uuid, uuid, text, text, text)
  TO service_role;

COMMENT ON FUNCTION connect_accept_agreement(uuid, uuid, text, text, text) IS
  'Spec 040 FR-028/SC-014: THE atomic Teacher Agreement acceptance — append-only consent row (current version from settings) + release of that teacher''s held/agreement_pending earning entries, one transaction. Replay-safe. Service-role only.';
