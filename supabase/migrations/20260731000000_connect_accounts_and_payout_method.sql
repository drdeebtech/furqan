-- 20260731000000_connect_accounts_and_payout_method.sql
--
-- Spec 040 (Stripe Connect teacher payouts) — Phase 0 data-model gaps
-- (plan Phase 0 items 1, 2, 8 / spec FR-003, FR-025, FR-021).
--
-- Scope: data model ONLY. No sweep, no Stripe call, no UI, no app code reads
-- any of this yet. DORMANT in production: the whole Connect path stays inert
-- until `connect_cutover_date` is set (a later, deliberate owner action).
--
-- Pure EXPAND (backward-compatible, CLAUDE.md §4):
--   * one new table (stripe_connect_accounts) + its RLS in the same migration,
--   * one new append-only audit table (connect_payout_audit) + its RLS,
--   * one new NOT NULL column on teacher_profiles WITH a DEFAULT (so it is
--     expand-safe — every existing row is populated by the default, the live
--     build never sees a NULL),
--   * two column-guard triggers, one write-once trigger, one settings row.
-- Nothing is dropped, renamed, narrowed, or SET NOT NULL without a default.
-- The legacy payroll path (session_deliveries / teacher_payouts /
-- run_monthly_payroll) is untouched.
--
-- Idioms deliberately copied from the merged 040 migrations and
-- 20260617000000_catalog_credit_redesign.sql:
--   * RLS teacher-select-own + admin-select + service_role write/insert
--     (20260728000000_connect_earnings_ledger.sql).
--   * platform_settings INSERT ... ON CONFLICT DO NOTHING (same file).
--   * JWT-role column guard: NULL jwt => direct DB / migration (trusted),
--     'service_role' => trusted server action, private.is_admin() => admin
--     session, everything else rejected with 42501
--     (guard_subscription_identity_change in catalog_credit_redesign).
--   * Full-immutability write-once trigger that RAISEs on any disallowed
--     mutation (guard_discount_record_immutable, same file).
--
-- FK target = profiles(id): matches teacher_earning_entries.teacher_id and
-- teacher_profiles.teacher_id — the canonical teacher identity across spec 040.
--
-- ── KNOWN, DELIBERATE LIMITATION (owner/reviewer call — see PR body) ──
-- FR-021 asks that BOTH the initial cutover write AND every rejected mutation
-- attempt leave a durable audit row. In Postgres a BEFORE-UPDATE trigger that
-- RAISEs aborts the transaction and rolls back ANY audit row written in that
-- same transaction, so "reject the write" and "commit an audit row for the
-- rejection" are mutually exclusive without an autonomous transaction
-- (dblink / pg_background). This repo uses neither (verified), and introducing
-- a loopback DB connection with credentials inside a money-path trigger is a
-- worse trade than the gap it closes. Resolution taken here:
--   * value-protection (the money-critical property) is FULLY guaranteed —
--     the second write always RAISEs and the value never changes;
--   * the SUCCESSFUL initial write IS durably audited (it commits fine);
--   * a rejected attempt is recorded in the Postgres server log via the RAISE,
--     but NOT as a durable audit row.
-- Upgrade path (later slice, no dblink): route the one legitimate write
-- through a sole-writer SECURITY DEFINER setter that records the attempt and
-- refuses soft (returns a status instead of raising). Not built here.

-- ─────────────────────────────────────────────────────────────────────────
-- 1. stripe_connect_accounts — Stripe Connect status mirror (spec FR-003)
-- ─────────────────────────────────────────────────────────────────────────
-- One row per teacher. Written ONLY by the account.updated webhook (a later
-- slice) via service_role; clients never write it. Dormant until then.
CREATE TABLE stripe_connect_accounts (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  teacher_id        uuid NOT NULL UNIQUE REFERENCES profiles(id),
  stripe_account_id text UNIQUE,
  charges_enabled   boolean NOT NULL DEFAULT false,
  payouts_enabled   boolean NOT NULL DEFAULT false,
  details_submitted boolean NOT NULL DEFAULT false,
  -- Stripe requirements summary (currently_due / past_due / disabled_reason …).
  requirements      jsonb,
  -- Recency floor for the webhook (same last_event_at guard as handlePaymentFailed).
  last_event_at     timestamptz,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE stripe_connect_accounts IS
  'Spec 040 FR-003: Stripe Connect status mirror, one row per teacher. Updated only by account.updated webhook events (service_role) with a last_event_at recency guard. Dormant until the Connect path is enabled.';

CREATE INDEX idx_stripe_connect_accounts_teacher
  ON stripe_connect_accounts (teacher_id);

ALTER TABLE stripe_connect_accounts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "sca_teacher_select" ON stripe_connect_accounts
  FOR SELECT TO authenticated
  USING (teacher_id = (SELECT auth.uid()));

CREATE POLICY "sca_admin_select" ON stripe_connect_accounts
  FOR SELECT TO authenticated
  USING (private.is_admin());

CREATE POLICY "sca_service_insert" ON stripe_connect_accounts
  FOR INSERT TO service_role WITH CHECK (true);

CREATE POLICY "sca_service_update" ON stripe_connect_accounts
  FOR UPDATE TO service_role USING (true);

-- No DELETE policy and no authenticated write: the mirror is service-role only.

-- Identity freeze: once an account is linked, teacher_id / stripe_account_id
-- must never be re-pointed by a webhook bug; only the status columns change.
-- Parity with the Slice-1 financial guards.
CREATE OR REPLACE FUNCTION guard_stripe_connect_accounts_identity()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF OLD.teacher_id IS DISTINCT FROM NEW.teacher_id
  OR OLD.stripe_account_id IS DISTINCT FROM NEW.stripe_account_id
  OR OLD.created_at IS DISTINCT FROM NEW.created_at THEN
    RAISE EXCEPTION 'stripe_connect_accounts: teacher_id/stripe_account_id are immutable after insert (only status columns may change)';
  END IF;
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

CREATE TRIGGER stripe_connect_accounts_identity_guard
  BEFORE UPDATE ON stripe_connect_accounts
  FOR EACH ROW EXECUTE FUNCTION guard_stripe_connect_accounts_identity();

-- ─────────────────────────────────────────────────────────────────────────
-- 2. connect_payout_audit — append-only audit trail (FR-025 / FR-021)
-- ─────────────────────────────────────────────────────────────────────────
-- A dedicated table rather than the shared public.audit_log: audit_log has a
-- restrictive action CHECK, and broadening a shared constraint to fit two new
-- event shapes drags every other writer into this migration.
CREATE TABLE connect_payout_audit (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  -- 'payout_method_change' | 'agreement_grace_change' | 'connect_cutover_set'
  event              text NOT NULL CHECK (btrim(event) <> ''),
  -- The actor, from the JWT 'sub' when present (admin session). NULL for a
  -- direct-DB / migration / service_role write with no user subject.
  actor              uuid,
  -- The teacher whose column changed (NULL for a settings-level event).
  subject_teacher_id uuid REFERENCES profiles(id),
  -- {"old": …, "new": …} for a column change, {"value": …} for the cutover write.
  detail             jsonb NOT NULL,
  created_at         timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE connect_payout_audit IS
  'Spec 040 FR-025/FR-021: append-only audit of payout_method / agreement_grace_until changes and the one-time connect_cutover_date write. See migration header for the rejected-attempt limitation.';

CREATE INDEX idx_connect_payout_audit_teacher
  ON connect_payout_audit (subject_teacher_id);

ALTER TABLE connect_payout_audit ENABLE ROW LEVEL SECURITY;

CREATE POLICY "cpa_admin_select" ON connect_payout_audit
  FOR SELECT TO authenticated
  USING (private.is_admin());

CREATE POLICY "cpa_service_insert" ON connect_payout_audit
  FOR INSERT TO service_role WITH CHECK (true);

-- No UPDATE/DELETE policy anywhere: append-only. The guard triggers below are
-- SECURITY DEFINER (owned by postgres) so their inserts bypass RLS.

-- ─────────────────────────────────────────────────────────────────────────
-- 3. teacher_profiles.payout_method (spec FR-025)
-- ─────────────────────────────────────────────────────────────────────────
-- NOT NULL WITH DEFAULT => expand-safe: every existing row is stamped
-- 'stripe_connect' by the default, so the live build never reads a NULL.
ALTER TABLE teacher_profiles
  ADD COLUMN IF NOT EXISTS payout_method text NOT NULL DEFAULT 'stripe_connect'
    CHECK (payout_method IN ('stripe_connect', 'manual'));

COMMENT ON COLUMN teacher_profiles.payout_method IS
  'Spec 040 FR-025: settlement rail — stripe_connect (default) | manual. Admin/service-role writable ONLY (see guard_teacher_profiles_payout_columns). A teacher self-switching to manual would route around Stripe into the human-paid queue.';

-- ── Column guard: only service_role / admin / direct-DB may change
--    payout_method OR agreement_grace_until (spec FR-025 / FR-029). ──
--
-- RLS cannot do this: tp_update lets a teacher UPDATE their own row, and RLS
-- filters ROWS, not COLUMNS. So the protection is a BEFORE UPDATE OF trigger
-- (repo lesson: guard the columns, not the transitions).
--
-- The trigger fires ONLY when payout_method or agreement_grace_until is in the
-- UPDATE's SET list. No existing writer of teacher_profiles touches either
-- column (verified: bio/cv/rating/specialty writers only), so this adds zero
-- risk to any current path — that narrowness IS the expand-safety argument.
--
-- agreement_grace_until is included deliberately: it is ALSO teacher-writable
-- via tp_update and was left unguarded by 20260730000000 despite plan item 3
-- requiring "same posture as payout_method" — a teacher could otherwise
-- self-extend grace and bypass the consent gate. This closes that hole with
-- the exact same one mechanism. (See PR body.)
CREATE OR REPLACE FUNCTION guard_teacher_profiles_payout_columns()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_jwt_role text := nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role';
  v_actor    uuid := nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub';
  v_trusted  boolean;
BEGIN
  -- NULL jwt => direct DB / migration (trusted); service_role => trusted server
  -- action; admin via own session => trusted. Anything else is a client.
  v_trusted := v_jwt_role IS NULL
            OR v_jwt_role = 'service_role'
            OR private.is_admin();

  IF NEW.payout_method IS DISTINCT FROM OLD.payout_method THEN
    IF NOT v_trusted THEN
      RAISE EXCEPTION 'payout_method is admin/service-role writable only (spec FR-025)'
        USING errcode = '42501';
    END IF;
    INSERT INTO connect_payout_audit (event, actor, subject_teacher_id, detail)
    VALUES ('payout_method_change', v_actor, NEW.teacher_id,
            jsonb_build_object('old', OLD.payout_method, 'new', NEW.payout_method));
  END IF;

  IF NEW.agreement_grace_until IS DISTINCT FROM OLD.agreement_grace_until THEN
    IF NOT v_trusted THEN
      RAISE EXCEPTION 'agreement_grace_until is admin/service-role writable only (spec FR-029)'
        USING errcode = '42501';
    END IF;
    INSERT INTO connect_payout_audit (event, actor, subject_teacher_id, detail)
    VALUES ('agreement_grace_change', v_actor, NEW.teacher_id,
            jsonb_build_object('old', OLD.agreement_grace_until, 'new', NEW.agreement_grace_until));
  END IF;

  RETURN NEW;
END;
$$;

ALTER FUNCTION guard_teacher_profiles_payout_columns() OWNER TO postgres;

CREATE TRIGGER teacher_profiles_payout_columns_guard
  BEFORE UPDATE OF payout_method, agreement_grace_until ON teacher_profiles
  FOR EACH ROW EXECUTE FUNCTION guard_teacher_profiles_payout_columns();

-- ─────────────────────────────────────────────────────────────────────────
-- 4. connect_cutover_date setting + write-once enforcement (spec FR-021)
-- ─────────────────────────────────────────────────────────────────────────
-- platform_settings.value is NOT NULL, so the "unset / new path disabled"
-- state is the EMPTY STRING (not SQL NULL). The Connect path partitions
-- history on this value; moving it after payouts begin could make the same
-- delivery payable by both paths or by neither — hence write-once.
INSERT INTO platform_settings (key, value, description) VALUES
  ('connect_cutover_date', '',
   'Spec 040 FR-021: date partitioning legacy payroll from Connect transfers. Empty = Connect path DISABLED (dormant). DB-enforced write-once: only the single empty -> value transition is permitted (later, deliberate owner action); any later change or delete is rejected.')
ON CONFLICT (key) DO NOTHING;

-- Write-once trigger, scoped to THIS ONE key so it never touches any other
-- platform_settings row (the agreement gate / feature toggles are updated
-- freely). Allows exactly one '' -> non-empty transition; rejects a second
-- write, a blanking, and a delete. Actor-independent: the write-once property
-- must hold even for an admin (settings_update RLS lets admins UPDATE).
CREATE OR REPLACE FUNCTION guard_connect_cutover_write_once()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor uuid := nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub';
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'connect_cutover_date is write-once and cannot be deleted (spec FR-021)'
      USING errcode = '42501';
  END IF;

  -- UPDATE. The only permitted mutation is the single unlock: '' -> non-empty.
  -- A key-rename away from connect_cutover_date is caught here too: the trigger
  -- also fires when OLD.key is the target (see WHEN below), and OLD.value is
  -- then either already-set (first branch RAISEs) or empty (blank branch RAISEs).
  IF COALESCE(btrim(OLD.value), '') <> '' THEN
    RAISE EXCEPTION 'connect_cutover_date is write-once: already set to %, cannot change (spec FR-021)', OLD.value
      USING errcode = '42501';
  END IF;
  IF COALESCE(btrim(NEW.value), '') = '' THEN
    RAISE EXCEPTION 'connect_cutover_date cannot be blanked (spec FR-021)'
      USING errcode = '42501';
  END IF;

  -- Sole legitimate write: durably audited (commits with the change).
  INSERT INTO connect_payout_audit (event, actor, subject_teacher_id, detail)
  VALUES ('connect_cutover_set', v_actor, NULL,
          jsonb_build_object('value', NEW.value));

  RETURN NEW;
END;
$$;

ALTER FUNCTION guard_connect_cutover_write_once() OWNER TO postgres;

-- WHEN (…) keeps every other platform_settings row completely untouched.
-- Two triggers, not one: Postgres forbids referencing NEW in a DELETE trigger's
-- WHEN clause (even under COALESCE), so UPDATE keys off NEW/OLD.key and DELETE
-- keys off OLD.key. Both dispatch to the same function.
--
-- The UPDATE WHEN checks BOTH NEW.key and OLD.key so a privileged key-RENAME
-- out of the target ('… SET key=''x'' WHERE key=''connect_cutover_date''') still
-- fires the guard (FR-021: reject ANY later mutation, not just value changes).
CREATE TRIGGER connect_cutover_write_once_update_guard
  BEFORE UPDATE ON platform_settings
  FOR EACH ROW
  WHEN (NEW.key = 'connect_cutover_date' OR OLD.key = 'connect_cutover_date')
  EXECUTE FUNCTION guard_connect_cutover_write_once();

CREATE TRIGGER connect_cutover_write_once_delete_guard
  BEFORE DELETE ON platform_settings
  FOR EACH ROW
  WHEN (OLD.key = 'connect_cutover_date')
  EXECUTE FUNCTION guard_connect_cutover_write_once();
