# Contract: Webhook ingestion

**Route**: `POST /api/stripe/webhook` — replaces the 501 stub.
**Auth**: Stripe **signature** only (no user session). Fail-closed (FR-012, NFR-001).

## Gate (before any DB read/write)

1. Read **raw** body (`await req.text()` — confirm canary Next.js raw-body access per research R2).
2. `event = stripe.webhooks.constructEvent(rawBody, sigHeader, STRIPE_WEBHOOK_SECRET)`.
3. On throw → `400`, **zero** side effects (no DB, no grant).

## Idempotency

4. INSERT `billing_events` (`stripe_event_id` UNIQUE, status `received`, raw payload). On unique violation → already processed → `200` no-op (FR-004/FR-020).

## Dispatch (recency-guarded mirror, R5)

| Event | Action |
|---|---|
| `invoice.paid` | Assert currency usd; resolve subscription + plan; call `grant_subscription_cycle(...)` (atomic payment+grant, idempotent on `cycle_key`); set event `processed`; emit `subscription.renewed`/`subscription.activated`. |
| `invoice.payment_failed` | Set subscription `past_due`; **grant nothing**; **do not** release seat; emit `subscription.past_due`. (FR-016) |
| `customer.subscription.created/updated` | Upsert mirror **only if** `event.created >= subscriptions.last_event_at`; set period/cancel_at_period_end/status; emit lifecycle event. |
| `customer.subscription.deleted` | Mark `canceled` (recency-guarded); set `canceled_at`; emit `subscription.canceled` for downstream seat-release. |
| other | Record + `200`, status `ignored` (FR-013). |

## Response semantics (FR-020)

- `200` success **or** recognized duplicate (so Stripe stops retrying).
- `400` signature failure.
- `5xx` only on internal/transient failure so Stripe retries (idempotency makes retry safe).

## Invariants

- No financial side effect before step 3 succeeds (NFR-001).
- Grant is service-role-only via the SECDEF function; the route never writes `student_packages` directly.
- `emitEvent` runs post-commit, non-blocking (Principle III).
