-- Spec 039 (PayPal payments), Phase 1 — provider-agnostic payment reference.
--
-- WHY. The prepaid-hour wallet (spec 038) was built Stripe-first: a purchased
--   lot records `student_packages.stripe_payment_intent_id`. To also accept
--   PayPal (an interim processor while the Manaracode EIN — and therefore Stripe
--   — is pending), a lot needs to say WHICH processor paid for it and carry that
--   processor's payment reference in a provider-neutral column. The DB "grant
--   hours" engine (`grant_prepaid_hours(p_payment_intent text, …)`) is already
--   provider-agnostic at its signature (a plain text ref), so only the storage
--   shape needs generalizing — not the wallet or ledger.
--
-- WHAT (this migration — foundation only, NO money-function change):
--   • `payment_provider`     — which processor funded the lot ('stripe'|'paypal').
--                              Existing + any new Stripe lots default 'stripe'
--                              (correct: they came from Stripe).
--   • `provider_payment_ref` — the processor's payment reference in a neutral
--                              column, backfilled from `stripe_payment_intent_id`
--                              for existing rows so history is complete.
--   The Stripe path is untouched and keeps working exactly as before
--   (`stripe_payment_intent_id` + its UNIQUE index remain the live idempotency
--   key). Phase 2 — delivered WITH the PayPal checkout + webhook, once sandbox
--   credentials exist — makes `grant_prepaid_hours` provider-aware (write
--   `payment_provider`/`provider_payment_ref` and add the cross-provider UNIQUE
--   idempotency index). Splitting it this way keeps every step independently
--   verifiable and never leaves a half-wired money path.
--
-- Expand/contract: strictly ADDITIVE. `payment_provider` is NOT NULL DEFAULT
--   'stripe' (Postgres fast-default, no table rewrite); the CHECK is satisfied
--   by every existing row (all Stripe); `provider_payment_ref` is nullable; the
--   backfill only sets rows that had a Stripe ref. No column dropped/renamed, no
--   type narrowed, no existing function changed — the currently-running build is
--   unaffected. `stripe_payment_intent_id` stays (contract in a later PR once
--   all reads move to the neutral column).

ALTER TABLE public.student_packages
  ADD COLUMN IF NOT EXISTS payment_provider text NOT NULL DEFAULT 'stripe',
  ADD COLUMN IF NOT EXISTS provider_payment_ref text;

-- Constrain the provider vocabulary (widen-safe: every existing row is 'stripe').
ALTER TABLE public.student_packages
  DROP CONSTRAINT IF EXISTS student_packages_payment_provider_check;
ALTER TABLE public.student_packages
  ADD CONSTRAINT student_packages_payment_provider_check
  CHECK (payment_provider IN ('stripe', 'paypal'));

-- Backfill the neutral reference from the Stripe column for existing lots, so
-- reporting/idempotency on provider_payment_ref sees full history.
UPDATE public.student_packages
  SET provider_payment_ref = stripe_payment_intent_id
  WHERE stripe_payment_intent_id IS NOT NULL
    AND provider_payment_ref IS NULL;

COMMENT ON COLUMN public.student_packages.payment_provider IS
  'Spec 039: payment processor that funded this lot (stripe|paypal). Default '
  'stripe; PayPal grants (Phase 2) set paypal.';
COMMENT ON COLUMN public.student_packages.provider_payment_ref IS
  'Spec 039: processor-neutral payment reference (Stripe PaymentIntent id or '
  'PayPal capture/order id). Backfilled from stripe_payment_intent_id. Phase 2 '
  'adds the cross-provider UNIQUE idempotency index once grant_prepaid_hours '
  'populates it.';
