-- Spec 039 (PayPal payments), Phase 2b — provider tag on the webhook ledger.
--
-- WHY. `billing_events` is the idempotency + audit ledger for Stripe webhook
--   deliveries (UNIQUE `stripe_event_id`: a redelivery is a 200 no-op). The
--   PayPal webhook (Phase 2b) needs the same "already processed this exact
--   event" guard. Rather than a parallel table, reuse this one: store the PayPal
--   webhook event id in `stripe_event_id` (its UNIQUE constraint dedups either
--   processor's event ids — they never collide) and tag the row's processor with
--   a new `provider` column so admin reads can filter by processor.
--
--   NOTE: correctness of the money grant does NOT depend on this ledger — the
--   grant itself is idempotent on `student_packages.provider_payment_ref` (the
--   capture id), proven in walk_2b.sql. This row is the fast dedup + audit trail,
--   matching the Stripe path's posture.
--
-- Expand/contract: strictly ADDITIVE. `provider` is NOT NULL DEFAULT 'stripe'
--   (Postgres fast-default, no rewrite); every existing row is a Stripe event, so
--   the default is correct and the CHECK is satisfied. No column dropped/renamed,
--   no type narrowed, no existing function changed — the running build is
--   unaffected.

ALTER TABLE public.billing_events
  ADD COLUMN IF NOT EXISTS provider text NOT NULL DEFAULT 'stripe';

ALTER TABLE public.billing_events
  DROP CONSTRAINT IF EXISTS billing_events_provider_check;
ALTER TABLE public.billing_events
  ADD CONSTRAINT billing_events_provider_check
  CHECK (provider IN ('stripe', 'paypal'));

COMMENT ON COLUMN public.billing_events.provider IS
  'Spec 039: payment processor that emitted this event (stripe|paypal). '
  'Default stripe; PayPal webhook rows set paypal.';
COMMENT ON COLUMN public.billing_events.stripe_event_id IS
  'Provider event id — the Stripe event id, or (when provider=paypal) the '
  'PayPal webhook event id. UNIQUE: the redelivery-dedup key for both '
  'processors.';
