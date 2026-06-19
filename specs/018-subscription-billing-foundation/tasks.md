# Tasks: Subscription Billing Foundation (Schema + Stripe Subscriptions)

**Feature**: `specs/018-subscription-billing-foundation` | **Branch**: `018-subscription-billing-foundation`
**Inputs**: plan.md, spec.md, research.md, data-model.md, contracts/, quickstart.md
**Tests**: included (NFR-004 mandates unit/integration coverage of idempotency + fail-closed paths).

**Conventions**: TS strict, no `any`. Migration is ONE timestamped file after the baseline. Service-role-only writes on billing tables. Secrets server-only. Money logic verified locally in Postgres before "done" (NFR-003). Run `npx tsc --noEmit`, `npm run lint`, `npm run test:unit` per task group.

---

## Phase 1: Setup

- [x] T001 Pre-work branch-hygiene checks (constitution): run `gh issue view`, `gh pr list`, `git log --grep=stripe`, `git log --diff-filter=D -- 'src/app/api/stripe/**'`; confirm on `018-subscription-billing-foundation` cut from main; open a **draft PR same day** with `Closes #<issue>`.
- [x] T002 Add Stripe Node SDK: `npm i stripe`; pin a Stripe API version. Verify `package.json`/lockfile updated.
- [x] T003 [P] Add `STRIPE_SECRET_KEY` and `STRIPE_WEBHOOK_SECRET` to the env-var table in `CLAUDE.md`/`AGENTS.md` (constitution: env/secret pairing) and to `.env.local` (test keys) — never `NEXT_PUBLIC_*`.
- [x] T004 [P] Author `docs/adr/0005-billing-subscription-domain.md` (Constitution gate I) + amend the Domains list in `CONTEXT.md`.
- [x] T005 Create server-only Stripe client singleton in `src/lib/stripe/client.ts` reading `STRIPE_SECRET_KEY` from env (throws if missing at startup).

---

## Phase 2: Foundational (BLOCKING — all stories depend on this)

- [x] T006 Create migration `supabase/migrations/<UTC ts>_subscription_billing_foundation.sql` with enums `subscription_status`, `billing_plan_type`, `billing_event_status` (per data-model.md).
- [x] T007 In the same migration, create tables `subscription_plans`, `stripe_customers`, `subscriptions`, `billing_events` with columns/constraints/indexes exactly per data-model.md (USD CHECK, dual UNIQUEs, `last_event_at`, btree indexes on RLS predicate cols).
- [x] T008 In the same migration, add `subscription_id uuid NULL REFERENCES subscriptions(id)` + `billing_cycle_key text NULL` to `student_packages`, with a UNIQUE partial index `WHERE billing_cycle_key IS NOT NULL` (per-cycle grant-once, FR-005/R3).
- [x] T009 In the same migration, enable RLS + policies on all 4 new tables per data-model.md (student reads own subscription/customer; plan catalog readable by authenticated; `billing_events` admin-only; ALL writes service-role only) — using `( select auth.uid() )` initplan pattern + `private.is_admin()`.
- [x] T010 In the same migration, add the `BEFORE UPDATE OF` financial/identity guard on `subscriptions` (lock `student_id, payer_user_id, plan_id, stripe_subscription_id, stripe_customer_id`; exempt service_role + null JWT + admin) per `private.guard_booking_identity_change()` pattern (FR-007).
- [x] T011 In the same migration, create `grant_subscription_cycle(...)` SECURITY DEFINER per contracts/grant-function.contract.md, with `REVOKE ... FROM public, anon, authenticated; GRANT EXECUTE ... TO service_role` (NFR-002).
- [x] T012 Apply migration locally (`supabase migration up`); run `npm run db:types`; ensure `npx tsc --noEmit` passes with new types in `src/types/supabase.generated.ts` (FR-009).
- [x] T013 Run `npm run sb:advisors`; resolve any RLS/index/SECDEF-view warning for the 4 new tables until clean (NFR-003).
- [x] T014 **Local money-logic verification** (NFR-003 gate): in local Postgres drive `grant_subscription_cycle` per quickstart.md §2 — assert grant-once on duplicate `cycle_key`, additive on renewal, mirror-recency on out-of-order. Record results in the PR.
- [x] T015 Add canonical billing event names enum in `src/lib/domains/billing/events.ts` (`subscription.activated`, `subscription.renewed`, `subscription.past_due`, `subscription.canceled`) and register in `WEBHOOK_ROUTES`/`FurqanEvent` (`src/lib/automation/emit.ts`) — typed names only (AGENTS.md §4).
- [x] T016 Scaffold `src/lib/domains/billing/`: `plans.ts` (catalog reads), `subscriptions.ts` (recency-guarded mirror upsert, R5), `orchestrate.ts` (grant choreography calling the SECDEF fn via `src/lib/supabase/admin.ts`).

**Checkpoint**: schema live, types green, advisors clean, grant fn locally proven. Stories can proceed.

---

## Phase 3: User Story 1 — Subscribe to a monthly package (P1) 🎯 MVP

**Goal**: New subscriber completes checkout → active subscription + first month's credits, granted once.
**Independent test**: quickstart.md §4.1–4.4 (checkout pays, one grant, replay no-op, forged rejected).

- [x] T017 [P] [US1] Unit test: `grant_subscription_cycle` idempotency + additive renewal (Vitest, against local PG or a thin wrapper) in `tests/unit/billing/grant-idempotency.test.ts`.
- [x] T018 [P] [US1] Unit test: webhook signature fail-closed — forged/unsigned → 400, zero side effects — in `tests/unit/billing/webhook-failclosed.test.ts`.
- [x] T019 [US1] Implement `POST /api/stripe/checkout` per contracts/checkout.contract.md: `requireRole`, zod `{planCode}`, resolve/create `stripe_customers` (race-safe upsert, R6), subscription-mode Checkout, return `{url}`. Replace the 501 stub in `src/app/api/stripe/checkout/route.ts`.
- [x] T020 [US1] Implement webhook verification gate + `billing_events` insert (idempotency) in `src/app/api/stripe/webhook/route.ts` per contracts/webhook.contract.md (raw body, `constructEvent`, fail-closed 400, unique-violation → 200 no-op). Confirm canary Next.js raw-body API first (research R2).
- [x] T021 [US1] Implement `invoice.paid` handler: assert USD, resolve subscription+plan, call `grant_subscription_cycle` via orchestrator, record payment atomically, mark event `processed`, emit `subscription.activated`. (FR-013/FR-015)
- [x] T022 [US1] Implement `customer.subscription.created` mirror upsert (recency-guarded) in `subscriptions.ts`.
- [x] T023 [US1] E2E (Stripe test mode): checkout → pay `4242…` → assert active subscription, 1 billing_event, 1 grant of `monthly_credit_count`, 1 payment; replay event → no extra grant; forged sig → 400 (quickstart §4). In `tests/e2e/`.

**Checkpoint**: MVP — recurring revenue + first-cycle grant working and idempotent.

---

## Phase 4: User Story 2 — Automatic monthly renewal (P1)

**Goal**: Each renewal `invoice.paid` grants exactly one new cycle, additive, idempotent.
**Independent test**: quickstart §4.5 (advance test clock → exactly one new grant; prior credits retained).

- [x] T024 [P] [US2] Unit test: renewal produces a new grant with distinct `cycle_key`; prior-month unused credits untouched (additive, AGENTS.md §4) in `tests/unit/billing/renewal-additive.test.ts`.
- [x] T025 [US2] Ensure the `invoice.paid` handler distinguishes first-cycle vs renewal purely by `cycle_key` (invoice id + sub id + period start) — no separate code path; emit `subscription.renewed` on renewal.
- [x] T026 [US2] E2E: advance Stripe test clock one cycle → assert exactly one new grant tied to same subscription; duplicate renewal delivery → still one (quickstart §4.5).

---

## Phase 5: User Story 3 — Failed payment → dunning (P1)

**Goal**: Renewal failure → `past_due`, no grant, seat retained, alert event; recovery re-grants once; exhausted retries → cancel.
**Independent test**: quickstart §4.6.

- [x] T027 [P] [US3] Unit test: `invoice.payment_failed` → status `past_due`, zero grants, no seat release, `subscription.past_due` emitted, in `tests/unit/billing/dunning.test.ts`.
- [x] T028 [US3] Implement `invoice.payment_failed` handler: set `past_due` (recency-guarded), grant nothing, emit `subscription.past_due` (FR-016).
- [x] T029 [US3] Implement `customer.subscription.deleted` handler: mark `canceled`, set `canceled_at` (recency-guarded), emit `subscription.canceled` for downstream seat-release (FR-013).
- [x] T030 [US3] Verify recovery: a later successful retry `invoice.paid` returns subscription to `active` and grants that cycle once (covered by T021 idempotency + T028 transition).
- [x] T031 [US3] E2E: force `invoice.payment_failed` → assert `past_due`, no grant, seat retained, alert event emitted (quickstart §4.6).

---

## Phase 6: User Story 4 — Customer Portal (P2)

**Goal**: Subscriber self-serves payment method / invoices / cancel, scoped to own customer.
**Independent test**: quickstart §4.7.

- [x] T032 [US4] Implement `POST /api/stripe/portal` per contracts/portal.contract.md: `requireRole`, look up own `stripe_customers` (404 if none), create portal session scoped to that customer, return `{url}`. New file `src/app/api/stripe/portal/route.ts`.
- [x] T033 [US4] Implement `customer.subscription.updated` cancel-at-period-end mirroring (recency-guarded); ensure portal-driven cancel flows back via webhook (emit lifecycle event).
- [x] T034 [P] [US4] E2E/integration: generate portal session for a test customer → assert it reaches payment-method/invoice history scoped strictly to own customer (SC-007).

---

## Phase 7: User Story 5 — Admin/Stripe mirror & audit (P2)

**Goal**: Admin sees status/plan/period + ordered billing-event history; mirror never regresses on out-of-order delivery.
**Independent test**: quickstart §2.5 + admin read.

- [x] T035 [P] [US5] Unit test: out-of-order delivery (stale `updated` after `deleted`) leaves mirror `canceled` (recency guard, R5) in `tests/unit/billing/recency.test.ts`.
- [x] T036 [US5] Admin read surface: a server-side query/view exposing per-subscription status, plan, current period, and ordered `billing_events` (admin-only via RLS) — minimal read path, no new write surface.
- [x] T037 [US5] Reconciliation query (SC-005): every paid invoice ↔ exactly one grant ↔ exactly one payment; document the query in the PR for ops.

---

## Phase 8: Polish & Cross-Cutting

- [x] T038 [P] Seed one `subscription_plans` test row (migration seed or script) so E2E is runnable (spec assumption).
- [x] T039 Confirm CSP already allows Stripe domains (`src/lib/csp.ts`); no secret leaks in logs/headers; secrets server-only audit.
- [x] T040 Full gate: `npx tsc --noEmit`, `npm run lint`, `npm run test:unit`, `npm run sb:advisors` all green; `npm test` (E2E) green in test mode.
- [x] T041 Update PR body: test plan, the §2/§4 verification results, ADR-0005 link, `Closes #<issue>`; move PR from draft → ready.

---

## Dependencies & Execution Order

- **Setup (P1)** → **Foundational (P2)** block everything. T006–T011 are one migration (sequential, same file). T012–T014 gate on it.
- **US1 (P3)** is the MVP and unblocks US2/US3 (they extend the same webhook handlers). US1 → US2 → US3 share `invoice.paid`/lifecycle code, so sequence them.
- **US4 (P6)** and **US5 (P7)** are independent of each other and depend only on Foundational + US1's webhook scaffolding; can run in parallel after US1.
- **Polish (P8)** last.

## Parallel Opportunities

- T003, T004 (docs/ADR) parallel with T002/T005.
- Unit tests T017, T018, T024, T027, T035 are `[P]` (distinct files).
- After US1: US4 and US5 phases can proceed concurrently.

## Implementation Strategy

**MVP = Phase 1 + Phase 2 + Phase 3 (US1).** That delivers idempotent subscribe-and-grant with fail-closed webhooks — the core of the pivot. Layer US2 (renewal), US3 (dunning), then US4/US5. Do not start US-phases until T014 (local money verification) passes.

## Notes for the Builder (OpenCode, per AGENTS.md)

- `gitnexus_impact` before editing `fulfillment.ts`, the stripe routes, or `emit.ts`.
- Never write `student_packages` directly from a route — only via `grant_subscription_cycle` (service-role).
- Stop and list any deviation; do not expand scope into specs 019–024.
