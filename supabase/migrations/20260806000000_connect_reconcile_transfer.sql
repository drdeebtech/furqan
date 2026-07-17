-- 20260806000000_connect_reconcile_transfer.sql
--
-- Spec 040 Phase 3 — transfer-status reconciliation for the Connect webhook.
-- Money rows are created SYNCHRONOUSLY by the sweep (plan Phase 3: "webhooks
-- never create money rows"); the webhook only reconciles the status of an
-- existing teacher_transfers row against Stripe's view.
--
-- Idiom mirrors the sibling 040 function migrations: SECURITY DEFINER,
-- REVOKE public+anon+authenticated / GRANT service_role (spec-016), pinned
-- search_path, OWNER TO postgres. EXPAND-only, DORMANT until the Connect
-- webhook route ships (same PR) and Stripe events start arriving (post-live).

CREATE OR REPLACE FUNCTION connect_reconcile_transfer(
  p_stripe_transfer_id text,
  p_reversed boolean
)
RETURNS text -- 'reconciled' | 'unknown_transfer'
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF p_stripe_transfer_id IS NULL OR btrim(p_stripe_transfer_id) = '' THEN
    RAISE EXCEPTION 'connect_reconcile_transfer: stripe_transfer_id must be non-empty';
  END IF;

  -- transfer.created confirms the transfer landed → succeeded.
  -- transfer.reversed is informational here: the REVERSAL money row is
  -- written synchronously by the clawback path (Phase 3b), never by the
  -- webhook — no UPDATE at all for a reversal (review nit: a CASE
  -- self-assignment would churn the row and fire triggers for nothing).
  -- Phase 3b note (recorded decision, not an accident): if clawback ever
  -- writes 'pending' rows, a reversed-before-created ordering still ends
  -- 'succeeded' — correct, because the original transfer DID land; the
  -- reversal is its own money row.
  IF NOT p_reversed THEN
    UPDATE teacher_transfers
       SET status = 'succeeded'
     WHERE stripe_transfer_id = p_stripe_transfer_id
       AND status = 'pending';
  END IF;

  IF EXISTS (SELECT 1 FROM teacher_transfers
              WHERE stripe_transfer_id = p_stripe_transfer_id) THEN
    RETURN 'reconciled';
  END IF;
  RETURN 'unknown_transfer';
END;
$$;

ALTER FUNCTION connect_reconcile_transfer(text, boolean) OWNER TO postgres;
REVOKE EXECUTE ON FUNCTION connect_reconcile_transfer(text, boolean)
  FROM public, anon, authenticated;
GRANT  EXECUTE ON FUNCTION connect_reconcile_transfer(text, boolean)
  TO service_role;

COMMENT ON FUNCTION connect_reconcile_transfer(text, boolean) IS
  'Spec 040 Phase 3: reconcile a teacher_transfers row status against a Stripe transfer.created/reversed event. Never creates rows. Service-role only.';
