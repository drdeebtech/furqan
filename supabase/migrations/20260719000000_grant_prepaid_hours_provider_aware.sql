-- Spec 039 (PayPal payments), Phase 2b — make grant_prepaid_hours provider-aware.
--
-- WHY. Phase 1 (20260718000000) added `student_packages.payment_provider` and
--   `provider_payment_ref` but left the money function Stripe-only: it keyed
--   idempotency on `stripe_payment_intent_id` and never populated the neutral
--   columns for new grants. To let PayPal fund a lot — with the SAME grant
--   function, ledger, and wallet (DRY: one money path, two front doors) — the
--   function must (a) accept which processor paid, (b) key idempotency on the
--   processor-neutral `provider_payment_ref`, and (c) stamp both new columns so
--   every future lot records its funding source.
--
-- WHAT:
--   • A cross-provider UNIQUE partial index on `provider_payment_ref` — THE
--     idempotency claim for both processors (a Stripe PaymentIntent id or a
--     PayPal capture id). Phase 1 already backfilled this column from
--     `stripe_payment_intent_id`, so existing Stripe lots are covered and the
--     index builds clean.
--   • `grant_prepaid_hours` gains a `p_provider` argument (DEFAULT 'stripe' so
--     the semantics are unchanged for any un-migrated caller) and now:
--       – validates provider ∈ (stripe, paypal),
--       – pre-checks / ON CONFLICTs on `provider_payment_ref = p_payment_intent`,
--       – writes `payment_provider` + `provider_payment_ref` on every insert,
--       – still writes `stripe_payment_intent_id` for Stripe grants (kept during
--         the expand phase so existing reads / its UNIQUE index keep working);
--         PayPal grants leave it NULL.
--
-- SIGNATURE CHANGE (safe here). CREATE OR REPLACE cannot add a parameter, so we
--   DROP the 4-arg function and CREATE the 5-arg one. This is normally a
--   contract-phase move, but it is safe now: spec 038 is NOT deployed to
--   production, so NOTHING in the running build calls `grant_prepaid_hours`. The
--   only caller (`src/lib/domains/billing/webhook-handlers.ts`) ships on this
--   same branch and is updated in the same change to pass `p_provider`. The
--   migration-safety guard does not flag DROP FUNCTION; there is no live shape to
--   break.
-- expand-contract-ok: 038 undeployed — no live caller of grant_prepaid_hours; sole caller updated on this branch.
--
-- Idempotency proof: see the local rolled-back walk (scratchpad walk_2b.sql) —
--   duplicate Stripe intent AND duplicate PayPal capture both return the existing
--   lot with NO second grant event; a fresh PayPal capture grants a new lot.

-- ── Cross-provider idempotency index ─────────────────────────────────────────
CREATE UNIQUE INDEX IF NOT EXISTS uix_student_packages_provider_payment_ref
  ON public.student_packages (provider_payment_ref)
  WHERE provider_payment_ref IS NOT NULL;

-- ── Provider-aware grant function ────────────────────────────────────────────
DROP FUNCTION IF EXISTS public.grant_prepaid_hours(text, uuid, int, numeric);

CREATE FUNCTION public.grant_prepaid_hours(
  p_payment_intent text,
  p_student uuid,
  p_hours int,
  p_rate numeric,
  p_provider text DEFAULT 'stripe'
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_lot_id uuid;
  v_window_months int;
BEGIN
  IF p_payment_intent IS NULL OR p_student IS NULL OR p_hours IS NULL OR p_hours <= 0 OR p_rate IS NULL THEN
    RAISE EXCEPTION 'grant_prepaid_hours: invalid arguments (intent=%, student=%, hours=%, rate=%)',
      p_payment_intent, p_student, p_hours, p_rate
      USING ERRCODE = 'P0001';
  END IF;

  IF p_provider IS NULL OR p_provider NOT IN ('stripe', 'paypal') THEN
    RAISE EXCEPTION 'grant_prepaid_hours: invalid provider (%)', p_provider
      USING ERRCODE = 'P0001';
  END IF;

  -- H1 idempotency pre-check (fast path): a lot already exists for this payment
  -- reference (Stripe PaymentIntent id or PayPal capture id) → webhook / capture
  -- redelivery. Return the existing id; do NOT append a duplicate grant event.
  SELECT id INTO v_lot_id
    FROM public.student_packages
    WHERE provider_payment_ref = p_payment_intent;
  IF v_lot_id IS NOT NULL THEN
    RETURN v_lot_id;
  END IF;

  -- Rolling expiry window (D5). Missing/blank/0 → default 12 (the seeded value).
  SELECT COALESCE(NULLIF(TRIM(value), '')::integer, 12)
    INTO v_window_months
    FROM public.platform_settings
    WHERE key = 'prepaid_hours_expiry_months';
  v_window_months := COALESCE(v_window_months, 12);

  -- Insert a NEW lot (R1). ON CONFLICT on the cross-provider partial unique
  -- index is the race backstop: two concurrent grants for the same payment ref
  -- cannot both land (the second is a no-op). Partial-index inference requires
  -- the matching WHERE clause. RETURNING captures the id only on a real insert.
  -- Stripe grants keep writing stripe_payment_intent_id (expand-phase back-compat);
  -- PayPal grants leave it NULL and rely on provider_payment_ref.
  INSERT INTO public.student_packages (
    student_id, package_id, sessions_total, sessions_used, status,
    product_type, rate_paid_usd,
    payment_provider, provider_payment_ref, stripe_payment_intent_id,
    expires_at, purchased_at
  )
  VALUES (
    p_student,
    'c0ffee01-0000-4000-8000-000000038000',  -- Phase-1 seeded catalog row
    p_hours,
    0,
    'active',
    'prepaid_hours',
    p_rate,
    p_provider,
    p_payment_intent,
    CASE WHEN p_provider = 'stripe' THEN p_payment_intent ELSE NULL END,
    now() + (v_window_months * interval '1 month'),
    now()
  )
  ON CONFLICT (provider_payment_ref) WHERE provider_payment_ref IS NOT NULL
    DO NOTHING
  RETURNING id INTO v_lot_id;

  -- Lost the race: another grant for the same payment ref landed first. Re-fetch
  -- the existing lot id so the caller gets a stable handle, but DO NOT append a
  -- second grant event (the winner already did).
  IF v_lot_id IS NULL THEN
    SELECT id INTO v_lot_id
      FROM public.student_packages
      WHERE provider_payment_ref = p_payment_intent;
    RETURN v_lot_id;
  END IF;

  -- Real insert: append the singular 'grant' event (R5). The Phase-1 partial
  -- unique index uix_prepaid_hours_events_one_grant_per_lot guarantees exactly
  -- one grant event per lot, even under retry.
  PERFORM public.record_prepaid_event(v_lot_id, 'grant', p_hours, p_payment_intent);

  RETURN v_lot_id;
END;
$$;

ALTER FUNCTION public.grant_prepaid_hours(text, uuid, int, numeric, text) OWNER TO postgres;

-- SECURITY DEFINER lockdown for the NEW signature (mirrors every 038 function):
-- callable only by service_role (webhook/admin server paths); never anon/authed.
REVOKE EXECUTE ON FUNCTION public.grant_prepaid_hours(text, uuid, int, numeric, text) FROM public, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.grant_prepaid_hours(text, uuid, int, numeric, text) TO service_role;
