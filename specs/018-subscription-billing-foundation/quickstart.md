# Quickstart — Subscription Billing Foundation (verify runbook)

How to exercise and verify this feature locally before "done". Order matters.

## 0. Prereqs

- Local Supabase stack up (`supabase start`) + full schema (`bash scripts/dev-local-db-bootstrap.sh`).
- Stripe **test mode** keys in `.env.local`: `STRIPE_SECRET_KEY=sk_test_...`, plus `STRIPE_WEBHOOK_SECRET` from `stripe listen`.
- `stripe` Node SDK installed (`npm i stripe`).

## 1. Apply migration + regen types

```bash
supabase migration up                  # applies <ts>_subscription_billing_foundation.sql
npm run db:types                       # regenerate src/types/supabase.generated.ts
npx tsc --noEmit && npm run lint       # MUST pass
npm run sb:advisors                    # MUST be clean for the 4 new tables
```

## 2. Local money-logic verification (NFR-003 — gate, do not skip)

In local Postgres, drive `grant_subscription_cycle(...)` directly:

1. Seed one `subscription_plans` test row + a `subscriptions` row.
2. Call with `cycle_key='c1'` → assert **1** `student_packages` grant, **1** `payments` row.
3. Call again with `cycle_key='c1'` → assert still **1** / **1** (idempotent).
4. Call with `cycle_key='c2'` (renewal) → assert **2** grants; first grant unchanged (additive).
5. Apply a stale `customer.subscription.updated` (older `event.created`) after a `deleted` → assert mirror stays `canceled` (R5).

## 3. Webhook forwarding

```bash
stripe listen --forward-to localhost:3000/api/stripe/webhook
```

## 4. End-to-end (Stripe test mode)

1. `POST /api/stripe/checkout {planCode}` as a logged-in student → open returned `url` → pay with `4242 4242 4242 4242`.
2. Assert: active `subscriptions` row, one `billing_events` row (`invoice.paid`), exactly one `student_packages` grant of `monthly_credit_count`, one `payments` row.
3. **Replay**: re-send the same event via Stripe CLI → assert **no** extra grant/payment (SC-002).
4. **Forged**: POST a body with a bad signature → assert `400`, **no** DB change (SC-003).
5. **Renewal**: advance the Stripe test clock one cycle → assert exactly one new grant.
6. **Failure**: force `invoice.payment_failed` → assert subscription `past_due`, no grant, seat retained, `subscription.past_due` emitted (SC-004).
7. **Portal**: `POST /api/stripe/portal` → assert hosted `url` scoped to own customer.

## 5. Tests

```bash
npm run test:unit      # billing idempotency, fail-closed, recency, USD-guard
npm test               # checkout→grant E2E (test mode)
```

## Done criteria

All of §1 green, §2 assertions pass, §4 SC checks pass, ADR-0005 committed, `STRIPE_*` env vars added to the CLAUDE.md table.
