# Contract: Customer Portal

**Route**: `POST /api/stripe/portal` — new.
**Auth** (Principle IV): `requireRole`; user from session (FR-011).

## Behavior

1. Authenticate → `userId`.
2. Look up `stripe_customers` for `userId`. If absent → 404 (no billing relationship).
3. Create Stripe Billing Portal session scoped to that `stripe_customer_id` with `return_url`.
4. Return `{ url }`.

## Response

`200 { "url": "https://billing.stripe.com/..." }` · `401` unauthenticated · `404` no customer · `500` loud.

## Invariants

- Portal session is scoped **strictly** to the requester's own `stripe_customer_id` (SC-007) — never another user's.
- Cancellations/payment-method changes made in the portal flow back via `customer.subscription.updated/deleted` webhooks (see webhook.contract.md), not handled synchronously here.
