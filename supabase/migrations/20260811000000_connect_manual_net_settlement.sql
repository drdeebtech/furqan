-- 20260811000000_connect_manual_net_settlement.sql
--
-- Spec 040 FR-027a — the manual rail is not exempt from debt offset (FR-014)
-- or holds (FR-015/023). This migration closes the settle-time netting gap and
-- fixes two latent money bugs found while building it:
--
--   BUG 1 (overpay): a partially-recovered entry kept its GROSS amount_cents in
--     every payable surface — the manual_due queue/CSV showed the gross, and a
--     requeued entry (admin rail-switch re-route, 20260808) was re-claimed at
--     the gross amount. In both cases the recovered portion would be paid AGAIN.
--     Fix: every payable read is now net-of-recovery — the claim returns
--     `amount_cents - connect_entry_recovered_cents(id)`, and the settle/queue
--     compute the same remaining value.
--
--   BUG 2 (23505 hot-loop): connect_sweep_write_debt_recovery does a bare
--     INSERT under UNIQUE(consuming_entry_id) — a requeued entry that nets a
--     second time raised unique_violation inside the fenced settlement write,
--     failing the entry every sweep, forever.
--     Fix: the partial unique is replaced by the TRUE invariant, enforced by
--     trigger: the SUM of recoveries consumed by an entry can never exceed the
--     entry's value. Replay-safety does not regress — every recovery write
--     happens inside a lease/status-fenced settlement transaction, so a replay
--     finds the fence closed and writes nothing.
--
-- Settle-time netting (the FR-027a deliverable):
--   connect_settle_manual_due now re-derives the teacher's outstanding debt at
--   the settle serialization point and takes p_expected_net_cents as an
--   optimistic fence: the admin pays exactly what the queue displayed, or the
--   RPC refuses with the fresh number ('stale_net') and nothing is written.
--   Debt is allocated across a teacher's queued entries FIFO by entry age; the
--   allocation is order-independent because each settle's recovery row shrinks
--   the outstanding debt by exactly its own share.
--
-- Expand/contract note: the 3-arg connect_settle_manual_due(uuid,text,uuid) is
-- DROPPED and replaced by the 4-arg form in the same migration. This is a
-- deliberate same-PR replacement, not a contract violation: the function is
-- service-role-only, its single caller ships in this same PR, the path is
-- DORMANT in production (connect_cutover_date NULL ⇒ no manual_due rows exist),
-- and an old-code call during the concurrent-deploy window fails LOUDLY
-- (PostgREST unknown-function error → admin action returns 'unavailable'),
-- never silently and never wrongly. Keeping the old shape alive would keep the
-- overpaying settle callable — worse than the window.

-- ─────────────────────────────────────────────────────────────────────────
-- 1. connect_entry_recovered_cents — net debt recovered by consuming an entry.
-- ─────────────────────────────────────────────────────────────────────────
-- SUM of debt_recovery rows consuming the entry, net of any reversals of those
-- recoveries (reversal amounts are negative by the ledger sign convention, so a
-- plain SUM over both kinds nets correctly).
CREATE OR REPLACE FUNCTION connect_entry_recovered_cents(p_entry_id uuid)
RETURNS bigint
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  SELECT COALESCE(SUM(x.amount_cents), 0)::bigint FROM (
    SELECT r.amount_cents
      FROM teacher_earning_entries r
     WHERE r.consuming_entry_id = p_entry_id
       AND r.kind = 'debt_recovery'
    UNION ALL
    SELECT rv.amount_cents
      FROM teacher_earning_entries rv
     WHERE rv.kind = 'debt_recovery_reversal'
       AND rv.reverses_recovery_id IN (
         SELECT r2.id FROM teacher_earning_entries r2
          WHERE r2.consuming_entry_id = p_entry_id
            AND r2.kind = 'debt_recovery'
       )
  ) x
$$;

ALTER FUNCTION connect_entry_recovered_cents(uuid) OWNER TO postgres;
REVOKE EXECUTE ON FUNCTION connect_entry_recovered_cents(uuid)
  FROM public, anon, authenticated;
GRANT  EXECUTE ON FUNCTION connect_entry_recovered_cents(uuid)
  TO service_role;

COMMENT ON FUNCTION connect_entry_recovered_cents(uuid) IS
  'Spec 040 FR-027a: net cents of debt recovered by consuming this entry (recoveries minus their reversals). The entry''s payable remainder = amount_cents - this.';

-- ─────────────────────────────────────────────────────────────────────────
-- 2. connect_outstanding_debt_cents — THE per-teacher balance, one definition.
-- ─────────────────────────────────────────────────────────────────────────
-- The Phase 0 sign-convention formula, now a named function so the claim, the
-- settle and the overview all cite one implementation (the plan's "no module
-- re-derives the balance with its own formula", extended to SQL).
CREATE OR REPLACE FUNCTION connect_outstanding_debt_cents(p_teacher_id uuid)
RETURNS bigint
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  SELECT GREATEST(0, -1 * COALESCE(SUM(d.amount_cents), 0))::bigint
    FROM teacher_earning_entries d
   WHERE d.teacher_id = p_teacher_id
     AND d.kind IN ('clawback', 'debt_recovery', 'debt_recovery_reversal')
$$;

ALTER FUNCTION connect_outstanding_debt_cents(uuid) OWNER TO postgres;
REVOKE EXECUTE ON FUNCTION connect_outstanding_debt_cents(uuid)
  FROM public, anon, authenticated;
GRANT  EXECUTE ON FUNCTION connect_outstanding_debt_cents(uuid)
  TO service_role;

COMMENT ON FUNCTION connect_outstanding_debt_cents(uuid) IS
  'Spec 040 FR-014: outstanding teacher debt = GREATEST(0, -1 * SUM(amount_cents)) over clawback/debt_recovery/debt_recovery_reversal rows. The single SQL implementation of the ledger sign convention.';

-- ─────────────────────────────────────────────────────────────────────────
-- 3. Recovery cap trigger — replaces UNIQUE(consuming_entry_id).
-- ─────────────────────────────────────────────────────────────────────────
-- The unique index encoded "an entry recovers debt at most once", which is
-- FALSE once an entry can legitimately net twice (claim-time then settle-time,
-- or after a requeue). The true invariant is value conservation: an entry can
-- never recover more debt than its own worth. Enforced under a row lock on the
-- consuming entry (callers already hold it — the fenced status UPDATE / FOR
-- UPDATE select precedes every recovery write, so lock order is consistent).
DROP INDEX uix_earning_entries_recovery_consuming;

CREATE OR REPLACE FUNCTION guard_earning_entries_recovery_cap()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_consuming teacher_earning_entries%ROWTYPE;
  v_prior     bigint;
BEGIN
  SELECT * INTO v_consuming
    FROM teacher_earning_entries
   WHERE id = NEW.consuming_entry_id
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'recovery cap: consuming entry % not found', NEW.consuming_entry_id;
  END IF;
  IF v_consuming.teacher_id <> NEW.teacher_id THEN
    RAISE EXCEPTION 'recovery cap: consuming entry % belongs to teacher %, recovery names %',
      NEW.consuming_entry_id, v_consuming.teacher_id, NEW.teacher_id;
  END IF;
  IF v_consuming.kind NOT IN ('session', 'course') THEN
    RAISE EXCEPTION 'recovery cap: consuming entry % is kind %, only earnings can fund a recovery',
      NEW.consuming_entry_id, v_consuming.kind;
  END IF;

  v_prior := connect_entry_recovered_cents(NEW.consuming_entry_id);
  IF v_prior + NEW.amount_cents > v_consuming.amount_cents THEN
    RAISE EXCEPTION
      'recovery cap: entry % (value %) already recovered %, +% would exceed its value',
      NEW.consuming_entry_id, v_consuming.amount_cents, v_prior, NEW.amount_cents;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER earning_entries_recovery_cap
  BEFORE INSERT ON teacher_earning_entries
  FOR EACH ROW
  WHEN (NEW.kind = 'debt_recovery')
  EXECUTE FUNCTION guard_earning_entries_recovery_cap();

COMMENT ON TRIGGER earning_entries_recovery_cap ON teacher_earning_entries IS
  'Spec 040 FR-027a: SUM(recoveries consumed by an entry) <= entry value. Replaces uix_earning_entries_recovery_consuming (an entry may now net at claim-time AND settle-time; replay safety lives in the lease/status fences).';

-- ─────────────────────────────────────────────────────────────────────────
-- 4. Claim returns the REMAINING value (BUG 1 fix, sweep side).
-- ─────────────────────────────────────────────────────────────────────────
-- Same signature and eligibility as 20260801, two changes:
--   * amount_cents returned = amount - already-recovered (never re-pay debt the
--     entry already settled), computed inside the claiming statement;
--   * entries with no remaining value are not claimable (belt — such a row
--     should already be terminal).
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
  v_cutover_ts := (btrim(v_cutover_txt)::date)::timestamp AT TIME ZONE 'UTC';

  RETURN QUERY
  UPDATE teacher_earning_entries e
     SET status = 'processing', claimed_at = p_now
   WHERE e.status = 'pending'
     AND e.kind = 'session'
     AND (e.amount_cents - connect_entry_recovered_cents(e.id)) > 0
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
    -- BUG 1 fix: the payable is the REMAINING value, never the gross.
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
  'Spec 040 Phase 1.2 + FR-027a: atomic sweep claim. Returns each eligible entry at its REMAINING value (amount minus prior recoveries) with the claim-time debt snapshot. Dormant until connect_cutover_date is set.';

-- ─────────────────────────────────────────────────────────────────────────
-- 5. connect_manual_fifo_recover_cents — this entry's share of teacher debt.
-- ─────────────────────────────────────────────────────────────────────────
-- Debt is allocated to a teacher's manual_due entries oldest-first:
--   share = clamp(debt − Σ remaining(older manual_due entries), 0, remaining).
-- Order-independent under settlement: whichever entry settles first writes a
-- recovery for exactly its share, shrinking the debt so every other entry's
-- share is unchanged. The queue displays this number; the settle enforces it.
CREATE OR REPLACE FUNCTION connect_manual_fifo_recover_cents(p_entry_id uuid)
RETURNS bigint
LANGUAGE plpgsql
STABLE
SET search_path = public
AS $$
DECLARE
  v_entry     record;
  v_remaining bigint;
  v_debt      bigint;
  v_older     bigint;
BEGIN
  SELECT e.id, e.teacher_id, e.amount_cents, e.created_at
    INTO v_entry
    FROM teacher_earning_entries e
   WHERE e.id = p_entry_id;
  IF NOT FOUND THEN
    RETURN 0;
  END IF;

  v_remaining := GREATEST(0, v_entry.amount_cents - connect_entry_recovered_cents(v_entry.id));
  v_debt      := connect_outstanding_debt_cents(v_entry.teacher_id);

  SELECT COALESCE(SUM(GREATEST(0, o.amount_cents - connect_entry_recovered_cents(o.id))), 0)
    INTO v_older
    FROM teacher_earning_entries o
   WHERE o.teacher_id = v_entry.teacher_id
     AND o.status = 'manual_due'
     AND o.kind IN ('session', 'course')
     AND (o.created_at, o.id) < (v_entry.created_at, v_entry.id);

  RETURN LEAST(GREATEST(v_debt - v_older, 0), v_remaining);
END;
$$;

ALTER FUNCTION connect_manual_fifo_recover_cents(uuid) OWNER TO postgres;
REVOKE EXECUTE ON FUNCTION connect_manual_fifo_recover_cents(uuid)
  FROM public, anon, authenticated;
GRANT  EXECUTE ON FUNCTION connect_manual_fifo_recover_cents(uuid)
  TO service_role;

COMMENT ON FUNCTION connect_manual_fifo_recover_cents(uuid) IS
  'Spec 040 FR-027a: the debt share allocated to one manual_due entry (FIFO by entry age, clamped to its remaining value). Displayed by the queue, enforced by the settle.';

-- ─────────────────────────────────────────────────────────────────────────
-- 6. connect_settle_manual_due v2 — settle-time netting + expected-net fence.
-- ─────────────────────────────────────────────────────────────────────────
DROP FUNCTION connect_settle_manual_due(uuid, text, uuid);

-- Returns jsonb:
--   {outcome:'settled', net_paid_cents, recovered_cents}     manual_paid
--   {outcome:'closed_debt_recovered', recovered_cents}       net was 0 → closed
--   {outcome:'stale_net', net_due_cents}                     fence refused; fresh net returned
--   {outcome:'teacher_on_hold'}                              active payout_holds row (FR-015/023)
--   {outcome:'not_found'}                                    replay / wrong status / wrong rail
-- RAISES only on caller contract breaches (NULL admin, negative expected net,
-- blank reference when net > 0) — loud, never conflated with the no-ops.
CREATE FUNCTION connect_settle_manual_due(
  p_entry_id           uuid,
  p_reference_id       text,
  p_settling_admin     uuid,
  p_expected_net_cents bigint
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_entry     teacher_earning_entries%ROWTYPE;
  v_remaining bigint;
  v_recover   bigint;
  v_net       bigint;
BEGIN
  IF p_settling_admin IS NULL THEN
    RAISE EXCEPTION 'connect_settle_manual_due: settling admin is required';
  END IF;
  IF p_expected_net_cents IS NULL OR p_expected_net_cents < 0 THEN
    RAISE EXCEPTION 'connect_settle_manual_due: expected net must be a non-negative integer';
  END IF;

  -- The serialization point: lock the entry, enforcing status + rail together.
  SELECT e.* INTO v_entry
    FROM teacher_earning_entries e
   WHERE e.id = p_entry_id
     AND e.status = 'manual_due'
     AND EXISTS (
       SELECT 1 FROM teacher_profiles tp
        WHERE tp.teacher_id = e.teacher_id
          AND tp.payout_method = 'manual'
     )
   FOR UPDATE OF e;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('outcome', 'not_found');
  END IF;

  -- FR-027a: holds bind the manual rail too — an actively-held teacher's queue
  -- must not be hand-settled around the hold.
  IF EXISTS (
    SELECT 1 FROM payout_holds ph
     WHERE ph.teacher_id = v_entry.teacher_id AND ph.released_at IS NULL
  ) THEN
    RETURN jsonb_build_object('outcome', 'teacher_on_hold');
  END IF;

  v_remaining := GREATEST(0, v_entry.amount_cents - connect_entry_recovered_cents(v_entry.id));
  v_recover   := connect_manual_fifo_recover_cents(v_entry.id);
  v_net       := v_remaining - v_recover;

  -- Optimistic fence: the admin settles the number the queue displayed, or
  -- nothing happens and the fresh number comes back (a clawback may have landed
  -- while the entry sat in the queue).
  IF v_net <> p_expected_net_cents THEN
    RETURN jsonb_build_object('outcome', 'stale_net', 'net_due_cents', v_net);
  END IF;

  IF v_net = 0 THEN
    -- Fully consumed by debt: nothing to pay, close without settlement evidence
    -- (chk_entry_manual_settlement: manual_paid iff all three columns set — a
    -- debt_recovered close keeps them NULL). Actor attribution lives in the
    -- audit row, since the entry has no settled_by for this outcome.
    UPDATE teacher_earning_entries SET status = 'debt_recovered'
     WHERE id = v_entry.id;
    PERFORM connect_sweep_write_debt_recovery(v_entry.id, v_entry.teacher_id, v_recover);
    INSERT INTO connect_payout_audit (event, actor, subject_teacher_id, detail)
    VALUES ('manual_closed_debt_recovered', p_settling_admin, v_entry.teacher_id,
            jsonb_build_object('entry_id', v_entry.id, 'recovered_cents', v_recover));
    RETURN jsonb_build_object('outcome', 'closed_debt_recovered', 'recovered_cents', v_recover);
  END IF;

  IF coalesce(btrim(p_reference_id), '') = '' THEN
    RAISE EXCEPTION 'connect_settle_manual_due: reference_id must be non-blank when net > 0';
  END IF;

  UPDATE teacher_earning_entries
     SET status                = 'manual_paid',
         external_reference_id = btrim(p_reference_id),
         settled_by            = p_settling_admin,
         settled_at            = now()
   WHERE id = v_entry.id;
  PERFORM connect_sweep_write_debt_recovery(v_entry.id, v_entry.teacher_id, v_recover);
  IF v_recover > 0 THEN
    -- Extra audit only when netting occurred: the entry's settled_by/at is the
    -- audit for a plain settle; a netted settle also records the split.
    INSERT INTO connect_payout_audit (event, actor, subject_teacher_id, detail)
    VALUES ('manual_settled_net', p_settling_admin, v_entry.teacher_id,
            jsonb_build_object('entry_id', v_entry.id, 'gross_cents', v_remaining,
                               'recovered_cents', v_recover, 'net_paid_cents', v_net));
  END IF;
  RETURN jsonb_build_object('outcome', 'settled',
                            'net_paid_cents', v_net, 'recovered_cents', v_recover);
END;
$$;

ALTER FUNCTION connect_settle_manual_due(uuid, text, uuid, bigint) OWNER TO postgres;
REVOKE EXECUTE ON FUNCTION connect_settle_manual_due(uuid, text, uuid, bigint)
  FROM public, anon, authenticated;
GRANT  EXECUTE ON FUNCTION connect_settle_manual_due(uuid, text, uuid, bigint)
  TO service_role;

COMMENT ON FUNCTION connect_settle_manual_due(uuid, text, uuid, bigint) IS
  'Spec 040 FR-027/FR-027a: settle one manual_due entry off-Stripe at its NET value (settle-time debt netting, FIFO share, expected-net optimistic fence, hold-aware). Service-role only; replay returns not_found.';

-- ─────────────────────────────────────────────────────────────────────────
-- 7. Overview: the manual_due queue carries the payable NET per entry.
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
          'failed_transfers', (SELECT count(*) FROM teacher_transfers tt
            WHERE tt.teacher_id = tp.teacher_id AND tt.status = 'failed'),
          'last_transfer_error', (SELECT tt.error_detail FROM teacher_transfers tt
            WHERE tt.teacher_id = tp.teacher_id AND tt.status = 'failed'
            ORDER BY tt.updated_at DESC LIMIT 1),
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
          -- FR-027a: what the admin actually pays for THIS entry (remaining
          -- value minus its FIFO debt share). The settle fences on this number.
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
    ), '[]'::jsonb)
  );
$$;

COMMENT ON FUNCTION connect_admin_payouts_overview() IS
  'Spec 040 Phase 4 + FR-027a: one-shot admin ops snapshot; manual_due queue rows carry net_due_cents (remaining minus FIFO debt share). Service-role only; callers must requireAdmin().';
