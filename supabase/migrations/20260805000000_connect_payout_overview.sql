-- 20260805000000_connect_payout_overview.sql
--
-- Spec 040 Phase 2 (UI read model) — one atomic, consistent read for the
-- teacher payouts page (FR-024): agreement state, outstanding negative
-- balance, and the earnings ledger rows, in a single snapshot. A multi-query
-- app-layer read could see the ledger mid-settlement; one SQL function
-- cannot. Service-role only (the page's server component calls it AFTER the
-- session/teacher gate), spec-016 lockdown, expand-only, DORMANT until the
-- payouts page ships (same PR).
--
-- The outstanding-debt expression below cites THE one definition in
-- 20260728000000_connect_earnings_ledger.sql's header (sign convention:
-- clawback negative, debt_recovery positive, debt_recovery_reversal
-- negative) — the same inline-citation practice as connect_sweep_claim_eligible.

CREATE OR REPLACE FUNCTION connect_teacher_payout_overview(p_teacher_id uuid)
RETURNS TABLE (
  current_version        text,
  accepted_current       boolean,
  grace_until            timestamptz,
  outstanding_debt_cents bigint,
  -- Latest 200 ledger rows, newest first (FR-024's transparency surface).
  entries                jsonb
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    (SELECT ps.value FROM platform_settings ps
      WHERE ps.key = 'teacher_agreement_current_version')          AS current_version,
    EXISTS (
      SELECT 1 FROM teacher_agreement_acceptances a
       WHERE a.teacher_id = p_teacher_id
         AND a.agreement_version = (SELECT ps.value FROM platform_settings ps
                                     WHERE ps.key = 'teacher_agreement_current_version')
    )                                                              AS accepted_current,
    (SELECT tp.agreement_grace_until FROM teacher_profiles tp
      WHERE tp.teacher_id = p_teacher_id)                          AS grace_until,
    -- One definition (ledger header): GREATEST(0, -1 * SUM over debt kinds).
    (SELECT GREATEST(0, -1 * COALESCE(SUM(e.amount_cents) FILTER (
        WHERE e.kind IN ('clawback', 'debt_recovery', 'debt_recovery_reversal')), 0))
       FROM teacher_earning_entries e
      WHERE e.teacher_id = p_teacher_id)                           AS outstanding_debt_cents,
    (SELECT COALESCE(jsonb_agg(row_to_json(x)), '[]'::jsonb) FROM (
       SELECT e.id, e.kind, e.amount_cents, e.status, e.hold_reason,
              e.session_delivery_id, e.recovered_against_entry_id,
              e.settled_at, e.created_at
         FROM teacher_earning_entries e
        WHERE e.teacher_id = p_teacher_id
        ORDER BY e.created_at DESC
        LIMIT 200
     ) x)                                                          AS entries;
$$;

ALTER FUNCTION connect_teacher_payout_overview(uuid) OWNER TO postgres;
REVOKE EXECUTE ON FUNCTION connect_teacher_payout_overview(uuid)
  FROM public, anon, authenticated;
GRANT  EXECUTE ON FUNCTION connect_teacher_payout_overview(uuid)
  TO service_role;

COMMENT ON FUNCTION connect_teacher_payout_overview(uuid) IS
  'Spec 040 FR-024: one consistent snapshot for the teacher payouts page — agreement state, outstanding debt (THE ledger-header formula), latest 200 ledger rows. Service-role only.';
