# Contract: Checkout (subscription mode)

**Route**: `POST /api/stripe/checkout` — replaces the current 501 stub.
**Auth** (Principle IV): `requireRole` at the adapter; student identity from session, **never** request input (FR-010).

## Request (zod-validated)

```jsonc
{ "planCode": "string" }   // resolves to subscription_plans row; price comes from the catalog, not the client
```

Reject (400) if `planCode` unknown / inactive, or plan currency ≠ usd.

## Behavior

1. Authenticate → `userId` from session.
2. Resolve/create `stripe_customers` mapping for `userId` (upsert, race-safe per R6) → `stripe_customer_id`.
3. Look up `subscription_plans` by `planCode` → `stripe_price_id`.
4. Create Stripe Checkout Session: `mode: 'subscription'`, `customer`, `line_items:[{price, quantity:1}]`, `success_url`/`cancel_url`, `client_reference_id: userId`, `metadata.student_id = userId`.
5. Return `{ url }` for client redirect.

## Response

`200 { "url": "https://checkout.stripe.com/..." }` · `400` validation · `401` unauthenticated · `500` loud failure (logError).

## Invariants

- No grant happens here — the grant is webhook-driven (FR/edge: webhook may precede redirect).
- Price/credit count are read from the catalog, never trusted from the client.
- Server-only Stripe secret; nothing leaks to client beyond the hosted `url`.
