-- 20260808000000_connect_admin_payouts.sql
--
-- Spec 040 Phase 4 — admin payouts ops surface (FR-022/023/025/027).
--
-- EXPAND-only, DORMANT-safe: read snapshot + one audited setter. Both are
-- service-role-only (spec-016 lockdown); the server actions/pages that call
-- them run requireAdmin() first, and every mutation stamps the acting admin
-- into the audit trail (connect_payout_audit — free-event append-only table
-- from Phase 0; new events: 'payout_method_change' detail now carries the
-- manual_due re-route count, and the actions layer logs 'manual_due_export').
--
-- Hold place/lift ride the same RPC-only convention (the Connect tables are
-- deliberately absent from the typed client layer): payout_holds rows are
-- themselves the audit (created_by / released_by attribution enforced by
-- Phase-0 CHECKs). The admin LIFT is also the designed recovery path for a
-- stale 'dispute:*' hold whose charge.dispute.closed never arrived
-- (Phase 3b security review).

-- ─────────────────────────────────────────────────────────────────────────
-- 1. connect_admin_payouts_overview — one atomic ops snapshot (FR-023/US5)
-- ─────────────────────────────────────────────────────────────────────────
-- Per-teacher: rail, Connect account state, cents by lifecycle status,
-- outstanding debt (ledger-header formula), failed transfers + latest error,
-- active holds. Plus the manual_due queue (FR-027) and the cutover date
-- (FR-022 legacy labeling: deliveries before it are legacy-payroll months).
CREATE OR REPLACE FUNCTION connect_admin_payouts_overview()
RETURNS jsonb
LANGUAGE sql
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
          -- ONE debt definition (ledger migration header) — never restated.
          'outstanding_debt_cents', GREATEST(0, -1 * COALESCE((SELECT SUM(d.amount_cents)
            FROM teacher_earning_entries d
            WHERE d.teacher_id = tp.teacher_id
              AND d.kind IN ('clawback','debt_recovery','debt_recovery_reversal')), 0)),
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

-- Overview aggregates + manual_due queue support (DB-review P1: the sweep
-- index is partial on pending/processing and cannot serve the other statuses;
-- the queue scan has no teacher predicate at all).
CREATE INDEX idx_earning_entries_teacher_status
  ON teacher_earning_entries (teacher_id, status);
CREATE INDEX idx_earning_entries_manual_due
  ON teacher_earning_entries (created_at)
  WHERE status = 'manual_due';

-- ─────────────────────────────────────────────────────────────────────────
-- 2. connect_admin_set_payout_method — audited rail switch (FR-025)
-- ─────────────────────────────────────────────────────────────────────────
-- Atomic: method change + audit row + the plan's "stuck manual_due re-route
-- recovery" in one transaction. Switching to the Stripe rail returns
-- manual_due entries to 'pending' — the settle action can no longer touch
-- them (its fenced UPDATE requires the manual rail) and the sweep re-derives
-- the new rail at claim time, so without the re-route they would be stuck
-- forever. Switching TO manual needs no re-route: 'pending' entries route to
-- the manual queue at the next sweep by construction.
CREATE OR REPLACE FUNCTION connect_admin_set_payout_method(
  p_teacher_id uuid,
  p_method     text,
  p_actor      uuid
)
RETURNS TABLE (outcome text, rerouted_entries integer)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_old      text;
  v_rerouted integer := 0;
BEGIN
  IF p_method IS NULL OR p_method NOT IN ('stripe_connect', 'manual') THEN
    RAISE EXCEPTION 'connect_admin_set_payout_method: invalid method %', p_method;
  END IF;
  IF p_actor IS NULL THEN
    RAISE EXCEPTION 'connect_admin_set_payout_method: actor is required (FR-025 audit)';
  END IF;

  SELECT tp.payout_method INTO v_old
    FROM teacher_profiles tp
   WHERE tp.teacher_id = p_teacher_id
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'connect_admin_set_payout_method: teacher % has no teacher_profiles row', p_teacher_id;
  END IF;
  IF v_old = p_method THEN
    RETURN QUERY SELECT 'unchanged'::text, 0;
    RETURN;
  END IF;

  -- DB-review P1: the Phase-0 guard trigger also writes a
  -- 'payout_method_change' audit row, but through the service-role client its
  -- actor is NULL (no JWT sub) — leaving a phantom unattributed row next to
  -- this function's attributed one. Suppress the trigger's insert for this
  -- txn (txn-local set_config; the trigger keeps auditing direct writes).
  PERFORM set_config('app.payout_method_audit_suppressed', '1', true);
  UPDATE teacher_profiles SET payout_method = p_method
   WHERE teacher_id = p_teacher_id;

  IF p_method = 'stripe_connect' THEN
    UPDATE teacher_earning_entries e
       SET status = 'pending'
     WHERE e.teacher_id = p_teacher_id AND e.status = 'manual_due';
    GET DIAGNOSTICS v_rerouted = ROW_COUNT;
  END IF;

  INSERT INTO connect_payout_audit (event, actor, subject_teacher_id, detail)
  VALUES ('payout_method_change', p_actor, p_teacher_id,
          jsonb_build_object('old', v_old, 'new', p_method,
                             'rerouted_manual_due', v_rerouted));

  RETURN QUERY SELECT 'changed'::text, v_rerouted;
END;
$$;

-- Phase-0 guard trigger, re-created verbatim EXCEPT the payout_method audit
-- insert now honours the txn-local suppression flag set by
-- connect_admin_set_payout_method (which writes the attributed row itself).
-- Direct service-role/admin writes outside that function keep the trigger
-- audit exactly as before.
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
  v_trusted := v_jwt_role IS NULL
            OR v_jwt_role = 'service_role'
            OR private.is_admin();

  IF NEW.payout_method IS DISTINCT FROM OLD.payout_method THEN
    IF NOT v_trusted THEN
      RAISE EXCEPTION 'payout_method is admin/service-role writable only (spec FR-025)'
        USING errcode = '42501';
    END IF;
    IF COALESCE(current_setting('app.payout_method_audit_suppressed', true), '') <> '1' THEN
      INSERT INTO connect_payout_audit (event, actor, subject_teacher_id, detail)
      VALUES ('payout_method_change', v_actor, NEW.teacher_id,
              jsonb_build_object('old', OLD.payout_method, 'new', NEW.payout_method));
    END IF;
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
REVOKE EXECUTE ON FUNCTION guard_teacher_profiles_payout_columns()
  FROM public, anon, authenticated;

-- ─────────────────────────────────────────────────────────────────────────
-- 3. Hold place/lift + export audit (FR-023 / FR-027) — RPC-only convention
-- ─────────────────────────────────────────────────────────────────────────
-- The Connect tables are deliberately absent from the typed client layer, so
-- even these simple writes go through service-role RPCs. The payout_holds row
-- itself is the audit (created_by / released_by CHECK-enforced attribution).
CREATE OR REPLACE FUNCTION connect_admin_place_hold(
  p_teacher_id uuid,
  p_reason     text,
  p_actor      uuid
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_id uuid;
BEGIN
  IF p_reason IS NULL OR btrim(p_reason) = '' THEN
    RAISE EXCEPTION 'connect_admin_place_hold: reason must be non-empty';
  END IF;
  IF p_actor IS NULL THEN
    RAISE EXCEPTION 'connect_admin_place_hold: actor is required';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM profiles WHERE id = p_teacher_id) THEN
    RAISE EXCEPTION 'connect_admin_place_hold: unknown teacher %', p_teacher_id;
  END IF;

  -- Replay-safe (DB-review P2): a double-click/retry with the same reason
  -- returns the existing ACTIVE hold instead of stacking a duplicate an
  -- admin would have to discover and lift separately.
  SELECT ph.id INTO v_id FROM payout_holds ph
   WHERE ph.teacher_id = p_teacher_id AND ph.source = 'admin'
     AND ph.reason = btrim(p_reason) AND ph.released_at IS NULL
   LIMIT 1;
  IF FOUND THEN
    RETURN v_id;
  END IF;

  INSERT INTO payout_holds (teacher_id, source, reason, created_by)
  VALUES (p_teacher_id, 'admin', btrim(p_reason), p_actor)
  RETURNING id INTO v_id;
  RETURN v_id;
END;
$$;

-- Lift any active hold — admin holds AND stale 'dispute:*' holds whose
-- charge.dispute.closed never arrived (the Phase 3b recovery path).
-- 'not_found' covers already-released and unknown ids (fenced, replay-safe).
CREATE OR REPLACE FUNCTION connect_admin_lift_hold(
  p_hold_id uuid,
  p_actor   uuid
)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_n integer;
BEGIN
  IF p_actor IS NULL THEN
    RAISE EXCEPTION 'connect_admin_lift_hold: actor is required';
  END IF;

  UPDATE payout_holds
     SET released_at = now(), released_by = p_actor
   WHERE id = p_hold_id AND released_at IS NULL;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  RETURN CASE WHEN v_n = 1 THEN 'lifted' ELSE 'not_found' END;
END;
$$;

-- FR-027: the manual_due export is refused unless it can be audited — the
-- action calls this FIRST and aborts the export when it raises.
CREATE OR REPLACE FUNCTION connect_admin_log_export(
  p_actor uuid,
  p_rows  integer
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF p_actor IS NULL THEN
    RAISE EXCEPTION 'connect_admin_log_export: actor is required';
  END IF;
  INSERT INTO connect_payout_audit (event, actor, subject_teacher_id, detail)
  VALUES ('manual_due_export', p_actor, NULL,
          jsonb_build_object('rows', GREATEST(0, COALESCE(p_rows, 0))));
END;
$$;

-- ─────────────────────────────────────────────────────────────────────────
-- 4. Lockdown (spec-016)
-- ─────────────────────────────────────────────────────────────────────────
ALTER FUNCTION connect_admin_place_hold(uuid, text, uuid) OWNER TO postgres;
REVOKE EXECUTE ON FUNCTION connect_admin_place_hold(uuid, text, uuid)
  FROM public, anon, authenticated;
GRANT  EXECUTE ON FUNCTION connect_admin_place_hold(uuid, text, uuid)
  TO service_role;

ALTER FUNCTION connect_admin_lift_hold(uuid, uuid) OWNER TO postgres;
REVOKE EXECUTE ON FUNCTION connect_admin_lift_hold(uuid, uuid)
  FROM public, anon, authenticated;
GRANT  EXECUTE ON FUNCTION connect_admin_lift_hold(uuid, uuid)
  TO service_role;

ALTER FUNCTION connect_admin_log_export(uuid, integer) OWNER TO postgres;
REVOKE EXECUTE ON FUNCTION connect_admin_log_export(uuid, integer)
  FROM public, anon, authenticated;
GRANT  EXECUTE ON FUNCTION connect_admin_log_export(uuid, integer)
  TO service_role;

COMMENT ON FUNCTION connect_admin_place_hold(uuid, text, uuid) IS
  'Spec 040 FR-023: place an admin payout hold (blocks the sweep for the teacher). Attribution required. Service-role only.';
COMMENT ON FUNCTION connect_admin_lift_hold(uuid, uuid) IS
  'Spec 040 FR-023: lift an active hold (admin or stale dispute hold — the Phase 3b recovery path). Fenced/replay-safe. Service-role only.';
COMMENT ON FUNCTION connect_admin_log_export(uuid, integer) IS
  'Spec 040 FR-027: append-only audit row for a manual_due CSV export. Service-role only.';

ALTER FUNCTION connect_admin_payouts_overview() OWNER TO postgres;
REVOKE EXECUTE ON FUNCTION connect_admin_payouts_overview()
  FROM public, anon, authenticated;
GRANT  EXECUTE ON FUNCTION connect_admin_payouts_overview()
  TO service_role;

ALTER FUNCTION connect_admin_set_payout_method(uuid, text, uuid) OWNER TO postgres;
REVOKE EXECUTE ON FUNCTION connect_admin_set_payout_method(uuid, text, uuid)
  FROM public, anon, authenticated;
GRANT  EXECUTE ON FUNCTION connect_admin_set_payout_method(uuid, text, uuid)
  TO service_role;

COMMENT ON FUNCTION connect_admin_payouts_overview() IS
  'Spec 040 Phase 4: one-shot admin ops snapshot — per-teacher payout states, debt, failed transfers, holds, manual_due queue, cutover. Service-role only; callers must requireAdmin().';
COMMENT ON FUNCTION connect_admin_set_payout_method(uuid, text, uuid) IS
  'Spec 040 FR-025: audited payout_method switch with stuck-manual_due re-route recovery. Service-role only; callers must requireAdmin() and pass the acting admin.';
