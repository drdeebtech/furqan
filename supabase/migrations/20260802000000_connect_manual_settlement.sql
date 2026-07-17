-- 20260802000000_connect_manual_settlement.sql
--
-- Spec 040 (Stripe Connect teacher payouts) — Phase 1 (item 5): the manual-rail
-- settlement function behind src/lib/domains/connect/manual-settlement.ts. It
-- closes the loop the #716 sweep opens: connect_sweep_record_manual_due flips a
-- manual-rail entry processing → manual_due (the admin off-Stripe queue, FR-026);
-- this settles it manual_due → manual_paid with an external reference, actor and
-- timestamp — the off-Stripe analogue of a Transfer Record (FR-027).
--
-- Scope: ONE function + GRANTs. No new table, no column (Phase 0's #709 already
-- shipped manual_due/manual_paid, external_reference_id/settled_by/settled_at and
-- the chk_entry_manual_settlement + chk_entry_reference_nonblank + partial
-- UNIQUE(teacher_id, external_reference_id) constraints). Pure EXPAND
-- (backward-compatible, CLAUDE.md §4): CREATE FUNCTION + GRANTs only, nothing
-- dropped/renamed/narrowed.
--
-- DORMANT in production: a manual_due entry only exists after the sweep runs,
-- and the sweep claims nothing until connect_cutover_date is set (spec FR-021).
--
-- Idioms copied verbatim from the merged 040 migrations:
--   * SECURITY DEFINER + REVOKE FROM public,anon,authenticated / GRANT
--     service_role (spec-016 lockdown — name anon+authenticated explicitly),
--     pinned search_path, OWNER postgres.
--   * boolean return = "did the fenced conditional UPDATE hit a row?" — the same
--     no-op-is-false posture as connect_sweep_record_*.

-- ─────────────────────────────────────────────────────────────────────────
-- connect_settle_manual_due — admin off-Stripe settlement (FR-027).
-- ─────────────────────────────────────────────────────────────────────────
-- Single conditional UPDATE. Returns:
--   true  → this call settled the entry (manual_due → manual_paid).
--   false → the fenced UPDATE hit zero rows: a replay (already manual_paid), a
--           wrong-status entry, or a stripe_connect entry the payout_method
--           guard refused. A legitimate no-op, never an error.
-- RAISES only on a caller contract breach (a blank reference) — surfaced LOUDLY
-- so it can never be mistaken for the "already settled" no-op above.
--
-- The teacher's payout_method='manual' guard (a correlated EXISTS on
-- teacher_profiles) is what makes this rail-safe: it can NEVER touch a
-- stripe_connect entry, so an admin cannot hand-settle money that must flow
-- through Stripe (FR-025/FR-026). The partial UNIQUE(teacher_id,
-- external_reference_id) backstops a pasted-twice reference at the DB.
CREATE OR REPLACE FUNCTION connect_settle_manual_due(
  p_entry_id       uuid,
  p_reference_id   text,
  p_settling_admin uuid
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_hit boolean := false;
BEGIN
  -- Fail-closed: a blank reference is a caller breach (the zod layer catches it
  -- first). RAISE — never let a blank masquerade as evidence money left, and
  -- never conflate it with the legitimate no-op false below.
  IF coalesce(btrim(p_reference_id), '') = '' THEN
    RAISE EXCEPTION 'connect_settle_manual_due: reference_id must be non-blank';
  END IF;

  UPDATE teacher_earning_entries e
     SET status                = 'manual_paid',
         external_reference_id = btrim(p_reference_id),
         settled_by            = p_settling_admin,
         settled_at            = now()
   WHERE e.id = p_entry_id
     AND e.status = 'manual_due'
     AND EXISTS (
       SELECT 1
         FROM teacher_profiles tp
        WHERE tp.teacher_id = e.teacher_id
          AND tp.payout_method = 'manual'
     );

  GET DIAGNOSTICS v_hit = ROW_COUNT;
  RETURN v_hit;
END;
$$;

ALTER FUNCTION connect_settle_manual_due(uuid, text, uuid) OWNER TO postgres;
REVOKE EXECUTE ON FUNCTION connect_settle_manual_due(uuid, text, uuid)
  FROM public, anon, authenticated;
GRANT  EXECUTE ON FUNCTION connect_settle_manual_due(uuid, text, uuid)
  TO service_role;

COMMENT ON FUNCTION connect_settle_manual_due(uuid, text, uuid) IS
  'Spec 040 FR-027: settle one manual-rail earning entry manual_due → manual_paid off-Stripe. Service-role only; payout_method=manual guard makes it rail-safe; replay is a no-op (returns false).';
