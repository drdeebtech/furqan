-- 20260807000000_connect_clawback.sql
--
-- Spec 040 Phase 3b — refund/dispute clawback + dispute holds (FR-013/014/015).
--
-- EXPAND-only, DORMANT: nothing here executes until the platform webhook
-- handlers (same PR) receive charge.refunded / charge.dispute.* events for
-- charges linked to Connect earning entries, which cannot exist in production
-- until `connect_cutover_date` is armed (FR-021). teacher_earning_entries is
-- empty in production, so the added CHECK constraints validate instantly.
--
-- Money-safety invariants owned by this migration:
--   * Per-source idempotency IN THE DB: a `charge.refunded` event re-delivers
--     every prior refund object (Stripe embeds the cumulative refunds list),
--     so event-level dedup (billing_events UNIQUE) is NOT sufficient — the
--     partial UNIQUE (clawback_of_entry_id, source_reference_id) is what makes
--     replay a no-op per refund/dispute per entry.
--   * Never over-claw: every write path re-computes the entry's remaining
--     reclaimable amount (amount_cents − prior clawbacks − prior reversal
--     rows, pending AND succeeded) under a row lock and CLAMPS the write.
--     Refund + dispute combinations can never take back more than the teacher
--     earned from that entry.
--   * RESERVE-FIRST fencing for Stripe reversals (adversarial-review P0): the
--     reversal row is written status='pending' BEFORE the Stripe call and
--     confirmed after, the same create-row-first discipline as the sweep.
--     Two sources planning against the same entry serialize on the row lock
--     at reserve time, so their combined reservations respect the cap, the
--     Stripe amount is frozen in the DB (stable across retries — no
--     idempotency-key parameter drift), and a crash between reserve and the
--     Stripe call is healed by any later redelivery resuming the pending
--     reservation. No interleaving can orphan a live reversal.
--   * Void only CLEAN entries: an unsettled entry with zero prior clawbacks
--     whose full amount is being reclaimed is voided (terminal, never pays).
--     An entry that already carries partial clawback debt is NEVER voided —
--     voiding it would stack the outstanding debt on top of the lost earning
--     (over-claw); it stays payable and FR-014 netting settles the difference.
--   * Dispute holds are BOTH entry-level (FR-015: pending/manual_due → held)
--     and teacher-level (payout_holds source='dispute' — the enum value
--     reserved for exactly this in the ledger migration): the entry-level
--     hold cannot cover an entry that is 'processing' under a sweep lease
--     and later falls back to 'pending' (transfer failure, expired lease);
--     the teacher-level row blocks the claim (FR-023 filter) for the whole
--     dispute window, closing that re-entry gap (adversarial-review P1).
--
-- Sign convention & outstanding-debt formula: defined ONCE in
-- 20260728000000_connect_earnings_ledger.sql — clawback rows are negative.
-- Idiom: SECURITY DEFINER + spec-016 lockdown + pinned search_path + OWNER.

-- ─────────────────────────────────────────────────────────────────────────
-- 1. Ledger columns: clawback provenance (FR-013)
-- ─────────────────────────────────────────────────────────────────────────
ALTER TABLE teacher_earning_entries
  ADD COLUMN clawback_of_entry_id uuid REFERENCES teacher_earning_entries(id),
  ADD COLUMN source_reference_id  text;

COMMENT ON COLUMN teacher_earning_entries.clawback_of_entry_id IS
  'Spec 040 FR-013: for kind=clawback, the earning entry this clawback reverses.';
COMMENT ON COLUMN teacher_earning_entries.source_reference_id IS
  'Spec 040 FR-013: for kind=clawback, the Stripe refund (re_*) or dispute (dp_*) id that caused it — the replay-idempotency key together with clawback_of_entry_id.';

-- Shape: exactly clawback rows carry both, nothing else may (same idiom as
-- chk_entry_recovery_links). ELSE-false lesson does not apply: these are
-- biconditionals, NULL kinds are impossible (NOT NULL enum).
ALTER TABLE teacher_earning_entries
  ADD CONSTRAINT chk_entry_clawback_links CHECK (
    ((kind = 'clawback') = (clawback_of_entry_id IS NOT NULL))
    AND ((kind = 'clawback') = (source_reference_id IS NOT NULL))
  );

-- Replay backstop: one clawback per (source entry, refund/dispute id).
CREATE UNIQUE INDEX uix_earning_entries_clawback_source
  ON teacher_earning_entries (clawback_of_entry_id, source_reference_id)
  WHERE kind = 'clawback';

-- Clawback listing path (per funding charge).
CREATE INDEX idx_earning_entries_funding_charge
  ON teacher_earning_entries (funding_charge_id)
  WHERE funding_charge_id IS NOT NULL;

-- Reversal-row lookups (cap computation + replay gate): the ledger's
-- uix_teacher_transfers_entry is partial on kind='transfer' and cannot serve
-- kind='reversal' scans (DB-review P1 — would seq-scan at scale).
CREATE INDEX idx_teacher_transfers_entry_reversal
  ON teacher_transfers (entry_id)
  WHERE kind = 'reversal';

-- Dispute release path: find this dispute's held entries without scanning the
-- whole ledger (DB-review P1).
CREATE INDEX idx_earning_entries_held_reason
  ON teacher_earning_entries (hold_reason)
  WHERE status = 'held';

-- Extend the immutability guard: the new provenance columns are financial —
-- frozen after insert (full replace of the Phase-0 function; the added lines
-- are the two clawback columns).
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
  OR OLD.clawback_of_entry_id IS DISTINCT FROM NEW.clawback_of_entry_id
  OR OLD.source_reference_id IS DISTINCT FROM NEW.source_reference_id
  OR OLD.agreement_version IS DISTINCT FROM NEW.agreement_version
  OR OLD.funding_charge_id IS DISTINCT FROM NEW.funding_charge_id
  OR OLD.transfer_group IS DISTINCT FROM NEW.transfer_group
  OR OLD.created_at IS DISTINCT FROM NEW.created_at THEN
    RAISE EXCEPTION 'teacher_earning_entries: financial columns are immutable after insert (only status/hold_reason/claimed_at/settlement columns may change)';
  END IF;
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

-- payout_holds release attribution: dispute-source holds are created AND
-- released by the Stripe webhook, which has no human actor — the Phase-0
-- all-or-nothing rule stays for admin holds only. Dropping a CHECK widens
-- accepted rows; no live code writes dispute releases before this PR.
-- expand-contract-ok: replacing a CHECK with a strictly weaker one (widening); table empty in production (dormant until FR-021 cutover)
ALTER TABLE payout_holds
  DROP CONSTRAINT chk_payout_hold_release_attribution;
ALTER TABLE payout_holds
  ADD CONSTRAINT chk_payout_hold_release_attribution CHECK (
    source = 'dispute' OR ((released_at IS NOT NULL) = (released_by IS NOT NULL))
  );

-- ─────────────────────────────────────────────────────────────────────────
-- 2. connect_clawback_list_entries — read side of the two-phase flow
-- ─────────────────────────────────────────────────────────────────────────
-- Lists every claw-relevant entry funded by a charge with its remaining
-- reclaimable amount and (if settled via Stripe) the transfer to reverse.
-- `source_already_applied` is the replay gate for the UNSETTLED (apply) path;
-- the settled path always routes through reserve/confirm, which resolve
-- replays and resume crashed reservations themselves — the caller must NOT
-- short-circuit a transferred entry on this flag alone.
-- Read-only snapshot otherwise: the write RPCs re-clamp under a row lock, so
-- a stale read can overstate remaining but never over-claw.
CREATE OR REPLACE FUNCTION connect_clawback_list_entries(
  p_funding_charge_id   text,
  p_source_reference_id text
)
RETURNS TABLE (
  entry_id               uuid,
  teacher_id             uuid,
  status                 text,
  amount_cents           bigint,
  remaining_cap_cents    bigint,
  stripe_transfer_id     text,
  source_already_applied boolean
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF p_funding_charge_id IS NULL OR btrim(p_funding_charge_id) = '' THEN
    RAISE EXCEPTION 'connect_clawback_list_entries: funding_charge_id must be non-empty';
  END IF;
  IF p_source_reference_id IS NULL OR btrim(p_source_reference_id) = '' THEN
    RAISE EXCEPTION 'connect_clawback_list_entries: source_reference_id must be non-empty';
  END IF;

  RETURN QUERY
  SELECT
    e.id,
    e.teacher_id,
    e.status::text,
    e.amount_cents,
    GREATEST(0, e.amount_cents
      - COALESCE((SELECT -1 * SUM(cb.amount_cents) FROM teacher_earning_entries cb
                   WHERE cb.clawback_of_entry_id = e.id AND cb.kind = 'clawback'), 0)
      - COALESCE((SELECT -1 * SUM(tt.amount_cents) FROM teacher_transfers tt
                   WHERE tt.entry_id = e.id AND tt.kind = 'reversal'), 0))::bigint,
    -- The Stripe transfer that paid this entry, if any (status-agnostic:
    -- 'pending' only means the transfer.created webhook has not confirmed
    -- yet — the transfer exists on Stripe and is the reversal target).
    (SELECT tt.stripe_transfer_id FROM teacher_transfers tt
      WHERE tt.entry_id = e.id AND tt.kind = 'transfer'
        AND tt.stripe_transfer_id IS NOT NULL
      LIMIT 1),
    -- Replay gate (apply path): has THIS refund/dispute already clawed or
    -- reserved against this entry? (idempotency_key shape is
    -- reversal:{source}:{transfer} — the middle segment is the source id;
    -- Stripe re_*/dp_* ids never contain ':').
    (EXISTS (SELECT 1 FROM teacher_earning_entries cb
              WHERE cb.clawback_of_entry_id = e.id AND cb.kind = 'clawback'
                AND cb.source_reference_id = btrim(p_source_reference_id))
     OR EXISTS (SELECT 1 FROM teacher_transfers tt
                 WHERE tt.entry_id = e.id AND tt.kind = 'reversal'
                   AND split_part(tt.idempotency_key, ':', 2) = btrim(p_source_reference_id)))
  FROM teacher_earning_entries e
  WHERE e.funding_charge_id = btrim(p_funding_charge_id)
    AND e.kind IN ('session', 'course')
    AND e.status <> 'voided';
END;
$$;

-- ─────────────────────────────────────────────────────────────────────────
-- 3. connect_clawback_apply — write a capped clawback row (or void)
-- ─────────────────────────────────────────────────────────────────────────
-- For entries NOT settled through a reversible Stripe transfer (pending /
-- held / manual_due / manual_paid / debt_recovered / processing). Outcomes:
--   'voided'            → clean full reclaim of an unsettled entry
--   'clawback_recorded' → negative ledger row written (FR-014 netting pays it)
--   'already_applied'   → replay (this source already clawed this entry)
--   'nothing_to_apply'  → cap exhausted or amount rounds to zero
--
-- 'processing' entries (sweep lease in flight) are NEVER voided — the fenced
-- sweep owns their status; the clawback row is still written and nets later.
-- A live-transferred entry is REFUSED (DB-review P1 TOCTOU): if the sweep
-- settled the entry between the caller's snapshot and this call, writing
-- passive debt would silently downgrade a live Stripe reversal — raising
-- makes the event retry and re-route through reserve/confirm.
CREATE OR REPLACE FUNCTION connect_clawback_apply(
  p_entry_id            uuid,
  p_source_reference_id text,
  p_clawback_cents      bigint
)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_entry     teacher_earning_entries%ROWTYPE;
  v_reclaimed bigint;
  v_remaining bigint;
  v_apply     bigint;
  v_ins       integer;
BEGIN
  IF p_source_reference_id IS NULL OR btrim(p_source_reference_id) = '' THEN
    RAISE EXCEPTION 'connect_clawback_apply: source_reference_id must be non-empty';
  END IF;
  IF p_clawback_cents IS NULL OR p_clawback_cents <= 0 THEN
    RETURN 'nothing_to_apply';
  END IF;

  SELECT * INTO v_entry FROM teacher_earning_entries
   WHERE id = p_entry_id AND kind IN ('session', 'course')
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'connect_clawback_apply: entry % not found or not an earning', p_entry_id;
  END IF;
  IF v_entry.status = 'voided' THEN
    RETURN 'nothing_to_apply'; -- already never-pays; replay after a void lands here
  END IF;
  IF v_entry.status = 'transferred'
     OR EXISTS (SELECT 1 FROM teacher_transfers tt
                 WHERE tt.entry_id = p_entry_id AND tt.kind = 'transfer') THEN
    RAISE EXCEPTION 'connect_clawback_apply: entry % is settled via Stripe — route through connect_clawback_reserve_reversal', p_entry_id;
  END IF;

  -- Replay guard (belt: the partial UNIQUE + ON CONFLICT below are the
  -- suspenders).
  IF EXISTS (SELECT 1 FROM teacher_earning_entries cb
              WHERE cb.clawback_of_entry_id = p_entry_id
                AND cb.source_reference_id = btrim(p_source_reference_id)
                AND cb.kind = 'clawback') THEN
    RETURN 'already_applied';
  END IF;

  SELECT COALESCE(-1 * SUM(cb.amount_cents), 0)
       + COALESCE((SELECT -1 * SUM(tt.amount_cents) FROM teacher_transfers tt
                    WHERE tt.entry_id = p_entry_id AND tt.kind = 'reversal'), 0)
    INTO v_reclaimed
    FROM teacher_earning_entries cb
   WHERE cb.clawback_of_entry_id = p_entry_id AND cb.kind = 'clawback';

  v_remaining := GREATEST(0, v_entry.amount_cents - v_reclaimed);
  v_apply := LEAST(p_clawback_cents, v_remaining);
  IF v_apply <= 0 THEN
    RETURN 'nothing_to_apply';
  END IF;

  -- Clean full reclaim of an unsettled entry → void (FR-013/FR-015 "void"):
  -- terminal, never pays, no debt rows. Only when NOTHING was previously
  -- reclaimed — see the header for why a partially-clawed entry must never
  -- be voided (over-claw).
  IF v_entry.status IN ('pending', 'held', 'manual_due')
     AND v_reclaimed = 0
     AND v_apply >= v_entry.amount_cents THEN
    UPDATE teacher_earning_entries
       SET status = 'voided', hold_reason = NULL
     WHERE id = p_entry_id;
    RETURN 'voided';
  END IF;

  -- Negative debt row (sign convention: clawback < 0). status 'voided' is the
  -- terminal never-claimed lifecycle for non-payable ledger rows (same role
  -- 'debt_recovered' plays for recovery rows): the sweep claims only
  -- kind='session' AND status='pending', and outstanding debt is computed
  -- from kind alone, so status here is display/lifecycle only.
  INSERT INTO teacher_earning_entries
    (teacher_id, kind, amount_cents, status,
     clawback_of_entry_id, source_reference_id, funding_charge_id)
  VALUES
    (v_entry.teacher_id, 'clawback', -1 * v_apply, 'voided',
     p_entry_id, btrim(p_source_reference_id), v_entry.funding_charge_id)
  ON CONFLICT (clawback_of_entry_id, source_reference_id) WHERE kind = 'clawback'
  DO NOTHING;
  GET DIAGNOSTICS v_ins = ROW_COUNT;
  IF v_ins = 0 THEN
    RETURN 'already_applied'; -- defence in depth if a future path skips the lock
  END IF;

  RETURN 'clawback_recorded';
END;
$$;

-- ─────────────────────────────────────────────────────────────────────────
-- 4. Reserve/confirm — Stripe reversal fencing (FR-013)
-- ─────────────────────────────────────────────────────────────────────────
-- connect_clawback_reserve_reversal: called BEFORE stripe.transfers
-- .createReversal. Under the entry row lock it clamps the requested split to
-- the remaining reclaimable amount, writes the reversal row status='pending'
-- (amount frozen — every retry sends the same cents to Stripe under the same
-- idempotency key `reversal:{source}:{transfer}`) and the shortfall clawback
-- row atomically. Outcomes:
--   'reserved'           → proceed to Stripe with reversed_cents, then confirm
--   'already_reserved'   → replay/crash-resume: amounts are the ORIGINAL
--                          reservation; proceed to Stripe+confirm only when
--                          already_confirmed is false
--   'nothing_to_reserve' → cap exhausted / rounds to zero
CREATE OR REPLACE FUNCTION connect_clawback_reserve_reversal(
  p_entry_id            uuid,
  p_source_reference_id text,
  p_stripe_transfer_id  text,
  p_reversed_cents      bigint,
  p_shortfall_cents     bigint
)
RETURNS TABLE (
  outcome           text,
  reversed_cents    bigint,
  shortfall_cents   bigint,
  already_confirmed boolean
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_entry     teacher_earning_entries%ROWTYPE;
  v_key       text;
  v_rev_row   teacher_transfers%ROWTYPE;
  v_cb_cents  bigint;
  v_reclaimed bigint;
  v_remaining bigint;
  v_rev       bigint;
  v_short     bigint;
BEGIN
  IF p_source_reference_id IS NULL OR btrim(p_source_reference_id) = '' THEN
    RAISE EXCEPTION 'connect_clawback_reserve_reversal: source_reference_id must be non-empty';
  END IF;
  IF p_stripe_transfer_id IS NULL OR btrim(p_stripe_transfer_id) = '' THEN
    RAISE EXCEPTION 'connect_clawback_reserve_reversal: stripe_transfer_id must be non-empty';
  END IF;
  IF p_reversed_cents IS NULL OR p_reversed_cents < 0
     OR p_shortfall_cents IS NULL OR p_shortfall_cents < 0 THEN
    RAISE EXCEPTION 'connect_clawback_reserve_reversal: cents must be >= 0';
  END IF;

  SELECT * INTO v_entry FROM teacher_earning_entries
   WHERE id = p_entry_id AND kind IN ('session', 'course')
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'connect_clawback_reserve_reversal: entry % not found or not an earning', p_entry_id;
  END IF;

  v_key := 'reversal:' || btrim(p_source_reference_id) || ':' || btrim(p_stripe_transfer_id);

  -- Replay / crash-resume: an existing reservation is authoritative — return
  -- ITS amounts so the Stripe call parameters never drift across retries.
  SELECT * INTO v_rev_row FROM teacher_transfers
   WHERE idempotency_key = v_key AND kind = 'reversal';
  IF FOUND THEN
    SELECT COALESCE(-1 * cb.amount_cents, 0) INTO v_cb_cents
      FROM teacher_earning_entries cb
     WHERE cb.clawback_of_entry_id = p_entry_id
       AND cb.source_reference_id = btrim(p_source_reference_id)
       AND cb.kind = 'clawback';
    RETURN QUERY SELECT 'already_reserved'::text,
                        -1 * v_rev_row.amount_cents,
                        COALESCE(v_cb_cents, 0),
                        v_rev_row.status = 'succeeded';
    RETURN;
  END IF;

  -- Shortfall-only prior pass (nothing was reversible then): fully done.
  SELECT -1 * cb.amount_cents INTO v_cb_cents
    FROM teacher_earning_entries cb
   WHERE cb.clawback_of_entry_id = p_entry_id
     AND cb.source_reference_id = btrim(p_source_reference_id)
     AND cb.kind = 'clawback';
  IF FOUND THEN
    RETURN QUERY SELECT 'already_reserved'::text, 0::bigint, v_cb_cents, true;
    RETURN;
  END IF;

  SELECT COALESCE(-1 * SUM(cb.amount_cents), 0)
       + COALESCE((SELECT -1 * SUM(tt.amount_cents) FROM teacher_transfers tt
                    WHERE tt.entry_id = p_entry_id AND tt.kind = 'reversal'), 0)
    INTO v_reclaimed
    FROM teacher_earning_entries cb
   WHERE cb.clawback_of_entry_id = p_entry_id AND cb.kind = 'clawback';

  v_remaining := GREATEST(0, v_entry.amount_cents - v_reclaimed);
  v_rev   := LEAST(p_reversed_cents, v_remaining);
  v_short := LEAST(p_shortfall_cents, GREATEST(0, v_remaining - v_rev));
  IF v_rev <= 0 AND v_short <= 0 THEN
    RETURN QUERY SELECT 'nothing_to_reserve'::text, 0::bigint, 0::bigint, true;
    RETURN;
  END IF;

  IF v_rev > 0 THEN
    -- stripe_transfer_id stays NULL until confirm stamps the reversal id
    -- (trr_*); the ORIGINAL transfer id lives in the idempotency key.
    INSERT INTO teacher_transfers
      (entry_id, teacher_id, session_delivery_id, kind, amount_cents,
       idempotency_key, status)
    VALUES
      (p_entry_id, v_entry.teacher_id, v_entry.session_delivery_id, 'reversal',
       -1 * v_rev, v_key, 'pending');
  END IF;

  IF v_short > 0 THEN
    INSERT INTO teacher_earning_entries
      (teacher_id, kind, amount_cents, status,
       clawback_of_entry_id, source_reference_id, funding_charge_id)
    VALUES
      (v_entry.teacher_id, 'clawback', -1 * v_short, 'voided',
       p_entry_id, btrim(p_source_reference_id), v_entry.funding_charge_id)
    ON CONFLICT (clawback_of_entry_id, source_reference_id) WHERE kind = 'clawback'
    DO NOTHING;
  END IF;

  RETURN QUERY SELECT 'reserved'::text, v_rev, v_short, false;
END;
$$;

-- connect_clawback_confirm_reversal: called AFTER createReversal succeeds.
-- Stamps the Stripe reversal id and flips pending → succeeded. Idempotent.
CREATE OR REPLACE FUNCTION connect_clawback_confirm_reversal(
  p_idempotency_key    text,
  p_stripe_reversal_id text
)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_n integer;
BEGIN
  IF p_idempotency_key IS NULL OR btrim(p_idempotency_key) = ''
     OR p_stripe_reversal_id IS NULL OR btrim(p_stripe_reversal_id) = '' THEN
    RAISE EXCEPTION 'connect_clawback_confirm_reversal: arguments must be non-empty';
  END IF;

  UPDATE teacher_transfers
     SET status = 'succeeded', stripe_transfer_id = btrim(p_stripe_reversal_id)
   WHERE idempotency_key = btrim(p_idempotency_key)
     AND kind = 'reversal' AND status = 'pending';
  GET DIAGNOSTICS v_n = ROW_COUNT;
  IF v_n = 1 THEN
    RETURN 'confirmed';
  END IF;

  IF EXISTS (SELECT 1 FROM teacher_transfers
              WHERE idempotency_key = btrim(p_idempotency_key)
                AND kind = 'reversal' AND status = 'succeeded') THEN
    RETURN 'already_confirmed';
  END IF;
  RAISE EXCEPTION 'connect_clawback_confirm_reversal: no reservation for key %', p_idempotency_key;
END;
$$;

-- ─────────────────────────────────────────────────────────────────────────
-- 5. Dispute holds (FR-015) — entry-level + teacher-level, keyed by dispute
-- ─────────────────────────────────────────────────────────────────────────
-- Entry hold covers 'pending' AND 'manual_due' (FR-027a: the manual rail is
-- not exempt — a held manual_due entry cannot be settled by the admin action,
-- whose atomic UPDATE requires status='manual_due'). 'processing' is left to
-- the sweep lease — which is exactly why the TEACHER-level payout_holds row
-- exists: a processing entry that falls back to 'pending' (transfer failure,
-- expired lease) mid-dispute would otherwise be claimable by the next sweep;
-- the FR-023 claim filter blocks the whole teacher until release.
-- Release restores 'pending' uniformly — the next sweep re-derives the
-- manual rail from teacher_profiles.payout_method, so no rail state is lost.
-- Entries held for OTHER reasons (agreement_pending, prior dispute) are
-- untouched by both directions: hold converts only pending/manual_due, and
-- release matches only this dispute's own hold_reason.
CREATE OR REPLACE FUNCTION connect_dispute_hold(
  p_funding_charge_id text,
  p_dispute_id        text
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_reason text;
  v_count  integer;
BEGIN
  IF p_funding_charge_id IS NULL OR btrim(p_funding_charge_id) = '' THEN
    RAISE EXCEPTION 'connect_dispute_hold: funding_charge_id must be non-empty';
  END IF;
  IF p_dispute_id IS NULL OR btrim(p_dispute_id) = '' THEN
    RAISE EXCEPTION 'connect_dispute_hold: dispute_id must be non-empty';
  END IF;
  v_reason := 'dispute:' || btrim(p_dispute_id);

  UPDATE teacher_earning_entries e
     SET status = 'held', hold_reason = v_reason
   WHERE e.funding_charge_id = btrim(p_funding_charge_id)
     AND e.kind IN ('session', 'course')
     AND e.status IN ('pending', 'manual_due');
  GET DIAGNOSTICS v_count = ROW_COUNT;

  -- Teacher-level hold for every teacher with money still in motion on this
  -- charge (idempotent per teacher+dispute via the NOT EXISTS).
  INSERT INTO payout_holds (teacher_id, source, reason)
  SELECT DISTINCT e.teacher_id, 'dispute'::payout_hold_source, v_reason
    FROM teacher_earning_entries e
   WHERE e.funding_charge_id = btrim(p_funding_charge_id)
     AND e.kind IN ('session', 'course')
     AND e.status IN ('pending', 'processing', 'manual_due', 'held')
     AND NOT EXISTS (
       SELECT 1 FROM payout_holds ph
        WHERE ph.teacher_id = e.teacher_id
          AND ph.reason = v_reason
          AND ph.released_at IS NULL
     );

  RETURN v_count;
END;
$$;

CREATE OR REPLACE FUNCTION connect_dispute_release(
  p_dispute_id text
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_reason text;
  v_count  integer;
BEGIN
  IF p_dispute_id IS NULL OR btrim(p_dispute_id) = '' THEN
    RAISE EXCEPTION 'connect_dispute_release: dispute_id must be non-empty';
  END IF;
  v_reason := 'dispute:' || btrim(p_dispute_id);

  UPDATE teacher_earning_entries e
     SET status = 'pending', hold_reason = NULL
   WHERE e.status = 'held'
     AND e.hold_reason = v_reason;
  GET DIAGNOSTICS v_count = ROW_COUNT;

  -- released_by stays NULL: webhook actor, permitted for source='dispute'
  -- by the softened attribution CHECK above.
  UPDATE payout_holds
     SET released_at = now()
   WHERE source = 'dispute'
     AND reason = v_reason
     AND released_at IS NULL;

  RETURN v_count;
END;
$$;

-- ─────────────────────────────────────────────────────────────────────────
-- 6. Lockdown (spec-016) — service_role only, all six
-- ─────────────────────────────────────────────────────────────────────────
ALTER FUNCTION connect_clawback_list_entries(text, text) OWNER TO postgres;
REVOKE EXECUTE ON FUNCTION connect_clawback_list_entries(text, text)
  FROM public, anon, authenticated;
GRANT  EXECUTE ON FUNCTION connect_clawback_list_entries(text, text)
  TO service_role;

ALTER FUNCTION connect_clawback_apply(uuid, text, bigint) OWNER TO postgres;
REVOKE EXECUTE ON FUNCTION connect_clawback_apply(uuid, text, bigint)
  FROM public, anon, authenticated;
GRANT  EXECUTE ON FUNCTION connect_clawback_apply(uuid, text, bigint)
  TO service_role;

ALTER FUNCTION connect_clawback_reserve_reversal(uuid, text, text, bigint, bigint) OWNER TO postgres;
REVOKE EXECUTE ON FUNCTION connect_clawback_reserve_reversal(uuid, text, text, bigint, bigint)
  FROM public, anon, authenticated;
GRANT  EXECUTE ON FUNCTION connect_clawback_reserve_reversal(uuid, text, text, bigint, bigint)
  TO service_role;

ALTER FUNCTION connect_clawback_confirm_reversal(text, text) OWNER TO postgres;
REVOKE EXECUTE ON FUNCTION connect_clawback_confirm_reversal(text, text)
  FROM public, anon, authenticated;
GRANT  EXECUTE ON FUNCTION connect_clawback_confirm_reversal(text, text)
  TO service_role;

ALTER FUNCTION connect_dispute_hold(text, text) OWNER TO postgres;
REVOKE EXECUTE ON FUNCTION connect_dispute_hold(text, text)
  FROM public, anon, authenticated;
GRANT  EXECUTE ON FUNCTION connect_dispute_hold(text, text)
  TO service_role;

ALTER FUNCTION connect_dispute_release(text) OWNER TO postgres;
REVOKE EXECUTE ON FUNCTION connect_dispute_release(text)
  FROM public, anon, authenticated;
GRANT  EXECUTE ON FUNCTION connect_dispute_release(text)
  TO service_role;

COMMENT ON FUNCTION connect_clawback_list_entries(text, text) IS
  'Spec 040 FR-013: entries funded by a charge with remaining reclaimable cents and transfer target. Read side; write RPCs re-clamp under lock. Service-role only.';
COMMENT ON FUNCTION connect_clawback_apply(uuid, text, bigint) IS
  'Spec 040 FR-013/014: capped clawback row (or void, when a clean unsettled entry is fully reclaimed). Idempotent per (entry, source). Refuses settled entries. Service-role only.';
COMMENT ON FUNCTION connect_clawback_reserve_reversal(uuid, text, text, bigint, bigint) IS
  'Spec 040 FR-013: reserve a Stripe transfer reversal (pending row, clamped under lock, amount frozen) + shortfall debt atomically, BEFORE the Stripe call. Idempotent per (source, transfer). Service-role only.';
COMMENT ON FUNCTION connect_clawback_confirm_reversal(text, text) IS
  'Spec 040 FR-013: confirm a reserved reversal after Stripe succeeds (pending → succeeded, stamps trr_*). Idempotent. Service-role only.';
COMMENT ON FUNCTION connect_dispute_hold(text, text) IS
  'Spec 040 FR-015: hold pending/manual_due entries funded by a disputed charge (hold_reason dispute:{id}) + teacher-level payout_holds row (covers processing re-entry). Idempotent. Service-role only.';
COMMENT ON FUNCTION connect_dispute_release(text) IS
  'Spec 040 FR-015: release this dispute''s own entry holds back to pending and close its payout_holds rows. Idempotent. Service-role only.';
