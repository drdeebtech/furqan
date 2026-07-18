-- 20260801000000_connect_sweep_functions.sql
--
-- Spec 040 (Stripe Connect teacher payouts) — Phase 1.2 (DB half) + Phase 4
-- trigger: the SweepStore SQL surface behind src/lib/domains/connect/
-- transfer-sweep.ts. One SECURITY DEFINER function per SweepStore method; each
-- does its work in ONE atomic statement/transaction. The pure orchestration
-- (runTransferSweep) and the SweepStore port already merged; this is the real
-- Postgres implementation of that port.
--
-- Scope: functions ONLY. No new table, no column, no Stripe call, no UI. Pure
-- EXPAND (backward-compatible, CLAUDE.md §4): only CREATE FUNCTION + GRANTs.
-- Nothing is dropped, renamed, narrowed. The immutable-financials trigger
-- (guard_earning_entries_financials) is UNCHANGED — every write below is a
-- status-only UPDATE or an append-only INSERT it already permits (proven in
-- scripts/walk-040-sweep-functions.sql).
--
-- DORMANT in production: claimEligibleEntries returns ZERO rows until
-- connect_cutover_date is set (empty by default — spec FR-021), so wiring a
-- cron is a no-op today. Every settlement function is unreachable until the
-- claim hands out an entry.
--
-- ── Sign convention (spec FR-014) — do NOT restate here ──────────────────────
-- The ONE definition lives in 20260728000000_connect_earnings_ledger.sql's
-- header (outstanding_debt_cents = GREATEST(0, -1*SUM(amount_cents) FILTER
-- (WHERE kind IN ('clawback','debt_recovery','debt_recovery_reversal')))). The
-- claim's debt subquery below is that formula, nothing more.
--
-- Idioms deliberately copied from the merged 040 migrations:
--   * SECURITY DEFINER + REVOKE FROM public,anon,authenticated / GRANT
--     service_role (spec-016 lockdown lesson — name anon+authenticated
--     explicitly), pinned search_path.
--   * Lease fence (`WHERE …status='processing' AND claimed_at=$lease`) mirrors
--     the FakeStore.fenced() executable spec in transfer-sweep.test.ts.

-- ─────────────────────────────────────────────────────────────────────────
-- 0. Internal helper — append one debt_recovery ledger row (spec FR-014).
-- ─────────────────────────────────────────────────────────────────────────
-- Called ONLY by the three settlement functions below (all SECURITY DEFINER,
-- postgres-owned), so it needs no client EXECUTE grant: an inner call runs as
-- the outer definer, which owns this function. No-op when p_recovered_cents<=0.
--
-- FR-014 row contract (from the ledger migration): kind='debt_recovery',
-- amount_cents POSITIVE (debt paid down), consuming_entry_id = the earning
-- entry whose settlement funded it, recovered_against_entry_id = the clawback
-- being paid down. The partial UNIQUE(consuming_entry_id) WHERE kind=
-- 'debt_recovery' makes it idempotent per consuming entry.
--
-- recovered_against_entry_id points at the OLDEST unrecovered clawback for the
-- teacher (FIFO attribution). The balance is a FLAT per-teacher aggregate, so
-- this pointer is audit attribution only — a recovery larger than a single
-- clawback still nets the aggregate correctly. status='debt_recovered' is a
-- terminal, never-claimed status (belt to the claim's kind='session' filter).
-- ponytail: FIFO attribution; per-clawback allocation only if audit ever needs it.
CREATE OR REPLACE FUNCTION connect_sweep_write_debt_recovery(
  p_consuming_entry_id uuid,
  p_teacher_id         uuid,
  p_recovered_cents    bigint
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF p_recovered_cents IS NULL OR p_recovered_cents <= 0 THEN
    RETURN;
  END IF;

  INSERT INTO teacher_earning_entries
    (teacher_id, kind, amount_cents, status,
     consuming_entry_id, recovered_against_entry_id)
  VALUES (
    p_teacher_id, 'debt_recovery', p_recovered_cents, 'debt_recovered',
    p_consuming_entry_id,
    -- Oldest clawback for this teacher. recovered>0 implies debt>0 implies a
    -- clawback exists; if the invariant were ever broken this NULL trips the
    -- chk_entry_recovery_links NOT NULL CHECK and the whole settlement rolls
    -- back (fail loud) — never a silent bad recovery row.
    (SELECT cb.id FROM teacher_earning_entries cb
      WHERE cb.teacher_id = p_teacher_id AND cb.kind = 'clawback'
      ORDER BY cb.created_at, cb.id
      LIMIT 1)
  );
END;
$$;

ALTER FUNCTION connect_sweep_write_debt_recovery(uuid, uuid, bigint) OWNER TO postgres;
REVOKE EXECUTE ON FUNCTION connect_sweep_write_debt_recovery(uuid, uuid, bigint)
  FROM public, anon, authenticated;

-- ─────────────────────────────────────────────────────────────────────────
-- 1. reclaimExpiredLeases — Step 6 crash recovery.
-- ─────────────────────────────────────────────────────────────────────────
-- Orphaned leases (processing rows whose claimed_at is older than the caller's
-- lease cutoff) return to pending so the next claim can re-lease them. Safe to
-- re-run: the Stripe idempotency key replays the original Transfer and the
-- FR-008 uniques block a duplicate row. Only 'session' entries ever reach
-- 'processing' (the claim leases kind='session'), so no kind filter is needed.
CREATE OR REPLACE FUNCTION connect_sweep_reclaim_expired_leases(
  p_lease_cutoff timestamptz
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_count integer;
BEGIN
  WITH reclaimed AS (
    UPDATE teacher_earning_entries
       SET status = 'pending', claimed_at = NULL
     WHERE status = 'processing'
       AND claimed_at IS NOT NULL
       AND claimed_at < p_lease_cutoff
    RETURNING 1
  )
  SELECT count(*) INTO v_count FROM reclaimed;
  RETURN v_count;
END;
$$;

ALTER FUNCTION connect_sweep_reclaim_expired_leases(timestamptz) OWNER TO postgres;
REVOKE EXECUTE ON FUNCTION connect_sweep_reclaim_expired_leases(timestamptz)
  FROM public, anon, authenticated;
GRANT  EXECUTE ON FUNCTION connect_sweep_reclaim_expired_leases(timestamptz)
  TO service_role;

-- ─────────────────────────────────────────────────────────────────────────
-- 2. claimEligibleEntries — Step 1, THE atomic claim (spec FR-010/021/023/026).
-- ─────────────────────────────────────────────────────────────────────────
-- One UPDATE …SET status='processing', claimed_at=p_now WHERE status='pending'
-- AND <eligible> RETURNING …. Eligibility lives INSIDE the statement, never in
-- application code (plan Phase 1.2: no TOCTOU) — a concurrent sweep finds no
-- 'pending' row and claims nothing. Claim-time it returns each entry's debt
-- snapshot, rail, destination and lease token.
--
-- Dormancy + fail-closed reads are done up front, returning ZERO rows on:
--   * connect_cutover_date empty/unset  → Connect path disabled (FR-021).
--   * connect_payout_hold_days missing/non-numeric → fail closed, NEVER 0 days
--     (FR-010); a corrupt value must not pay early. Guarded with a regex so a
--     bad value returns empty rather than raising and aborting the batch.
--
-- Eligibility, all inside the UPDATE:
--   * kind='session' — only source with a delivered_at hold reference today;
--     also excludes the debt_recovery/clawback ledger rows from ever being
--     claimed. (course hold reference is a later slice.)
--   * hold elapsed: sd.delivered_at + hold_days <= p_now, UTC (FR-010).
--   * cutover partition: sd.delivered_at >= cutover (UTC midnight) (FR-021).
--   * no active payout_holds for the teacher (FR-023).
--   * Stripe rail requires stripe_connect_accounts.payouts_enabled; the manual
--     rail is exempt (FR-026).
CREATE OR REPLACE FUNCTION connect_sweep_claim_eligible(
  p_now timestamptz
)
RETURNS TABLE (
  entry_id               uuid,
  teacher_id             uuid,
  amount_cents           bigint,
  kind                   text,
  payout_method          text,
  destination_account_id text,
  transfer_group         text,
  currency               text,
  claimed_at             timestamptz,
  outstanding_debt_cents bigint
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_hold_txt    text;
  v_hold_days   integer;
  v_cutover_txt text;
  v_cutover_ts  timestamptz;
BEGIN
  -- Fail-closed hold read: never default to 0 days (FR-010).
  SELECT value INTO v_hold_txt FROM platform_settings WHERE key = 'connect_payout_hold_days';
  IF v_hold_txt IS NULL OR btrim(v_hold_txt) !~ '^\d+$' THEN
    RETURN; -- corrupt/missing hold → claim nothing
  END IF;
  v_hold_days := btrim(v_hold_txt)::integer;

  -- Dormancy: empty cutover ⇒ Connect path disabled ⇒ claim nothing (FR-021).
  SELECT value INTO v_cutover_txt FROM platform_settings WHERE key = 'connect_cutover_date';
  IF v_cutover_txt IS NULL OR btrim(v_cutover_txt) = '' THEN
    RETURN;
  END IF;
  IF btrim(v_cutover_txt) !~ '^\d{4}-\d{2}-\d{2}$' THEN
    RETURN; -- corrupt cutover → fail closed
  END IF;
  -- UTC midnight of the cutover DATE, so the partition is timezone-explicit and
  -- matches materialize.ts's `deliveredAt < cutoverDate` (midnight UTC) boundary.
  v_cutover_ts := (btrim(v_cutover_txt)::date)::timestamp AT TIME ZONE 'UTC';

  RETURN QUERY
  UPDATE teacher_earning_entries e
     SET status = 'processing', claimed_at = p_now
   WHERE e.status = 'pending'
     AND e.kind = 'session'
     AND EXISTS (
       SELECT 1 FROM session_deliveries sd
        WHERE sd.id = e.session_delivery_id
          AND sd.delivered_at + make_interval(days => v_hold_days) <= p_now
          AND sd.delivered_at >= v_cutover_ts
     )
     AND NOT EXISTS (
       SELECT 1 FROM payout_holds ph
        WHERE ph.teacher_id = e.teacher_id AND ph.released_at IS NULL
     )
     AND EXISTS (
       SELECT 1 FROM teacher_profiles tp
        WHERE tp.teacher_id = e.teacher_id
          AND (
            tp.payout_method = 'manual'
            OR EXISTS (
              SELECT 1 FROM stripe_connect_accounts sca
               WHERE sca.teacher_id = e.teacher_id AND sca.payouts_enabled
            )
          )
     )
  RETURNING
    e.id,
    e.teacher_id,
    e.amount_cents,
    e.kind::text,
    (SELECT tp.payout_method FROM teacher_profiles tp WHERE tp.teacher_id = e.teacher_id),
    (SELECT sca.stripe_account_id FROM stripe_connect_accounts sca WHERE sca.teacher_id = e.teacher_id),
    e.transfer_group,
    'usd'::text,   -- platform is USD-only (FR-012); constant until multi-currency.
    e.claimed_at,
    -- SUM(bigint) is numeric in Postgres; cast back to bigint to match the
    -- declared RETURNS TABLE column type.
    (SELECT GREATEST(0, -1 * COALESCE(SUM(d.amount_cents), 0))::bigint
       FROM teacher_earning_entries d
      WHERE d.teacher_id = e.teacher_id
        AND d.kind IN ('clawback', 'debt_recovery', 'debt_recovery_reversal'));
END;
$$;

ALTER FUNCTION connect_sweep_claim_eligible(timestamptz) OWNER TO postgres;
REVOKE EXECUTE ON FUNCTION connect_sweep_claim_eligible(timestamptz)
  FROM public, anon, authenticated;
GRANT  EXECUTE ON FUNCTION connect_sweep_claim_eligible(timestamptz)
  TO service_role;

COMMENT ON FUNCTION connect_sweep_claim_eligible(timestamptz) IS
  'Spec 040 Phase 1.2: the atomic transfer-sweep claim. Leases eligible pending session entries (14-day hold, cutover partition, no active hold, payouts_enabled on the Stripe rail) and returns each with its claim-time debt snapshot. Dormant until connect_cutover_date is set.';

-- ─────────────────────────────────────────────────────────────────────────
-- 3. recordTransferSucceeded — Step 4 (success), fenced + atomic.
-- ─────────────────────────────────────────────────────────────────────────
-- All three writes (transfer row, optional debt_recovery row, status flip) run
-- in ONE transaction under the lease fence. The fenced flip goes FIRST: 0 rows
-- ⇒ lease lost ⇒ RETURN false having written nothing. teacher_transfers
-- UNIQUE(entry_id) WHERE kind='transfer' + UNIQUE(idempotency_key) backstop a
-- duplicate.
CREATE OR REPLACE FUNCTION connect_sweep_record_transfer_succeeded(
  p_entry_id           uuid,
  p_teacher_id         uuid,
  p_stripe_transfer_id text,
  p_amount_cents       bigint,
  p_recovered_cents    bigint,
  p_transfer_group     text,
  p_idempotency_key    text,
  p_claimed_at         timestamptz
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_session_delivery_id uuid;
  v_hit boolean := false;
BEGIN
  UPDATE teacher_earning_entries
     SET status = 'transferred'
   WHERE id = p_entry_id
     AND status = 'processing'
     AND claimed_at = p_claimed_at
  RETURNING session_delivery_id INTO v_session_delivery_id;

  GET DIAGNOSTICS v_hit = ROW_COUNT;
  IF NOT v_hit THEN
    RETURN false; -- lease lost to another sweep → abandon, no side effects.
  END IF;

  INSERT INTO teacher_transfers
    (entry_id, teacher_id, session_delivery_id, kind, amount_cents,
     idempotency_key, stripe_transfer_id, transfer_group, status)
  VALUES (p_entry_id, p_teacher_id, v_session_delivery_id, 'transfer', p_amount_cents,
          p_idempotency_key, p_stripe_transfer_id, p_transfer_group, 'succeeded');

  PERFORM connect_sweep_write_debt_recovery(p_entry_id, p_teacher_id, p_recovered_cents);
  RETURN true;
END;
$$;

ALTER FUNCTION connect_sweep_record_transfer_succeeded(uuid, uuid, text, bigint, bigint, text, text, timestamptz) OWNER TO postgres;
REVOKE EXECUTE ON FUNCTION connect_sweep_record_transfer_succeeded(uuid, uuid, text, bigint, bigint, text, text, timestamptz)
  FROM public, anon, authenticated;
GRANT  EXECUTE ON FUNCTION connect_sweep_record_transfer_succeeded(uuid, uuid, text, bigint, bigint, text, text, timestamptz)
  TO service_role;

-- ─────────────────────────────────────────────────────────────────────────
-- 4. recordTransferFailed — Step 5 (failure), fenced. Writes NOTHING else.
-- ─────────────────────────────────────────────────────────────────────────
-- processing → pending, clear the lease. NO teacher_transfers row and NO
-- debt_recovery row, so the teacher's balance re-derives unchanged and the next
-- sweep nets identically (FR-011). A failed kind='transfer' row would trip the
-- UNIQUE(entry_id)/UNIQUE(idempotency_key) backstops on the retry, so the error
-- is surfaced via app logging (logError → Sentry), never a ledger/transfer row.
CREATE OR REPLACE FUNCTION connect_sweep_record_transfer_failed(
  p_entry_id   uuid,
  p_claimed_at timestamptz
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_hit boolean := false;
BEGIN
  UPDATE teacher_earning_entries
     SET status = 'pending', claimed_at = NULL
   WHERE id = p_entry_id
     AND status = 'processing'
     AND claimed_at = p_claimed_at;

  GET DIAGNOSTICS v_hit = ROW_COUNT;
  RETURN v_hit;
END;
$$;

ALTER FUNCTION connect_sweep_record_transfer_failed(uuid, timestamptz) OWNER TO postgres;
REVOKE EXECUTE ON FUNCTION connect_sweep_record_transfer_failed(uuid, timestamptz)
  FROM public, anon, authenticated;
GRANT  EXECUTE ON FUNCTION connect_sweep_record_transfer_failed(uuid, timestamptz)
  TO service_role;

-- ─────────────────────────────────────────────────────────────────────────
-- 5. recordDebtRecovered — Step 2 (full consumption), fenced + atomic.
-- ─────────────────────────────────────────────────────────────────────────
-- The earning was consumed ENTIRELY by debt: write the debt_recovery row and
-- close the entry processing → debt_recovered, in one transaction, no Stripe.
CREATE OR REPLACE FUNCTION connect_sweep_record_debt_recovered(
  p_entry_id        uuid,
  p_teacher_id      uuid,
  p_recovered_cents bigint,
  p_claimed_at      timestamptz
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_hit boolean := false;
BEGIN
  UPDATE teacher_earning_entries
     SET status = 'debt_recovered'
   WHERE id = p_entry_id
     AND status = 'processing'
     AND claimed_at = p_claimed_at;

  GET DIAGNOSTICS v_hit = ROW_COUNT;
  IF NOT v_hit THEN
    RETURN false;
  END IF;

  PERFORM connect_sweep_write_debt_recovery(p_entry_id, p_teacher_id, p_recovered_cents);
  RETURN true;
END;
$$;

ALTER FUNCTION connect_sweep_record_debt_recovered(uuid, uuid, bigint, timestamptz) OWNER TO postgres;
REVOKE EXECUTE ON FUNCTION connect_sweep_record_debt_recovered(uuid, uuid, bigint, timestamptz)
  FROM public, anon, authenticated;
GRANT  EXECUTE ON FUNCTION connect_sweep_record_debt_recovered(uuid, uuid, bigint, timestamptz)
  TO service_role;

-- ─────────────────────────────────────────────────────────────────────────
-- 6. recordManualDue — Step 2b (manual rail), fenced + atomic.
-- ─────────────────────────────────────────────────────────────────────────
-- Manual rail: same hold + debt netting, no Stripe. Optional debt_recovery,
-- then close processing → manual_due for the admin off-Stripe queue (FR-026).
CREATE OR REPLACE FUNCTION connect_sweep_record_manual_due(
  p_entry_id        uuid,
  p_teacher_id      uuid,
  p_recovered_cents bigint,
  p_claimed_at      timestamptz
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_hit boolean := false;
BEGIN
  UPDATE teacher_earning_entries
     SET status = 'manual_due'
   WHERE id = p_entry_id
     AND status = 'processing'
     AND claimed_at = p_claimed_at;

  GET DIAGNOSTICS v_hit = ROW_COUNT;
  IF NOT v_hit THEN
    RETURN false;
  END IF;

  PERFORM connect_sweep_write_debt_recovery(p_entry_id, p_teacher_id, p_recovered_cents);
  RETURN true;
END;
$$;

ALTER FUNCTION connect_sweep_record_manual_due(uuid, uuid, bigint, timestamptz) OWNER TO postgres;
REVOKE EXECUTE ON FUNCTION connect_sweep_record_manual_due(uuid, uuid, bigint, timestamptz)
  FROM public, anon, authenticated;
GRANT  EXECUTE ON FUNCTION connect_sweep_record_manual_due(uuid, uuid, bigint, timestamptz)
  TO service_role;
