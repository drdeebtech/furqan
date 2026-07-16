-- 20260728000000_connect_earnings_ledger.sql
--
-- Spec 040 (Stripe Connect teacher payouts) — Slice 1: the earnings ledger.
--
-- Scope: data model ONLY. No sweep, no Stripe call, no UI. Nothing in this
-- migration executes on its own — the entire Connect path stays dormant in
-- production until `connect_cutover_date` is set (spec FR-021), which is a
-- later, deliberate owner action. Pure expand: new types/tables/settings only;
-- `session_deliveries`, `teacher_payouts` and `run_monthly_payroll` are
-- untouched, so the legacy payroll path is unaffected (spec FR-019/FR-022).
--
-- Idioms deliberately copied from 20260619000003_payroll_tables.sql:
--   * RLS enabled in the SAME migration, teacher-select-own + admin-select +
--     service_role write (spec FR-017 / CLAUDE.md §3).
--   * Immutable-financials trigger guard (`guard_teacher_payouts_financials`).
--
-- Sign convention (spec FR-014 — ONE definition, do not restate elsewhere):
--   every row carries a SIGNED amount_cents.
--     session / course              → positive (earning)
--     clawback                      → negative (debt created)
--     debt_recovery                 → positive (debt paid down)
--     debt_recovery_reversal        → negative (recovery undone, debt restored)
--   outstanding_debt_cents =
--     GREATEST(0, -1 * SUM(amount_cents) FILTER (WHERE kind IN
--       ('clawback','debt_recovery','debt_recovery_reversal')))
--   Earning rows are NOT part of that sum — they are what pays the debt.

-- ─────────────────────────────────────────────────────────────────────────
-- 1. Enums
-- ─────────────────────────────────────────────────────────────────────────

-- Settlement lifecycle of one payable unit.
--   pending         → eligible once the hold window elapses
--   processing      → claimed by a sweep (lease); transient
--   held            → dispute / admin hold / agreement_pending (FR-015/FR-029)
--   transferred     → paid via Stripe Connect (terminal)
--   voided          → refunded before payout; never pays (terminal)
--   debt_recovered  → fully consumed by negative balance; no Stripe call (terminal)
--   manual_due      → manual rail: owed, awaiting off-Stripe settlement (FR-026)
--   manual_paid     → manual rail: settled off-Stripe with a reference (terminal)
CREATE TYPE earning_entry_status AS ENUM (
  'pending', 'processing', 'held', 'transferred',
  'voided', 'debt_recovered', 'manual_due', 'manual_paid'
);

-- What a ledger row represents. See the sign convention above.
CREATE TYPE earning_entry_kind AS ENUM (
  'session', 'course', 'clawback', 'debt_recovery', 'debt_recovery_reversal'
);

CREATE TYPE teacher_transfer_kind AS ENUM ('transfer', 'reversal');

CREATE TYPE teacher_transfer_status AS ENUM ('pending', 'succeeded', 'failed');

CREATE TYPE payout_hold_source AS ENUM ('admin', 'dispute');

-- ─────────────────────────────────────────────────────────────────────────
-- 2. teacher_earning_entries — the ledger (spec FR-005/006/008/014)
-- ─────────────────────────────────────────────────────────────────────────
CREATE TABLE teacher_earning_entries (
  id                        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  teacher_id                uuid NOT NULL REFERENCES profiles(id),
  kind                      earning_entry_kind NOT NULL,
  -- Signed integer cents. Sign is constrained per kind below; the CHECK is the
  -- enforcement of the convention documented at the top of this file.
  amount_cents              integer NOT NULL,
  status                    earning_entry_status NOT NULL DEFAULT 'pending',

  -- Canonical source keys (spec FR-008): exactly one per earning kind.
  session_delivery_id       uuid REFERENCES session_deliveries(id),
  payment_id                uuid REFERENCES payments(id),

  -- Debt bookkeeping (spec FR-014).
  consuming_entry_id        uuid REFERENCES teacher_earning_entries(id),
  recovered_against_entry_id uuid REFERENCES teacher_earning_entries(id),
  reverses_recovery_id      uuid REFERENCES teacher_earning_entries(id),

  -- Stripe linkage (spec FR-009).
  funding_charge_id         text,
  transfer_group            text,

  -- Governing agreement version, STAMPED at materialization (spec FR-030a) —
  -- never derived by timestamp comparison.
  agreement_version         text,

  hold_reason               text,
  claimed_at                timestamptz,

  -- Manual rail settlement evidence (spec FR-027).
  external_reference_id     text,
  settled_by                uuid REFERENCES profiles(id),
  settled_at                timestamptz,

  created_at                timestamptz NOT NULL DEFAULT now(),
  updated_at                timestamptz NOT NULL DEFAULT now(),

  -- ── Sign convention, enforced ──
  CONSTRAINT chk_entry_amount_sign CHECK (
    CASE kind
      WHEN 'session'                THEN amount_cents > 0
      WHEN 'course'                 THEN amount_cents > 0
      WHEN 'clawback'               THEN amount_cents < 0
      WHEN 'debt_recovery'          THEN amount_cents > 0
      WHEN 'debt_recovery_reversal' THEN amount_cents < 0
    END
  ),

  -- ── Source key present exactly where it belongs ──
  CONSTRAINT chk_entry_session_key CHECK (
    (kind = 'session') = (session_delivery_id IS NOT NULL)
  ),
  CONSTRAINT chk_entry_course_key CHECK (
    (kind = 'course') = (payment_id IS NOT NULL)
  ),

  -- ── Debt-row FK shape (spec FR-014) ──
  -- debt_recovery MUST link both the entry that funded it and the clawback it
  -- pays down; every other kind MUST have neither.
  CONSTRAINT chk_entry_recovery_links CHECK (
    (kind = 'debt_recovery') = (consuming_entry_id IS NOT NULL)
    AND (kind = 'debt_recovery') = (recovered_against_entry_id IS NOT NULL)
  ),
  -- debt_recovery_reversal MUST reference the recovery it undoes; nothing else may.
  CONSTRAINT chk_entry_reversal_link CHECK (
    (kind = 'debt_recovery_reversal') = (reverses_recovery_id IS NOT NULL)
  ),

  -- ── Manual settlement evidence is all-or-nothing, and only when settled ──
  CONSTRAINT chk_entry_manual_settlement CHECK (
    (status = 'manual_paid')
      = (external_reference_id IS NOT NULL AND settled_by IS NOT NULL AND settled_at IS NOT NULL)
  ),
  CONSTRAINT chk_entry_reference_nonblank CHECK (
    external_reference_id IS NULL OR btrim(external_reference_id) <> ''
  )
);

COMMENT ON TABLE teacher_earning_entries IS
  'Spec 040 ledger: one row per payable unit (session/course), plus signed clawback/debt_recovery/debt_recovery_reversal rows. Dormant until connect_cutover_date is set. Sign convention + outstanding_debt formula: see migration header.';

-- ── Idempotency backstops (spec FR-008) ──
-- One earning per delivery / per course payment: re-running materialization
-- can never duplicate an earning from either source.
CREATE UNIQUE INDEX uix_earning_entries_session_delivery
  ON teacher_earning_entries (session_delivery_id)
  WHERE kind = 'session';

CREATE UNIQUE INDEX uix_earning_entries_payment
  ON teacher_earning_entries (payment_id)
  WHERE kind = 'course';

-- One recovery per consuming entry: a replayed sweep can never double-recover.
CREATE UNIQUE INDEX uix_earning_entries_recovery_consuming
  ON teacher_earning_entries (consuming_entry_id)
  WHERE kind = 'debt_recovery';

-- At most one reversal per recovery: a retried failure path can never append
-- duplicate compensations.
CREATE UNIQUE INDEX uix_earning_entries_reversal_target
  ON teacher_earning_entries (reverses_recovery_id)
  WHERE kind = 'debt_recovery_reversal';

-- Manual reference is unique per teacher — catches a pasted-twice reference.
CREATE UNIQUE INDEX uix_earning_entries_manual_reference
  ON teacher_earning_entries (teacher_id, external_reference_id)
  WHERE external_reference_id IS NOT NULL;

-- Sweep claim path + balance aggregate.
CREATE INDEX idx_earning_entries_sweep
  ON teacher_earning_entries (status, teacher_id)
  WHERE status IN ('pending', 'processing');

CREATE INDEX idx_earning_entries_teacher_kind
  ON teacher_earning_entries (teacher_id, kind);

ALTER TABLE teacher_earning_entries ENABLE ROW LEVEL SECURITY;

CREATE POLICY "tee_teacher_select" ON teacher_earning_entries
  FOR SELECT TO authenticated
  USING (teacher_id = (SELECT auth.uid()));

CREATE POLICY "tee_admin_select" ON teacher_earning_entries
  FOR SELECT TO authenticated
  USING (private.is_admin());

CREATE POLICY "tee_service_insert" ON teacher_earning_entries
  FOR INSERT TO service_role WITH CHECK (true);

CREATE POLICY "tee_service_update" ON teacher_earning_entries
  FOR UPDATE TO service_role USING (true);

-- No DELETE policy anywhere, and no authenticated UPDATE: money rows are
-- append-only to clients. Status transitions are service-role only.

-- ── Immutable financials (spec FR-016) ──
-- Mirrors guard_teacher_payouts_financials: identity/money/source/link columns
-- are frozen after insert; only the lifecycle columns may change.
CREATE OR REPLACE FUNCTION guard_earning_entries_financials()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF OLD.teacher_id IS DISTINCT FROM NEW.teacher_id
  OR OLD.kind IS DISTINCT FROM NEW.kind
  OR OLD.amount_cents IS DISTINCT FROM NEW.amount_cents
  OR OLD.session_delivery_id IS DISTINCT FROM NEW.session_delivery_id
  OR OLD.payment_id IS DISTINCT FROM NEW.payment_id
  OR OLD.consuming_entry_id IS DISTINCT FROM NEW.consuming_entry_id
  OR OLD.recovered_against_entry_id IS DISTINCT FROM NEW.recovered_against_entry_id
  OR OLD.reverses_recovery_id IS DISTINCT FROM NEW.reverses_recovery_id
  OR OLD.agreement_version IS DISTINCT FROM NEW.agreement_version
  OR OLD.created_at IS DISTINCT FROM NEW.created_at THEN
    RAISE EXCEPTION 'teacher_earning_entries: financial columns are immutable after insert (only status/hold_reason/claimed_at/settlement columns may change)';
  END IF;
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

CREATE TRIGGER earning_entries_financials_guard
  BEFORE UPDATE ON teacher_earning_entries
  FOR EACH ROW EXECUTE FUNCTION guard_earning_entries_financials();

-- ─────────────────────────────────────────────────────────────────────────
-- 3. teacher_transfers — one row per Stripe Transfer / Reversal (FR-008)
-- ─────────────────────────────────────────────────────────────────────────
CREATE TABLE teacher_transfers (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  entry_id            uuid NOT NULL REFERENCES teacher_earning_entries(id),
  teacher_id          uuid NOT NULL REFERENCES profiles(id),
  -- Denormalized for the defence-in-depth backstop below.
  session_delivery_id uuid REFERENCES session_deliveries(id),
  kind                teacher_transfer_kind NOT NULL,
  -- Signed: positive for a transfer, negative for a reversal.
  amount_cents        integer NOT NULL,
  -- Canonical identity is ENTRY-scoped so it covers every earning kind
  -- (spec FR-008, corrected 2026-07-16: a session_delivery_id-only identity is
  -- undefined for course earnings, whose source key is payment_id).
  idempotency_key     text NOT NULL UNIQUE,
  stripe_transfer_id  text UNIQUE,
  transfer_group      text,
  status              teacher_transfer_status NOT NULL DEFAULT 'pending',
  error_detail        text,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT chk_transfer_amount_sign CHECK (
    (kind = 'transfer' AND amount_cents > 0)
    OR (kind = 'reversal' AND amount_cents < 0)
  )
);

COMMENT ON TABLE teacher_transfers IS
  'Spec 040: one row per Stripe Transfer/Reversal. Rows are created synchronously by the sweep; transfer.* webhooks only reconcile status, never create rows.';

-- Primary backstop: one transfer per entry, any kind of earning.
CREATE UNIQUE INDEX uix_teacher_transfers_entry
  ON teacher_transfers (entry_id)
  WHERE kind = 'transfer';

-- Defence in depth for session earnings: one transfer per delivery even if two
-- entries ever pointed at the same delivery.
CREATE UNIQUE INDEX uix_teacher_transfers_delivery
  ON teacher_transfers (session_delivery_id)
  WHERE kind = 'transfer' AND session_delivery_id IS NOT NULL;

CREATE INDEX idx_teacher_transfers_teacher ON teacher_transfers (teacher_id);

ALTER TABLE teacher_transfers ENABLE ROW LEVEL SECURITY;

CREATE POLICY "tt_teacher_select" ON teacher_transfers
  FOR SELECT TO authenticated
  USING (teacher_id = (SELECT auth.uid()));

CREATE POLICY "tt_admin_select" ON teacher_transfers
  FOR SELECT TO authenticated
  USING (private.is_admin());

CREATE POLICY "tt_service_insert" ON teacher_transfers
  FOR INSERT TO service_role WITH CHECK (true);

CREATE POLICY "tt_service_update" ON teacher_transfers
  FOR UPDATE TO service_role USING (true);

CREATE OR REPLACE FUNCTION guard_teacher_transfers_financials()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF OLD.entry_id IS DISTINCT FROM NEW.entry_id
  OR OLD.teacher_id IS DISTINCT FROM NEW.teacher_id
  OR OLD.session_delivery_id IS DISTINCT FROM NEW.session_delivery_id
  OR OLD.kind IS DISTINCT FROM NEW.kind
  OR OLD.amount_cents IS DISTINCT FROM NEW.amount_cents
  OR OLD.idempotency_key IS DISTINCT FROM NEW.idempotency_key
  OR OLD.created_at IS DISTINCT FROM NEW.created_at THEN
    RAISE EXCEPTION 'teacher_transfers: financial columns are immutable after insert (only status/stripe_transfer_id/error_detail may change)';
  END IF;
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

CREATE TRIGGER teacher_transfers_financials_guard
  BEFORE UPDATE ON teacher_transfers
  FOR EACH ROW EXECUTE FUNCTION guard_teacher_transfers_financials();

-- ─────────────────────────────────────────────────────────────────────────
-- 4. payout_holds — per-teacher sweep blocker (spec FR-023)
-- ─────────────────────────────────────────────────────────────────────────
CREATE TABLE payout_holds (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  teacher_id   uuid NOT NULL REFERENCES profiles(id),
  source       payout_hold_source NOT NULL,
  reason       text NOT NULL CHECK (btrim(reason) <> ''),
  created_by   uuid REFERENCES profiles(id),
  created_at   timestamptz NOT NULL DEFAULT now(),
  released_at  timestamptz,
  released_by  uuid REFERENCES profiles(id)
);

COMMENT ON TABLE payout_holds IS
  'Spec 040: an unreleased row blocks the sweep for that teacher (FR-023) and is also the legal-hold predicate for agreement-evidence erasure (FR-028a).';

CREATE INDEX idx_payout_holds_active
  ON payout_holds (teacher_id)
  WHERE released_at IS NULL;

ALTER TABLE payout_holds ENABLE ROW LEVEL SECURITY;

CREATE POLICY "ph_teacher_select" ON payout_holds
  FOR SELECT TO authenticated
  USING (teacher_id = (SELECT auth.uid()));

CREATE POLICY "ph_admin_select" ON payout_holds
  FOR SELECT TO authenticated
  USING (private.is_admin());

CREATE POLICY "ph_service_insert" ON payout_holds
  FOR INSERT TO service_role WITH CHECK (true);

CREATE POLICY "ph_service_update" ON payout_holds
  FOR UPDATE TO service_role USING (true);

-- ─────────────────────────────────────────────────────────────────────────
-- 5. platform_settings (spec FR-010 / FR-031)
-- ─────────────────────────────────────────────────────────────────────────
-- The hold is DERIVED from the refund window (14 = 7 + 7 buffer). Both live in
-- the DB (single source of truth, admin-changeable without a deploy); there is
-- deliberately no env twin. A corrupt/missing hold value must fail closed in
-- the sweep (no transfer) — never default to 0 days. Slice 2 owns that reader.
INSERT INTO platform_settings (key, value, description) VALUES
  ('connect_payout_hold_days', '14',
   'Spec 040 FR-010: days after session completion (session_deliveries.delivered_at) before a teacher transfer may be attempted. Derived from refund_window_days + 7-day processing buffer. Fail closed if unset/corrupt — never 0.'),
  ('refund_window_days', '7',
   'Spec 040 FR-031: days after session completion during which a student may request a refund. connect_payout_hold_days MUST remain >= this + 7.')
ON CONFLICT (key) DO NOTHING;
