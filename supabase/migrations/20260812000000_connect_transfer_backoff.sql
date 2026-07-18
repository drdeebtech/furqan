-- 20260812000000_connect_transfer_backoff.sql
--
-- Spec 040 FR-011 — capped backoff + terminal state for failed transfers.
--
-- Before this migration a failed transfer flipped processing → pending and was
-- retried by EVERY subsequent sweep, forever, with the Stripe error recorded
-- nowhere but app logs (the RPC had no error parameter at all). Deterministic
-- failures (non-USD, missing destination) hot-looped identically.
--
-- Now:
--   * attempt_count / next_attempt_at / last_error_detail live on the entry;
--   * connect_sweep_record_transfer_failed takes the error detail, increments
--     the attempt count, and schedules the next try with exponential backoff
--     (15 min · 2^(n−1), capped at 24 h);
--   * after MAX_ATTEMPTS (8) the entry goes TERMINAL-LOUD: status 'held' with
--     hold_reason 'transfer_failed' — visible in /admin/payouts, never silently
--     dropped (FR-011's "never dropped" = loud parking, not infinite retry);
--   * the claim skips entries whose next_attempt_at is in the future;
--   * connect_admin_requeue_failed_entry (audited) is the admin recovery path:
--     held/transfer_failed → pending with counters reset.
--
-- Expand/contract: the 2-arg connect_sweep_record_transfer_failed is dropped
-- and replaced by the 3-arg form in the same migration — service-role-only,
-- single caller ships in this PR, path dormant in production (cutover NULL);
-- an old-code call during the deploy window fails loudly (the sweep counts the
-- entry failed-closed and retries next run), never silently.

-- ─────────────────────────────────────────────────────────────────────────
-- 1. Retry-state columns (additive).
-- ─────────────────────────────────────────────────────────────────────────
ALTER TABLE teacher_earning_entries
  ADD COLUMN attempt_count     integer     NOT NULL DEFAULT 0,
  ADD COLUMN next_attempt_at   timestamptz,
  ADD COLUMN last_error_detail text;

COMMENT ON COLUMN teacher_earning_entries.attempt_count IS
  'Spec 040 FR-011: failed settlement attempts so far. Reset only by the audited admin requeue.';
COMMENT ON COLUMN teacher_earning_entries.next_attempt_at IS
  'Spec 040 FR-011: the claim skips this entry until this instant (exponential backoff, 15min·2^(n-1) capped at 24h). NULL = claimable now.';
COMMENT ON COLUMN teacher_earning_entries.last_error_detail IS
  'Spec 040 FR-011: latest settlement error (Stripe or fail-closed guard), capped at 500 chars. Surfaced in /admin/payouts.';

-- ─────────────────────────────────────────────────────────────────────────
-- 2. recordTransferFailed v2 — error recorded, backoff scheduled, cap enforced.
-- ─────────────────────────────────────────────────────────────────────────
DROP FUNCTION connect_sweep_record_transfer_failed(uuid, timestamptz);

CREATE FUNCTION connect_sweep_record_transfer_failed(
  p_entry_id     uuid,
  p_claimed_at   timestamptz,
  p_error_detail text
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  -- FR-011 constants — deliberately pinned in the money path, not in
  -- platform_settings: a corrupt/missing setting must never be able to turn
  -- retries off or make them hot-loop.
  c_max_attempts   constant integer := 8;
  c_base_minutes   constant integer := 15;
  c_cap_minutes    constant integer := 1440; -- 24 h
  v_new_count      integer;
  v_delay_minutes  integer;
  v_hit            boolean := false;
BEGIN
  UPDATE teacher_earning_entries e
     SET attempt_count     = e.attempt_count + 1,
         last_error_detail = left(coalesce(p_error_detail, 'unknown error'), 500),
         status            = CASE WHEN e.attempt_count + 1 >= c_max_attempts
                                  THEN 'held'::earning_entry_status
                                  ELSE 'pending'::earning_entry_status END,
         hold_reason       = CASE WHEN e.attempt_count + 1 >= c_max_attempts
                                  THEN 'transfer_failed'
                                  ELSE e.hold_reason END,
         next_attempt_at   = CASE WHEN e.attempt_count + 1 >= c_max_attempts
                                  THEN NULL
                                  ELSE now() + make_interval(mins =>
                                         LEAST(c_base_minutes * (2 ^ e.attempt_count)::integer,
                                               c_cap_minutes)) END,
         claimed_at        = NULL
   WHERE e.id = p_entry_id
     AND e.status = 'processing'
     AND e.claimed_at = p_claimed_at;

  GET DIAGNOSTICS v_hit = ROW_COUNT;
  RETURN v_hit;
END;
$$;

ALTER FUNCTION connect_sweep_record_transfer_failed(uuid, timestamptz, text) OWNER TO postgres;
REVOKE EXECUTE ON FUNCTION connect_sweep_record_transfer_failed(uuid, timestamptz, text)
  FROM public, anon, authenticated;
GRANT  EXECUTE ON FUNCTION connect_sweep_record_transfer_failed(uuid, timestamptz, text)
  TO service_role;

COMMENT ON FUNCTION connect_sweep_record_transfer_failed(uuid, timestamptz, text) IS
  'Spec 040 FR-011: fenced failure path — record the error on the entry, back off exponentially (15min·2^(n-1) ≤ 24h), and park the entry held/transfer_failed after 8 attempts (loud terminal; admin requeue is the recovery). Service-role only.';

-- Deploy-window compatibility wrapper (review finding): builds deploy
-- concurrently with migrations, so an in-flight OLD app instance still calls
-- the 2-arg form. Without this it would error and leave the entry leased for
-- the whole 30-min lease TTL; with it, the legacy caller gets the full FR-011
-- contract (counter, backoff, terminal parking) with a placeholder error.
-- Contract-phase removal in a later PR once no old instances remain.
CREATE FUNCTION connect_sweep_record_transfer_failed(
  p_entry_id   uuid,
  p_claimed_at timestamptz
)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT connect_sweep_record_transfer_failed(
           p_entry_id, p_claimed_at, 'unknown error (legacy 2-arg caller)');
$$;

ALTER FUNCTION connect_sweep_record_transfer_failed(uuid, timestamptz) OWNER TO postgres;
REVOKE EXECUTE ON FUNCTION connect_sweep_record_transfer_failed(uuid, timestamptz)
  FROM public, anon, authenticated;
GRANT  EXECUTE ON FUNCTION connect_sweep_record_transfer_failed(uuid, timestamptz)
  TO service_role;

COMMENT ON FUNCTION connect_sweep_record_transfer_failed(uuid, timestamptz) IS
  'Spec 040 FR-011 deploy-window compatibility wrapper — delegates to the 3-arg form with a placeholder error. Remove in a later contract-phase PR.';

-- ─────────────────────────────────────────────────────────────────────────
-- 3. Claim respects the backoff gate.
-- ─────────────────────────────────────────────────────────────────────────
-- Same body as 20260811 plus: AND (next_attempt_at IS NULL OR <= p_now).
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
    RETURN;
  END IF;
  v_hold_days := btrim(v_hold_txt)::integer;

  -- Dormancy: empty cutover ⇒ Connect path disabled ⇒ claim nothing (FR-021).
  SELECT value INTO v_cutover_txt FROM platform_settings WHERE key = 'connect_cutover_date';
  IF v_cutover_txt IS NULL OR btrim(v_cutover_txt) = '' THEN
    RETURN;
  END IF;
  IF btrim(v_cutover_txt) !~ '^\d{4}-\d{2}-\d{2}$' THEN
    RETURN;
  END IF;
  v_cutover_ts := (btrim(v_cutover_txt)::date)::timestamp AT TIME ZONE 'UTC';

  RETURN QUERY
  UPDATE teacher_earning_entries e
     SET status = 'processing', claimed_at = p_now
   WHERE e.status = 'pending'
     AND e.kind = 'session'
     AND (e.amount_cents - connect_entry_recovered_cents(e.id)) > 0
     -- FR-011 backoff gate: a recently-failed entry waits out its delay.
     AND (e.next_attempt_at IS NULL OR e.next_attempt_at <= p_now)
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
    (e.amount_cents - connect_entry_recovered_cents(e.id))::bigint,
    e.kind::text,
    (SELECT tp.payout_method FROM teacher_profiles tp WHERE tp.teacher_id = e.teacher_id),
    (SELECT sca.stripe_account_id FROM stripe_connect_accounts sca WHERE sca.teacher_id = e.teacher_id),
    e.transfer_group,
    'usd'::text,
    e.claimed_at,
    connect_outstanding_debt_cents(e.teacher_id);
END;
$$;

COMMENT ON FUNCTION connect_sweep_claim_eligible(timestamptz) IS
  'Spec 040 Phase 1.2 + FR-027a + FR-011: atomic sweep claim — remaining value, claim-time debt snapshot, and the exponential-backoff gate (next_attempt_at). Dormant until connect_cutover_date is set.';

-- ─────────────────────────────────────────────────────────────────────────
-- 4. Admin requeue — the recovery path out of held/transfer_failed.
-- ─────────────────────────────────────────────────────────────────────────
-- Fenced to exactly the terminal state this migration creates; resets the
-- retry counters; audited (actor from the session via the action layer).
CREATE FUNCTION connect_admin_requeue_failed_entry(
  p_entry_id uuid,
  p_actor    uuid
)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_teacher uuid;
BEGIN
  IF p_actor IS NULL THEN
    RAISE EXCEPTION 'connect_admin_requeue_failed_entry: actor is required';
  END IF;

  UPDATE teacher_earning_entries
     SET status = 'pending',
         hold_reason = NULL,
         attempt_count = 0,
         next_attempt_at = NULL
   WHERE id = p_entry_id
     AND status = 'held'
     AND hold_reason = 'transfer_failed'
  RETURNING teacher_id INTO v_teacher;

  IF v_teacher IS NULL THEN
    RETURN 'not_found'; -- not in the terminal-failed state — legit no-op
  END IF;

  INSERT INTO connect_payout_audit (event, actor, subject_teacher_id, detail)
  VALUES ('transfer_failed_requeue', p_actor, v_teacher,
          jsonb_build_object('entry_id', p_entry_id));
  RETURN 'requeued';
END;
$$;

ALTER FUNCTION connect_admin_requeue_failed_entry(uuid, uuid) OWNER TO postgres;
REVOKE EXECUTE ON FUNCTION connect_admin_requeue_failed_entry(uuid, uuid)
  FROM public, anon, authenticated;
GRANT  EXECUTE ON FUNCTION connect_admin_requeue_failed_entry(uuid, uuid)
  TO service_role;

COMMENT ON FUNCTION connect_admin_requeue_failed_entry(uuid, uuid) IS
  'Spec 040 FR-011: audited admin recovery — held/transfer_failed → pending with retry counters reset. Service-role only; callers must requireAdmin().';

-- ─────────────────────────────────────────────────────────────────────────
-- 5. Overview: failure visibility now comes from the entries (the old
--    teacher_transfers.status='failed' source never has rows — the failure
--    path deliberately writes no transfer row), plus the terminal queue.
-- ─────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION connect_admin_payouts_overview()
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT jsonb_build_object(
    'cutover_date',
    COALESCE((SELECT value FROM platform_settings WHERE key = 'connect_cutover_date'), ''),
    'teachers',
    COALESCE((
      SELECT jsonb_agg(t.row ORDER BY t.row->>'full_name')
      FROM (
        SELECT jsonb_build_object(
          'teacher_id', tp.teacher_id,
          'full_name', COALESCE(p.full_name, ''),
          'payout_method', tp.payout_method,
          'payouts_enabled', COALESCE(sca.payouts_enabled, false),
          'details_submitted', COALESCE(sca.details_submitted, false),
          'stripe_account_id', sca.stripe_account_id,
          'pending_cents', COALESCE((SELECT SUM(e.amount_cents) FROM teacher_earning_entries e
            WHERE e.teacher_id = tp.teacher_id AND e.kind IN ('session','course') AND e.status = 'pending'), 0),
          'processing_cents', COALESCE((SELECT SUM(e.amount_cents) FROM teacher_earning_entries e
            WHERE e.teacher_id = tp.teacher_id AND e.kind IN ('session','course') AND e.status = 'processing'), 0),
          'held_cents', COALESCE((SELECT SUM(e.amount_cents) FROM teacher_earning_entries e
            WHERE e.teacher_id = tp.teacher_id AND e.kind IN ('session','course') AND e.status = 'held'), 0),
          'manual_due_cents', COALESCE((SELECT SUM(e.amount_cents) FROM teacher_earning_entries e
            WHERE e.teacher_id = tp.teacher_id AND e.kind IN ('session','course') AND e.status = 'manual_due'), 0),
          'transferred_cents', COALESCE((SELECT SUM(e.amount_cents) FROM teacher_earning_entries e
            WHERE e.teacher_id = tp.teacher_id AND e.kind IN ('session','course') AND e.status = 'transferred'), 0),
          'manual_paid_cents', COALESCE((SELECT SUM(e.amount_cents) FROM teacher_earning_entries e
            WHERE e.teacher_id = tp.teacher_id AND e.kind IN ('session','course') AND e.status = 'manual_paid'), 0),
          'outstanding_debt_cents', connect_outstanding_debt_cents(tp.teacher_id),
          -- FR-011: entries mid-backoff or parked terminal, and the latest error.
          'failed_transfers', (SELECT count(*) FROM teacher_earning_entries e
            WHERE e.teacher_id = tp.teacher_id AND e.attempt_count > 0
              AND (e.status = 'pending' OR (e.status = 'held' AND e.hold_reason = 'transfer_failed'))),
          -- Same predicate as the count above (review finding): a recovered or
          -- requeued entry's stale error must not display beside an active one.
          'last_transfer_error', (SELECT e.last_error_detail FROM teacher_earning_entries e
            WHERE e.teacher_id = tp.teacher_id AND e.last_error_detail IS NOT NULL
              AND e.attempt_count > 0
              AND (e.status = 'pending' OR (e.status = 'held' AND e.hold_reason = 'transfer_failed'))
            ORDER BY e.updated_at DESC LIMIT 1),
          'active_holds', COALESCE((SELECT jsonb_agg(jsonb_build_object(
              'id', ph.id, 'source', ph.source, 'reason', ph.reason,
              'created_at', ph.created_at) ORDER BY ph.created_at)
            FROM payout_holds ph
            WHERE ph.teacher_id = tp.teacher_id AND ph.released_at IS NULL), '[]'::jsonb)
        ) AS row
        FROM teacher_profiles tp
        JOIN profiles p ON p.id = tp.teacher_id
        LEFT JOIN stripe_connect_accounts sca ON sca.teacher_id = tp.teacher_id
        WHERE sca.teacher_id IS NOT NULL
           OR EXISTS (SELECT 1 FROM teacher_earning_entries e WHERE e.teacher_id = tp.teacher_id)
           OR EXISTS (SELECT 1 FROM payout_holds ph2 WHERE ph2.teacher_id = tp.teacher_id)
      ) t
    ), '[]'::jsonb),
    'manual_due',
    COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
          'entry_id', e.id,
          'teacher_id', e.teacher_id,
          'full_name', COALESCE(p.full_name, ''),
          'amount_cents', e.amount_cents,
          'net_due_cents',
            GREATEST(0, e.amount_cents - connect_entry_recovered_cents(e.id))
              - connect_manual_fifo_recover_cents(e.id),
          'recovered_cents', connect_entry_recovered_cents(e.id),
          'session_delivery_id', e.session_delivery_id,
          'delivered_at', sd.delivered_at,
          'created_at', e.created_at
        ) ORDER BY e.created_at)
      FROM teacher_earning_entries e
      JOIN profiles p ON p.id = e.teacher_id
      LEFT JOIN session_deliveries sd ON sd.id = e.session_delivery_id
      WHERE e.status = 'manual_due'
    ), '[]'::jsonb),
    -- FR-011: terminal-failed queue — every parked entry, with its story.
    'failed_entries',
    COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
          'entry_id', e.id,
          'teacher_id', e.teacher_id,
          'full_name', COALESCE(p.full_name, ''),
          'amount_cents', e.amount_cents,
          'attempt_count', e.attempt_count,
          'last_error_detail', e.last_error_detail,
          'updated_at', e.updated_at
        ) ORDER BY e.updated_at DESC)
      FROM teacher_earning_entries e
      JOIN profiles p ON p.id = e.teacher_id
      WHERE e.status = 'held' AND e.hold_reason = 'transfer_failed'
    ), '[]'::jsonb)
  );
$$;

COMMENT ON FUNCTION connect_admin_payouts_overview() IS
  'Spec 040 Phase 4 + FR-027a + FR-011: one-shot admin ops snapshot — net-of-debt manual queue, entry-sourced failure counts/errors, and the terminal transfer_failed queue with its audited requeue path. Service-role only; callers must requireAdmin().';
