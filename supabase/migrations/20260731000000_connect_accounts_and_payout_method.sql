-- 20260731000000_connect_accounts_and_payout_method.sql
--
-- Spec 040 (Stripe Connect teacher payouts) — Phase 0 data-model gaps
-- (plan Phase 0 items 1, 2, 8 / spec FR-003, FR-025, FR-021, FR-017).
--
-- Scope: data model ONLY. No sweep, no Stripe call, no UI, no app code reads
-- any of this yet. DORMANT in production: the whole Connect path stays inert
-- until `connect_cutover_date` is set (a later, deliberate owner action via
-- set_connect_cutover_date()).
--
-- Pure EXPAND (backward-compatible, CLAUDE.md §4):
--   * one new table (stripe_connect_accounts) + its RLS in the same migration,
--   * one new append-only audit table (connect_payout_audit) + its RLS,
--   * one new NOT NULL column on teacher_profiles WITH a DEFAULT (so it is
--     expand-safe — every existing row is populated by the default, the live
--     build never sees a NULL),
--   * column-guard triggers, a sole-writer cutover setter + guard, one setting.
-- Nothing is dropped, renamed, narrowed, or SET NOT NULL without a default.
-- The legacy payroll path (session_deliveries / teacher_payouts /
-- run_monthly_payroll) is untouched.
--
-- Idioms deliberately copied from the merged 040 migrations and
-- 20260617000000_catalog_credit_redesign.sql:
--   * RLS teacher-select-own + admin-select + service_role write/insert
--     (20260728000000_connect_earnings_ledger.sql).
--   * Append-only immutability trigger (guard_agreement_acceptance_immutable).
--   * JWT-role column guard (guard_subscription_identity_change): NULL jwt =>
--     direct DB / migration (trusted), 'service_role' => trusted server action,
--     private.is_admin() => admin session, else 42501.
--   * SECURITY DEFINER lockdown REVOKE public,anon,authenticated / GRANT
--     service_role (spec-016 lesson — name anon+authenticated explicitly).
--
-- FK target = profiles(id): matches teacher_earning_entries.teacher_id and
-- teacher_profiles.teacher_id — the canonical teacher identity across spec 040.

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

-- Identity guard: teacher_id / created_at are frozen after insert. The Stripe
-- account id may be linked EXACTLY ONCE (NULL -> value): a row is often created
-- before Stripe returns the acct_… id, so NULL->value must be allowed; but once
-- set it can never be re-pointed (value->other or value->NULL both rejected).
-- Only the status columns (charges/payouts/details/requirements/last_event_at)
-- change freely thereafter.
CREATE OR REPLACE FUNCTION guard_stripe_connect_accounts_identity()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF OLD.teacher_id IS DISTINCT FROM NEW.teacher_id
  OR OLD.created_at IS DISTINCT FROM NEW.created_at
  OR (OLD.stripe_account_id IS NOT NULL
      AND NEW.stripe_account_id IS DISTINCT FROM OLD.stripe_account_id) THEN
    RAISE EXCEPTION 'stripe_connect_accounts: teacher_id/created_at immutable, and stripe_account_id is one-time (NULL->value only)';
  END IF;
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

CREATE TRIGGER stripe_connect_accounts_identity_guard
  BEFORE UPDATE ON stripe_connect_accounts
  FOR EACH ROW EXECUTE FUNCTION guard_stripe_connect_accounts_identity();

-- ─────────────────────────────────────────────────────────────────────────
-- 2. connect_payout_audit — append-only audit trail (FR-025 / FR-021 / FR-017)
-- ─────────────────────────────────────────────────────────────────────────
-- A dedicated table rather than the shared public.audit_log: audit_log has a
-- restrictive action CHECK, and broadening a shared constraint to fit new event
-- shapes drags every other writer into this migration.
CREATE TABLE connect_payout_audit (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  -- 'payout_method_change' | 'agreement_grace_change'
  -- | 'connect_cutover_set' | 'connect_cutover_rejected'
  event              text NOT NULL CHECK (btrim(event) <> ''),
  -- The actor, from the JWT 'sub' when present (admin session). NULL for a
  -- direct-DB / migration / service_role write with no user subject.
  actor              uuid,
  -- The teacher whose column changed (NULL for a settings-level event).
  subject_teacher_id uuid REFERENCES profiles(id),
  -- {"old":…,"new":…} for a column change; {"value":…} or {"attempted":…,
  -- "reason":…} for the cutover events.
  detail             jsonb NOT NULL,
  created_at         timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE connect_payout_audit IS
  'Spec 040 FR-025/FR-021: append-only audit of payout_method / agreement_grace_until changes and connect_cutover_date writes AND rejected attempts (durably persisted via the soft-refuse setter).';

CREATE INDEX idx_connect_payout_audit_teacher
  ON connect_payout_audit (subject_teacher_id);

ALTER TABLE connect_payout_audit ENABLE ROW LEVEL SECURITY;

-- FR-017: a teacher may read their own audit rows; admins read all.
CREATE POLICY "cpa_teacher_select" ON connect_payout_audit
  FOR SELECT TO authenticated
  USING (subject_teacher_id = (SELECT auth.uid()));

CREATE POLICY "cpa_admin_select" ON connect_payout_audit
  FOR SELECT TO authenticated
  USING (private.is_admin());

CREATE POLICY "cpa_service_insert" ON connect_payout_audit
  FOR INSERT TO service_role WITH CHECK (true);

-- Append-only: no UPDATE/DELETE policy AND a trigger that rejects both (missing
-- policies alone are not enough — the SECURITY DEFINER writers below would
-- otherwise be able to mutate it). Same idiom as guard_agreement_acceptance_immutable.
CREATE OR REPLACE FUNCTION guard_connect_payout_audit_immutable()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  RAISE EXCEPTION 'connect_payout_audit is append-only: audit rows cannot be modified or deleted';
  RETURN NULL;
END;
$$;

CREATE TRIGGER connect_payout_audit_immutable
  BEFORE UPDATE OR DELETE ON connect_payout_audit
  FOR EACH ROW EXECUTE FUNCTION guard_connect_payout_audit_immutable();

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
-- 4. connect_cutover_date: setting + sole-writer setter (spec FR-021)
-- ─────────────────────────────────────────────────────────────────────────
-- platform_settings.value is NOT NULL, so the "unset / new path disabled" state
-- is the EMPTY STRING (not SQL NULL). The Connect path partitions history on
-- this value; moving it after payouts begin could make the same delivery
-- payable by both paths or by neither — hence write-once.
INSERT INTO platform_settings (key, value, description) VALUES
  ('connect_cutover_date', '',
   'Spec 040 FR-021: date partitioning legacy payroll from Connect transfers. Empty = Connect path DISABLED (dormant). Written ONCE, service-role only, via set_connect_cutover_date(); any direct write/delete/rename is rejected.')
ON CONFLICT (key) DO NOTHING;

-- Never silently preserve an already-enabled value at migrate time: on a fresh
-- install the row is seeded empty above; if some earlier state left it non-blank,
-- fail the migration loudly rather than inherit an armed partition.
DO $$
DECLARE v text;
BEGIN
  SELECT value INTO v FROM platform_settings WHERE key = 'connect_cutover_date';
  IF COALESCE(btrim(v), '') <> '' THEN
    RAISE EXCEPTION 'connect_cutover_date already set to "%" before this migration — refusing to inherit an enabled partition', v;
  END IF;
END $$;

-- Sole-writer setter (FR-021). SECURITY DEFINER + REVOKE-from-clients is what
-- enforces "service-role only": an authenticated admin cannot EXECUTE it.
-- SOFT-REFUSE: business rejections (invalid date / already set) do NOT raise —
-- they persist a durable connect_payout_audit row and return a status string,
-- so every attempt is auditable (the FR-021 requirement a raising trigger
-- cannot meet, because a RAISE rolls back its own audit row).
CREATE OR REPLACE FUNCTION set_connect_cutover_date(p_value text)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor   uuid := nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub';
  v_current text;
  v_valid   boolean := false;
BEGIN
  -- Canonical YYYY-MM-DD that also casts to a real calendar date.
  IF p_value ~ '^\d{4}-\d{2}-\d{2}$' THEN
    BEGIN
      PERFORM p_value::date;
      v_valid := true;
    EXCEPTION WHEN others THEN
      v_valid := false;
    END;
  END IF;

  IF NOT v_valid THEN
    INSERT INTO connect_payout_audit (event, actor, subject_teacher_id, detail)
    VALUES ('connect_cutover_rejected', v_actor, NULL,
            jsonb_build_object('attempted', p_value, 'reason', 'invalid_date'));
    RETURN 'rejected: invalid date';
  END IF;

  SELECT value INTO v_current FROM platform_settings WHERE key = 'connect_cutover_date';
  IF COALESCE(btrim(v_current), '') <> '' THEN
    INSERT INTO connect_payout_audit (event, actor, subject_teacher_id, detail)
    VALUES ('connect_cutover_rejected', v_actor, NULL,
            jsonb_build_object('attempted', p_value, 'reason', 'already_set'));
    RETURN 'rejected: already set';
  END IF;

  -- Txn-local writer flag: the ONLY way the sole-writer guard permits the write.
  PERFORM set_config('app.connect_cutover_writer', 'on', true);
  UPDATE platform_settings SET value = p_value WHERE key = 'connect_cutover_date';
  INSERT INTO connect_payout_audit (event, actor, subject_teacher_id, detail)
  VALUES ('connect_cutover_set', v_actor, NULL, jsonb_build_object('value', p_value));
  RETURN 'applied';
END;
$$;

ALTER FUNCTION set_connect_cutover_date(text) OWNER TO postgres;
REVOKE EXECUTE ON FUNCTION set_connect_cutover_date(text) FROM public, anon, authenticated;
GRANT  EXECUTE ON FUNCTION set_connect_cutover_date(text) TO service_role;

COMMENT ON FUNCTION set_connect_cutover_date(text) IS
  'Spec 040 FR-021: the ONE sanctioned path to arm the Connect cutover. Service-role only. Soft-refuses (audits + returns status) on invalid/already-set so every attempt is durably recorded.';

-- Sole-writer guard: the setter above is the only path that may UPDATE (or the
-- migration seed INSERT, which this BEFORE UPDATE/DELETE trigger does not cover).
-- Any direct UPDATE / DELETE / key-rename lacks the txn-local writer flag and is
-- rejected. Two triggers because Postgres forbids NEW in a DELETE trigger's WHEN.
-- ponytail: the writer flag is a plain GUC, so a caller who can already UPDATE
-- the row (admins, per settings_update RLS) could in theory forge it. Accepted
-- ceiling — admins are trusted operators and the sanctioned setter is
-- service-role-locked; tighten with a signed token only if admin-forge is a
-- real threat.
CREATE OR REPLACE FUNCTION guard_connect_cutover_sole_writer()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF current_setting('app.connect_cutover_writer', true) IS DISTINCT FROM 'on' THEN
    RAISE EXCEPTION 'connect_cutover_date may only be changed via set_connect_cutover_date() (spec FR-021)'
      USING errcode = '42501';
  END IF;
  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER connect_cutover_sole_writer_update_guard
  BEFORE UPDATE ON platform_settings
  FOR EACH ROW
  WHEN (NEW.key = 'connect_cutover_date' OR OLD.key = 'connect_cutover_date')
  EXECUTE FUNCTION guard_connect_cutover_sole_writer();

CREATE TRIGGER connect_cutover_sole_writer_delete_guard
  BEFORE DELETE ON platform_settings
  FOR EACH ROW
  WHEN (OLD.key = 'connect_cutover_date')
  EXECUTE FUNCTION guard_connect_cutover_sole_writer();
