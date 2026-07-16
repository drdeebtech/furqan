-- 20260730000000_teacher_agreement_gate.sql
--
-- Spec 040 (Stripe Connect payouts) — the Teacher Agreement acceptance gate
-- (FR-028/FR-029). This is the CONSENT PRECONDITION that makes the automatic
-- debt-deduction in FR-014 lawful: no earning may accrue for a teacher who has
-- not accepted the agreement disclosing the 14-day hold and the debt-recovery
-- policy. The sweep (later slice) stamps the accepted version on each earning.
--
-- DORMANT BY DEFAULT — the single most important property of this migration.
-- `teacher_agreement_gate_enabled` defaults to false, so shipping this file
-- changes NOTHING about live bookings. Turning the gate on is a deliberate,
-- later owner action taken only AFTER the acceptance UI exists — otherwise it
-- would freeze every teacher who has not yet had a chance to accept (the exact
-- failure FR-029 warns against).
--
-- Pure expand: one new table, one new nullable column on teacher_profiles, two
-- settings, one backfill of the new column. Nothing dropped, renamed, or
-- narrowed.

-- ─────────────────────────────────────────────────────────────────────────
-- 1. teacher_agreement_acceptances — append-only consent evidence (FR-028)
-- ─────────────────────────────────────────────────────────────────────────
CREATE TABLE teacher_agreement_acceptances (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  teacher_id        uuid NOT NULL REFERENCES profiles(id),
  agreement_version text NOT NULL CHECK (btrim(agreement_version) <> ''),
  accepted_at       timestamptz NOT NULL DEFAULT now(),
  -- Who clicked accept — normally the teacher themselves; an admin-assisted
  -- acceptance names the admin. Both are real, attributable actors.
  accepted_by       uuid NOT NULL REFERENCES profiles(id),
  -- Capture-context evidence. Nullable: an admin/back-office acceptance may have
  -- no browser context. FR-028a's narrow evidence-erasure exception is a LATER
  -- slice; this migration keeps the table plainly append-only.
  ip                text,
  user_agent        text,

  -- One acceptance row per (teacher, version): re-accepting the same version is
  -- a no-op, and replay cannot create duplicates.
  CONSTRAINT uix_agreement_acceptance UNIQUE (teacher_id, agreement_version)
);

COMMENT ON TABLE teacher_agreement_acceptances IS
  'Spec 040 FR-028: append-only record that a teacher accepted a given Teacher Agreement version. The consent precondition for earnings/debt-deduction. Dormant until teacher_agreement_gate_enabled is set.';

CREATE INDEX idx_agreement_acceptance_teacher
  ON teacher_agreement_acceptances (teacher_id);

ALTER TABLE teacher_agreement_acceptances ENABLE ROW LEVEL SECURITY;

CREATE POLICY "taa_teacher_select" ON teacher_agreement_acceptances
  FOR SELECT TO authenticated
  USING (teacher_id = (SELECT auth.uid()));

CREATE POLICY "taa_admin_select" ON teacher_agreement_acceptances
  FOR SELECT TO authenticated
  USING (private.is_admin());

CREATE POLICY "taa_service_insert" ON teacher_agreement_acceptances
  FOR INSERT TO service_role WITH CHECK (true);

-- No authenticated INSERT/UPDATE/DELETE and no service UPDATE/DELETE: consent
-- evidence is append-only. The acceptance server action (later slice) runs
-- service-role after verifying the authenticated teacher's identity.

-- Append-only immutability: once written, an acceptance row is frozen. Same
-- guard idiom as the Slice 1 financial guards.
CREATE OR REPLACE FUNCTION guard_agreement_acceptance_immutable()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  RAISE EXCEPTION 'teacher_agreement_acceptances is append-only: consent evidence cannot be modified after insert';
  RETURN NULL;
END;
$$;

CREATE TRIGGER agreement_acceptance_immutable
  BEFORE UPDATE OR DELETE ON teacher_agreement_acceptances
  FOR EACH ROW EXECUTE FUNCTION guard_agreement_acceptance_immutable();

-- ─────────────────────────────────────────────────────────────────────────
-- 2. Per-teacher grace deadline (FR-029)
-- ─────────────────────────────────────────────────────────────────────────
-- Existing active teachers get 30 days to accept without their live bookings
-- freezing; new onboardings (no grace stamp) hit the hard gate immediately.
-- Nullable, additive — expand-safe.
ALTER TABLE teacher_profiles
  ADD COLUMN IF NOT EXISTS agreement_grace_until timestamptz;

COMMENT ON COLUMN teacher_profiles.agreement_grace_until IS
  'Spec 040 FR-029: if set and in the future, this teacher may accept bookings during the grace window without a current-version acceptance. Backfilled once for teachers active at rollout; NULL for new onboardings (hard gate).';

-- One-time backfill: every teacher who already has a confirmed booking at
-- rollout gets 30 days from now. now() is the rollout moment. New teachers get
-- no stamp, so the gate applies to them immediately once enabled.
--
-- Cohort = teachers with a confirmed booking (deliberate, owner-confirmed
-- 2026-07-16). This dormant backfill is only a head-start; the AUTHORITATIVE
-- rollout-cohort snapshot (which teachers are active at enable-time) plus the
-- append-only audit rows belong to the ENABLEMENT procedure (a later slice run
-- when the gate is turned on), not to this migrate-time UPDATE. The full-cohort
-- stamp (all non-archived active teachers) is deferred to that step.
UPDATE teacher_profiles tp
   SET agreement_grace_until = now() + interval '30 days'
 WHERE tp.agreement_grace_until IS NULL
   AND EXISTS (
     SELECT 1 FROM bookings b
      WHERE b.teacher_id = tp.teacher_id
        AND b.status = 'confirmed'
   );

-- ─────────────────────────────────────────────────────────────────────────
-- 3. Settings
-- ─────────────────────────────────────────────────────────────────────────
INSERT INTO platform_settings (key, value, description) VALUES
  ('teacher_agreement_gate_enabled', 'false',
   'Spec 040 FR-029: master switch for the Teacher Agreement booking gate. Ships false (dormant) — enabling it before the acceptance UI exists would freeze bookings. Set true only after teachers can accept.'),
  ('teacher_agreement_current_version', '1',
   'Spec 040 FR-028: the agreement version a teacher must have accepted. Bumping it requires re-acceptance (a new version invalidates old acceptances for gate purposes).')
ON CONFLICT (key) DO NOTHING;

-- ─────────────────────────────────────────────────────────────────────────
-- 4. The gate predicate — ONE source of truth (FR-029)
-- ─────────────────────────────────────────────────────────────────────────
-- Returns true when the teacher MAY accept bookings. STABLE (reads tables +
-- now()), SECURITY INVOKER: only the service-role booking path calls it, which
-- already bypasses RLS, so no privilege escalation and no lockdown needed.
--
-- Fail-safe ordering: when the gate is DISABLED the function short-circuits to
-- true, so a dormant deployment never blocks a booking. When ENABLED, a teacher
-- passes iff they have accepted the current version OR are inside their grace
-- window.
CREATE OR REPLACE FUNCTION teacher_agreement_gate_ok(p_teacher_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  SELECT
    -- Dormant unless explicitly enabled.
    NOT COALESCE(
      (SELECT value = 'true' FROM platform_settings
        WHERE key = 'teacher_agreement_gate_enabled'),
      false
    )
    OR EXISTS (
      SELECT 1 FROM teacher_agreement_acceptances a
       WHERE a.teacher_id = p_teacher_id
         AND a.agreement_version = (
           SELECT value FROM platform_settings
            WHERE key = 'teacher_agreement_current_version'
         )
    )
    OR EXISTS (
      SELECT 1 FROM teacher_profiles tp
       WHERE tp.teacher_id = p_teacher_id
         AND tp.agreement_grace_until IS NOT NULL
         AND tp.agreement_grace_until > now()
    );
$$;

COMMENT ON FUNCTION teacher_agreement_gate_ok(uuid) IS
  'Spec 040 FR-029: true if the teacher may accept bookings — gate disabled, OR current-version accepted, OR within grace. The single source of truth for the booking-path precondition. Dormant until teacher_agreement_gate_enabled.';
