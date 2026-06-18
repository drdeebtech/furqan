# Phase 0 — Research: Subscription Billing Foundation

Decisions resolving the Technical Context unknowns and the Constitution gate condition. Format: Decision / Rationale / Alternatives rejected.

## R1 — Domain placement (resolves Constitution gate I)

**Decision**: Create a **`billing` owner-domain** under `src/lib/domains/billing/` and record it in **ADR-0005**, amending the Domains list in `CONTEXT.md`. Billing *grants into* Package (`student_packages`) but **owns** subscription lifecycle, the plan catalog, the customer mapping, and the billing-event ledger — a distinct source of truth from Package.

**Rationale**: Principle I says a table's owner-domain is wherever its source-of-truth tables live. `subscriptions`/`subscription_plans`/`stripe_customers`/`billing_events` have no existing owner. Forcing them under Package would overload Package with Stripe lifecycle it doesn't model. A clean billing domain keeps the grant choreography in one orchestrator.

**Alternatives rejected**: (a) Fold into Package — muddies Package's debit-kernel ownership; rejected. (b) No domain, logic in routes — violates Principle I (route adapters never inline choreography).

## R2 — Webhook signature verification (resolves NFR-001 / FR-012)

**Decision**: Use the **Stripe SDK's `stripe.webhooks.constructEvent(rawBody, sig, STRIPE_WEBHOOK_SECRET)`** as the fail-closed gate. Read the **raw** request body (no JSON parse before verify). On any throw → return 400, zero side effects. `src/lib/security/secrets.ts` constant-time compare remains the reference pattern but Stripe's own verify is canonical for Stripe payloads (handles timestamp tolerance / replay window).

**Rationale**: Stripe-recommended; covers the `t=`/`v1=` scheme and 5-min tolerance window we'd otherwise reimplement. Directly closes the documented "live stub grants free packages" risk.

**Alternatives rejected**: Hand-rolled HMAC via `secrets.ts` — duplicates Stripe's tolerance logic, easy to get subtly wrong; reserved as the n8n/Daily pattern, not Stripe.

**Next API caveat**: This repo runs canary Next.js — confirm raw-body access for the App Router route handler against `node_modules/next/dist/docs/` (`await req.text()` on the `Request`); do **not** assume `bodyParser` config from training data.

## R3 — Idempotent grant (resolves FR-004 / FR-014 / FR-015)

**Decision**: Two layers. (1) **`billing_events.stripe_event_id` UNIQUE** — the route inserts the event row first; a duplicate event id hits the unique violation → treated as already-processed → 2xx no-op. (2) **Grant cycle key**: the SECURITY DEFINER grant function takes a deterministic `cycle_key` (Stripe invoice id + subscription id + period start) and is a **no-op if a `student_packages` grant already carries that key** — so even distinct event ids for the same paid cycle grant once. Payment row reuses **`payments.stripe_payment_intent` UNIQUE** as a third backstop.

**Rationale**: Defense in depth across the three real duplicate sources (event replay, distinct events for one invoice, at-least-once delivery). Mirrors the established `automation_logs.idempotency_key` pattern.

**Alternatives rejected**: Single event-id guard only — fails when Stripe emits both `invoice.paid` and a later `invoice.payment_succeeded` for one cycle.

## R4 — Atomic payment + grant (resolves Principle III / FR-015)

**Decision**: One Postgres `SECURITY DEFINER` function `grant_subscription_cycle(...)` does, in a single transaction: upsert `payments` (idempotent on intent), insert `student_packages` grant (idempotent on `cycle_key`), and mark the cycle granted. EXECUTE **revoked from public/anon/authenticated, granted to service_role only** (NFR-002, per the documented SECDEF lockdown). Called by the webhook orchestrator via the service-role admin client.

**Rationale**: Eliminates the payment-without-grant / grant-without-payment window. Reuses the exact lockdown pattern from `deduct_package_session` / `confirm_booking_with_session`.

**Alternatives rejected**: Chained `supabase.from(...).insert()` calls — non-atomic, double-grant on retry; violates Principle III.

## R5 — Out-of-order events & mirror recency (resolves FR-017)

**Decision**: `subscriptions` carries a `last_event_at timestamptz` (Stripe event `created`). The mirror upsert applies an incoming event **only if** its event time `>=` stored `last_event_at`; older events are recorded in `billing_events` but **do not** mutate the mirror. Status derives from the most-recent authoritative event.

**Rationale**: Stripe is source of truth (FR-017); arrival order ≠ authority order. Prevents a late "active" retry from resurrecting a canceled subscription.

**Alternatives rejected**: Trust arrival order — regresses state; explicitly forbidden by FR-017.

## R6 — Customer mapping uniqueness (resolves FR-002, edge "duplicate customer")

**Decision**: `stripe_customers` has UNIQUE on both `user_id` and `stripe_customer_id`. Checkout creation **upserts** the mapping inside a transaction / `ON CONFLICT (user_id) DO NOTHING RETURNING`, then reads back — so concurrent checkout starts converge on one customer. If no row exists, create the Stripe customer then insert; the unique constraint is the race backstop.

**Rationale**: One user ↔ one Stripe customer is required for unambiguous charges/portal. DB constraint, not app logic, is the authority under concurrency.

## R7 — Dunning model (resolves FR-016, Story 3)

**Decision**: `subscriptions.status` enum includes `past_due`. `invoice.payment_failed` → set `past_due`, grant nothing, **do not** release seat, emit `subscription.past_due` event for alerting. Final cancellation only on `customer.subscription.deleted` (Stripe after retries exhausted) → emit `subscription.canceled` for downstream seat-release (handled in later specs). Seat-release is **event emission only** here.

**Rationale**: Learner-continuity lens — never silently drop a child mid-memorization. Stripe owns the retry schedule (FR-016).

## R8 — USD-only enforcement (resolves FR-008)

**Decision**: Reject non-USD at two points: (1) plan-catalog rows constrained to `currency = 'usd'` (CHECK); (2) webhook handler asserts invoice currency is USD before grant, else record event + raise loudly (no grant). Amounts stored in integer cents to match Stripe.

## R9 — Stripe SDK addition (resolves dependency gap)

**Decision**: Add `stripe` (Node SDK) as a dependency; init a server-only singleton in `src/lib/stripe/client.ts` reading `STRIPE_SECRET_KEY` from env (never `NEXT_PUBLIC_*`). Pin API version explicitly. Add `STRIPE_SECRET_KEY` + `STRIPE_WEBHOOK_SECRET` to the CLAUDE.md env-var table in the same PR (constitution: secrets/env pairing).

**Alternatives rejected**: Raw `fetch` to Stripe REST — loses typed events and `constructEvent`; rejected.

## R10 — Test/live mode switch (resolves FR-019)

**Decision**: Mode is **purely env-driven** (`STRIPE_SECRET_KEY` test vs live, matching `STRIPE_WEBHOOK_SECRET`). No `if (test)` branches in code. Go-live = swap Vercel env + Stripe dashboard portal/price config. Local dev uses `stripe listen --forward-to` for webhook secret.

## Open items carried to tasks

- ADR-0005 authored & committed in the implementation PR (gate I condition).
- Confirm canary Next.js raw-body API for the webhook route handler before coding (R2 caveat).
- One seed `subscription_plans` test row created to exercise E2E (spec assumption).
