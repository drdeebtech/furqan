-- 20260809000000_connect_materialize_earnings.sql
--
-- Spec 040 (Stripe Connect payouts) — the MATERIALIZATION wiring (plan Phase 1
-- item 10): the one function that turns delivered sessions into ledger rows.
-- Decision recorded in the plan: **sweep-side derivation, no trigger on the hot
-- finalize path** — `finalize_attendance` (history of P0s) stays untouched; the
-- sweep (and the refund/dispute webhook path, see below) derives entries
-- read-only from `session_deliveries`.
--
-- Pure expand, dormant: with `connect_cutover_date` unset the function returns
-- zeros and writes nothing (FR-021).
--
-- What one derived row carries:
--   * amount_cents      — connect_earning_cents(duration, snapshotted rate),
--                         the FR-006 canonical rule (SQL twin, parity-proven).
--   * status            — 'pending' when the teacher has ACCEPTED the CURRENT
--                         agreement version, else 'held'/'agreement_pending'
--                         (FR-029/SC-014). The acceptance read happens in the
--                         SAME statement as the insert; the commit-order race
--                         that remains is healed by the reconciliation pass
--                         below. connect_accept_agreement releases these holds.
--   * agreement_version — STAMPED from platform_settings at materialization
--                         (FR-030a; never timestamp-derived). A missing/blank
--                         setting while the system is armed RAISES (config
--                         bug) — an unstamped entry would make the FR-028a
--                         retention predicate unanswerable.
--   * funding_charge_id — the Stripe **PaymentIntent id** (`pi_…`) of the
--                         charge-funded payment, resolved via
--                         sessions.booking_id → payments.booking_id.
--                         ⚠ SEMANTICS: the DB never stores a `ch_…` charge id
--                         (payments carries `stripe_payment_intent` only), so
--                         this column holds the PI id where identifiable and
--                         NULL for subscription-credit-funded deliveries
--                         (FR-009). The refund/dispute webhook path therefore
--                         matches entries by BOTH the event's charge id AND its
--                         payment_intent id (src/lib/domains/connect/clawback.ts).
--   * transfer_group    — 'delivery_' || session_delivery_id for every session
--                         entry (spec acceptance #5's credit-funded rule,
--                         applied uniformly). Stamping the same group back onto
--                         the originating charge (charge-funded case) is the
--                         later checkout-traceability slice; a Charge's
--                         transfer_group is updatable after creation.
--
-- Idempotency: re-running can never duplicate — the NOT EXISTS pre-filter plus
-- ON CONFLICT on the partial UNIQUE (session_delivery_id WHERE kind='session')
-- make a concurrent double-run insert exactly one row per delivery (FR-008
-- alignment). Voided/clawed entries KEEP their session_delivery_id, so a
-- refunded-then-voided delivery can never re-materialize as a fresh payable.
--
-- Poison-row guard: a post-cutover delivery whose derived amount is not a
-- positive integer (rate snapshotted as 0, or a degenerate duration×rate that
-- rounds to 0 cents) would violate chk_entry_amount_sign and abort the whole
-- batch forever. Such rows are SKIPPED and counted in `skipped_invalid_amount`
-- so the sweep can surface them loudly (a skipped earning is a data bug to fix,
-- never a silent $0 — same posture as ConnectEarningError).
--
-- Who calls it:
--   * the transfer sweep, first step of every run (cron + admin trigger);
--   * the refund/dispute webhook path, BEFORE matching entries — this closes
--     the race where a refund lands in the minutes between delivery and the
--     first sweep and would otherwise find no entry to void/claw.
--
-- Self-healing reconciliation (adversarial-review P1): under READ COMMITTED an
-- acceptance can commit while the materialization INSERT's snapshot is already
-- taken — the acceptance's release UPDATE cannot see the uncommitted insert,
-- and the insert stamps 'held' for a teacher who HAS accepted. Without repair
-- that row is frozen forever (accept is replay-safe but the teacher never
-- re-clicks; the sweep claims only 'pending'). So every run ends with a second
-- statement (fresh snapshot) releasing held/agreement_pending entries whose
-- STAMPED version the teacher has accepted at any time — which also unsticks
-- the version-bump dead end (entry stamped v1, current bumped to v2, teacher
-- accepts v2: v1's acceptance row is append-only history, so if it exists the
-- teacher did consent to the stamped terms).
--
-- Multi-payment note: payments.booking_id is UNIQUE (baseline
-- payments_booking_id_key), so a booking carries AT MOST one linked payment —
-- the "refund on the other payment finds no stamped entry" scenario cannot
-- arise through this join. The ORDER BY in the lateral is retained defensively
-- (deterministic even if that constraint is ever relaxed).
--
-- Course-kind (payment_id) materialization is a later slice, matching the claim
-- function ("course hold reference is a later slice").

-- Materialization scans post-cutover deliveries every sweep; the table only has
-- a (teacher_id, payroll_period_month) index today. Plain CREATE INDEX (not
-- CONCURRENTLY — impossible inside the migration transaction) briefly locks
-- writes; acceptable now (table holds test/seed data only), revisit via a
-- non-transactional migration if it ever needs rebuilding at real volume.
CREATE INDEX IF NOT EXISTS idx_session_deliveries_delivered_at
  ON session_deliveries (delivered_at);

-- The ledger is append-only + status-driven; nothing may DELETE from it. A
-- deleted voided/clawed entry would erase its session_delivery_id tombstone
-- and let this function re-materialize the delivery as a fresh payable (same
-- guard idiom as teacher_agreement_acceptances).
CREATE OR REPLACE FUNCTION guard_earning_entries_no_delete()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $del$
BEGIN
  RAISE EXCEPTION 'teacher_earning_entries rows are never deleted (spec 040: the ledger is append-only; void instead)';
END;
$del$;
DROP TRIGGER IF EXISTS earning_entries_no_delete ON teacher_earning_entries;
CREATE TRIGGER earning_entries_no_delete
  BEFORE DELETE ON teacher_earning_entries
  FOR EACH ROW EXECUTE FUNCTION guard_earning_entries_no_delete();

CREATE OR REPLACE FUNCTION connect_materialize_session_earnings()
RETURNS TABLE (
  inserted_pending       bigint,
  inserted_held          bigint,
  skipped_invalid_amount bigint,
  released_stuck_holds   bigint
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_cutover_txt text;
  v_cutover_ts  timestamptz;
  v_version     text;
  v_pending     bigint := 0;
  v_held        bigint := 0;
  v_skipped     bigint := 0;
  v_released    bigint := 0;
BEGIN
  -- Dormancy vs misconfiguration (CodeRabbit review):
  --   * UNSET/blank cutover = the system is DORMANT (FR-021) → silent zeros;
  --     the webhook path calls this on every refund pre-cutover, so dormancy
  --     must never raise.
  --   * ARMED but corrupt (bad format, impossible date, blank agreement
  --     version) = a configuration BUG → RAISE, so the sweep logs it every run
  --     and a webhook event fails-and-redelivers loudly, instead of the
  --     stalled queue masquerading as a normal empty run.
  -- The boundary parse (regex + ::date + UTC midnight) matches the claim
  -- function so the two can never disagree on the partition.
  SELECT value INTO v_cutover_txt FROM platform_settings WHERE key = 'connect_cutover_date';
  IF v_cutover_txt IS NULL OR btrim(v_cutover_txt) = '' THEN
    RETURN QUERY SELECT 0::bigint, 0::bigint, 0::bigint, 0::bigint;
    RETURN;
  END IF;
  IF btrim(v_cutover_txt) !~ '^\d{4}-\d{2}-\d{2}$' THEN
    RAISE EXCEPTION 'connect materialization: connect_cutover_date is set but not YYYY-MM-DD (%). Fix platform_settings.', v_cutover_txt
      USING ERRCODE = 'invalid_parameter_value';
  END IF;
  BEGIN
    v_cutover_ts := (btrim(v_cutover_txt)::date)::timestamp AT TIME ZONE 'UTC';
  EXCEPTION WHEN others THEN
    -- Regex-passing impossible date (2026-02-31): still a config bug.
    RAISE EXCEPTION 'connect materialization: connect_cutover_date is not a real date (%). Fix platform_settings.', v_cutover_txt
      USING ERRCODE = 'invalid_parameter_value';
  END;

  -- The system is ARMED past this point: a missing/blank current version is a
  -- config bug, not an idle run — every entry must be STAMPED (FR-030a) and
  -- inserting unstamped is not an option, so refuse loudly.
  SELECT value INTO v_version FROM platform_settings WHERE key = 'teacher_agreement_current_version';
  IF v_version IS NULL OR btrim(v_version) = '' THEN
    RAISE EXCEPTION 'connect materialization: teacher_agreement_current_version is missing/blank while connect_cutover_date is armed. Fix platform_settings.'
      USING ERRCODE = 'invalid_parameter_value';
  END IF;
  v_version := btrim(v_version);

  WITH eligible AS (
    SELECT
      sd.id          AS delivery_id,
      sd.teacher_id  AS t_id,
      connect_earning_cents(sd.duration_minutes, sd.hourly_rate_usd) AS cents,
      pay.stripe_payment_intent AS funding_ref,
      EXISTS (
        SELECT 1 FROM teacher_agreement_acceptances a
         WHERE a.teacher_id = sd.teacher_id
           AND a.agreement_version = v_version
      ) AS accepted
    FROM session_deliveries sd
    LEFT JOIN LATERAL (
      -- Charge-funded linkage (single-session / pay-per-session): the payment
      -- row attached to this session's booking. 'refunded' is deliberately
      -- included — a refunded funding payment must still stamp its ref so the
      -- clawback path can match the entry. Subscription-credit deliveries have
      -- no payments.booking_id link and stamp NULL (FR-009).
      SELECT p.stripe_payment_intent
        FROM sessions s
        JOIN payments p ON p.booking_id = s.booking_id
       WHERE s.id = sd.session_id
         AND p.provider = 'stripe'
         AND p.status IN ('succeeded', 'refunded')
         AND p.stripe_payment_intent IS NOT NULL
       -- payments.booking_id is UNIQUE today (see header) — this ORDER BY is
       -- a defensive determinism guarantee, not a live tiebreak.
       ORDER BY (p.status = 'succeeded') DESC, p.created_at DESC, p.id DESC
       LIMIT 1
    ) pay ON true
    WHERE sd.delivered_at >= v_cutover_ts
      AND NOT EXISTS (
        SELECT 1 FROM teacher_earning_entries e
         WHERE e.session_delivery_id = sd.id AND e.kind = 'session'
      )
  ),
  ins AS (
    INSERT INTO teacher_earning_entries
      (teacher_id, kind, amount_cents, status, session_delivery_id,
       funding_charge_id, transfer_group, agreement_version, hold_reason)
    SELECT
      el.t_id,
      'session'::earning_entry_kind,
      el.cents,
      CASE WHEN el.accepted THEN 'pending'::earning_entry_status
           ELSE 'held'::earning_entry_status END,
      el.delivery_id,
      el.funding_ref,
      'delivery_' || el.delivery_id,
      v_version,
      CASE WHEN el.accepted THEN NULL ELSE 'agreement_pending' END
    FROM eligible el
    WHERE el.cents > 0
    -- Deterministic insert order: concurrent callers (cron sweep + admin sweep
    -- + webhook path) inserting the same eligible set in DIFFERENT orders can
    -- deadlock on the ON CONFLICT speculative-insert waits (review P2).
    ORDER BY el.delivery_id
    ON CONFLICT (session_delivery_id) WHERE kind = 'session' DO NOTHING
    RETURNING teacher_earning_entries.status AS ins_status
  )
  SELECT
    (SELECT count(*) FROM ins WHERE ins.ins_status = 'pending')::bigint,
    (SELECT count(*) FROM ins WHERE ins.ins_status = 'held')::bigint,
    (SELECT count(*) FROM eligible el WHERE el.cents IS NULL OR el.cents <= 0)::bigint
  INTO v_pending, v_held, v_skipped;

  -- Reconciliation (header: self-healing): a SECOND statement, so its snapshot
  -- sees acceptances that committed while the INSERT above was running. Keyed
  -- on the STAMPED version — releases both the race's stuck rows and rows
  -- stranded by a later version bump the teacher has since accepted.
  UPDATE teacher_earning_entries e
     SET status = 'pending', hold_reason = NULL, updated_at = now()
   WHERE e.kind = 'session'
     AND e.status = 'held'
     AND e.hold_reason = 'agreement_pending'
     AND EXISTS (
       SELECT 1 FROM teacher_agreement_acceptances a
        WHERE a.teacher_id = e.teacher_id
          AND a.agreement_version = e.agreement_version
     );
  GET DIAGNOSTICS v_released = ROW_COUNT;

  RETURN QUERY SELECT v_pending, v_held, v_skipped, v_released;
END;
$$;

ALTER FUNCTION connect_materialize_session_earnings() OWNER TO postgres;
REVOKE EXECUTE ON FUNCTION connect_materialize_session_earnings()
  FROM public, anon, authenticated;
GRANT  EXECUTE ON FUNCTION connect_materialize_session_earnings()
  TO service_role;

COMMENT ON FUNCTION connect_materialize_session_earnings() IS
  'Spec 040 materialization wiring: derives kind=''session'' teacher_earning_entries from post-cutover session_deliveries (FR-006 amount, FR-029 agreement gate → pending/held, FR-030a stamped version, FR-009 funding ref = PaymentIntent id where identifiable). Idempotent (partial UNIQUE + ON CONFLICT DO NOTHING). Dormant until connect_cutover_date is set. Called by the transfer sweep and by the refund/dispute webhook path.';
