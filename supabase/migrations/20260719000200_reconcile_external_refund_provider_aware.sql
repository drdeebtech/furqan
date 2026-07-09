-- Spec 039 (PayPal payments), Phase 2b — provider-neutral external-refund reconcile.
--
-- WHY. `reconcile_external_prepaid_refund(p_payment_intent text)` (spec 038 H5)
--   voids a prepaid lot's remaining hours when its payment is reversed OUTSIDE
--   our admin saga (a Stripe-dashboard refund, a dispute/chargeback). It looked
--   the lot up by `stripe_payment_intent_id` — Stripe-only. A PayPal refund
--   (PAYMENT.CAPTURE.REFUNDED) reverses money the same way and must void the
--   same way, but a PayPal lot has NO stripe_payment_intent_id (it's NULL) — it
--   is keyed by `provider_payment_ref` (the capture id).
--
-- WHAT. Re-point the lookup at the processor-neutral `provider_payment_ref`.
--   This serves BOTH processors with ONE function:
--     • Stripe caller passes the PaymentIntent id — which equals
--       provider_payment_ref for Stripe lots (Phase 1 backfill + the provider-
--       aware grant both write it), so the existing charge.refunded /
--       charge.dispute webhook keeps working with NO caller change.
--     • PayPal caller passes the capture id — which equals provider_payment_ref
--       for PayPal lots.
--   Body is otherwise byte-identical (FOR UPDATE, idempotent 0-remaining no-op,
--   void ALL remaining, append one 'refunded' event).
--
-- NOTE (unchanged, pre-existing behavior): a PARTIAL external refund still voids
--   ALL remaining hours (fairness/fail-safe). Proportional voiding is a separate
--   documented follow-up for BOTH processors, not this migration.
--
-- Expand/contract: CREATE OR REPLACE, SAME signature — not a breaker. The only
--   change is the WHERE column (stripe_payment_intent_id → provider_payment_ref),
--   both present on student_packages. Existing ACL/owner are preserved by
--   REPLACE; re-asserted below for clarity. Verified: local rolled-back walk
--   (walk_2b_refund.sql) — a Stripe lot voids via its PI, a PayPal lot voids via
--   its capture id, a second call is a no-op.

CREATE OR REPLACE FUNCTION public.reconcile_external_prepaid_refund(p_payment_intent text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_id uuid;
  v_remaining integer;
BEGIN
  IF p_payment_intent IS NULL THEN
    RAISE EXCEPTION 'reconcile_external_prepaid_refund: p_payment_intent is required'
      USING ERRCODE = 'P0001';
  END IF;

  -- Provider-neutral lookup: provider_payment_ref = the Stripe PaymentIntent id
  -- (Stripe lots) or the PayPal capture id (PayPal lots).
  SELECT id, sessions_remaining INTO v_id, v_remaining
    FROM public.student_packages
    WHERE provider_payment_ref = p_payment_intent
      AND product_type = 'prepaid_hours'
    FOR UPDATE;

  -- Not a prepaid lot (subscription / legacy / unknown ref) → nothing to do.
  IF NOT FOUND THEN
    RETURN;
  END IF;

  -- Idempotent: already voided (prior call or the sweep).
  IF v_remaining IS NULL OR v_remaining <= 0 THEN
    RETURN;
  END IF;

  -- Void ALL remaining hours on this lot. The wallet balance for this lot drops
  -- to zero; the student cannot spend reversed money.
  UPDATE public.student_packages
    SET sessions_used = sessions_used + v_remaining
    WHERE id = v_id;

  PERFORM public.record_prepaid_event(
    v_id, 'refunded', -v_remaining, p_payment_intent
  );
END;
$$;

ALTER FUNCTION public.reconcile_external_prepaid_refund(text) OWNER TO postgres;
REVOKE EXECUTE ON FUNCTION public.reconcile_external_prepaid_refund(text) FROM public, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.reconcile_external_prepaid_refund(text) TO service_role;
