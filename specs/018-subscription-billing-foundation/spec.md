# Feature Specification: Subscription Billing Foundation (Schema + Stripe Subscriptions)

**Feature Branch**: `018-subscription-billing-foundation`
**Created**: 2026-06-16
**Status**: Draft
**Phase**: م٠ (data design) + م١ (Stripe Subscriptions foundation) of the Subscription + Courses Pivot
**Plan**: `/home/drdeeb/.claude/plans/you-are-acting-as-shimmering-cray.md`
**Input**: Build the database schema for recurring subscriptions plus the Stripe Subscriptions integration (products/prices, Checkout, Customer Portal, webhooks for `invoice.paid` and `customer.subscription.*`, dunning, and idempotent monthly credit grants), reusing the platform's existing payment, package, and credit-debit infrastructure.

---

## Context & Scope

The platform currently bills per session (one-time packages). The approved pivot replaces this with **monthly recurring subscriptions** (and limited-duration course subscriptions). Stripe today is a **501 stub** (`src/app/api/stripe/checkout/route.ts`, `src/app/api/stripe/webhook/route.ts`); the fulfillment layer (`src/lib/stripe/fulfillment.ts`) is wired but only knows one-time package purchases.

This spec establishes the **billing rails only**: the subscription data model and a secure, idempotent Stripe Subscriptions integration that grants monthly session credits into the **existing** `student_packages` debit kernel. It is the governing dependency for all later phases.

**In scope:** subscription/customer/plan/billing-event tables + RLS; Stripe products/prices catalog mirror; Checkout for subscriptions; Customer Portal; webhook ingestion with signature verification + replay-safe idempotency; dunning state tracking; idempotent grant-on-payment into `student_packages`.

**Explicitly out of scope (owned by later specs):**
- Pricing catalog semantics, the 6 tiers, single-active-hifz rule, family discounts, proration → **spec 019** (م٢).
- Teacher assignment, availability, cohorts/halaqas → **spec 020** (م٣).
- Attendance, excuses, payroll → **spec 021** (م٤).
- Assessment / instant / specialized single sessions → **spec 022** (م٥).
- Reports, gamification, notification *content/channels* → **spec 023** (م٦); this spec only **emits** billing events for them to consume.
- Existing-user migration & cutover → **spec 024** (م٧).

**Three lenses** (per AGENTS.md §1):
- 🛠 **Engineer**: reuse the hardened debit kernel and webhook-verification patterns; never duplicate financial logic; service-role-only writes; fail-closed.
- 📖 **Quran teacher**: billing must never block or corrupt a learner's memorization continuity; a grant is "the right to be taught," tracked exactly.
- 🎓 **Platform expert**: a parent must understand what they are paying for and when it renews; failed payment must degrade gracefully, never silently drop a child mid-program.

---

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Subscribe to a monthly memorization package (Priority: P1)

A guardian (or adult student) selects a monthly memorization package and pays through a hosted checkout. On successful first payment, the student immediately receives that month's session credits and an active subscription.

**Why this priority**: Without this, there is no recurring revenue and no monthly credit grant — it is the core of the entire pivot. It is the minimum viable billing slice.

**Independent Test**: In Stripe test mode, complete checkout for a monthly plan; verify an active subscription row exists, a billing event is recorded, and exactly one `student_packages` grant with the plan's monthly credit count appears — with no double-grant on webhook retry.

**Acceptance Scenarios**:

1. **Given** a student with no active subscription, **When** they complete Stripe Checkout for a monthly plan, **Then** an active subscription is recorded, this month's credits are granted once, and a receipt/invoice is available.
2. **Given** a successful checkout, **When** Stripe re-delivers the same `invoice.paid` event (retry), **Then** the system recognizes the duplicate and grants **no** additional credits.
3. **Given** a payment that Stripe reports as failed at checkout, **When** the webhook arrives, **Then** no subscription is activated and no credits are granted.

---

### User Story 2 - Automatic monthly renewal grants next month's credits (Priority: P1)

While a subscription stays active, Stripe charges the saved payment method each billing cycle. Each successful renewal payment grants the next month's credits automatically.

**Why this priority**: Recurring grants are the defining behavior of "subscription"; a one-time grant alone is just a package. Equal P1 with Story 1.

**Independent Test**: In test mode, advance a test clock one billing cycle; verify the renewal `invoice.paid` produces exactly one new monthly grant tied to the same subscription, idempotent on retry.

**Acceptance Scenarios**:

1. **Given** an active subscription, **When** a renewal invoice is paid, **Then** exactly one new monthly credit grant is created for that cycle.
2. **Given** a renewal grant, **When** the prior month's credits were unused, **Then** the new grant is **merged/added, never overwritten or silently reset** (entitlements are additive per AGENTS.md §4).
3. **Given** two webhook deliveries for the same renewal invoice, **When** both are processed, **Then** only one grant results.

---

### User Story 3 - Failed payment enters dunning, not silent cancellation (Priority: P1)

When a renewal charge fails, the subscription enters a grace/dunning state with retries and pre-suspension alerts, rather than abruptly cutting the student off.

**Why this priority**: A child being silently dropped mid-memorization is the worst-case learner harm and a top support/churn driver. Security/financial-correctness and learner-continuity lens both make this P1.

**Independent Test**: In test mode force a renewal payment failure; verify the subscription transitions to a past-due/dunning state, **no** new credits are granted, the seat is **not** immediately released, and a billing event suitable for an alert is emitted.

**Acceptance Scenarios**:

1. **Given** an active subscription, **When** a renewal charge fails, **Then** the subscription is marked past-due/dunning and no new credits are granted.
2. **Given** a subscription in dunning, **When** Stripe's retry later succeeds, **Then** the subscription returns to active and the (now-paid) cycle's credits are granted once.
3. **Given** a subscription in dunning, **When** all retries are exhausted, **Then** the subscription is canceled at the period end and a cancellation billing event is emitted for downstream seat-release handling.

---

### User Story 4 - Manage billing via Customer Portal (Priority: P2)

A subscriber can open a secure portal to update their payment method, view invoices, and cancel — without contacting support.

**Why this priority**: Self-service reduces support load and is expected of any subscription product, but the product is viable before it (admins can assist). P2.

**Independent Test**: Generate a portal session for a test customer; confirm they can reach payment-method update and invoice history scoped to their own customer only.

**Acceptance Scenarios**:

1. **Given** an authenticated subscriber, **When** they request the billing portal, **Then** they are sent to a Stripe-hosted session scoped strictly to their own customer record.
2. **Given** a subscriber cancels in the portal, **When** the `customer.subscription.updated/deleted` webhook arrives, **Then** the local subscription reflects the cancellation/period-end and emits an event for seat-release.

---

### User Story 5 - Admin/Stripe state stays mirrored and auditable (Priority: P2)

Admins can see each subscription's current status, plan, current period, and the billing-event history, with local state reconcilable against Stripe as the source of truth.

**Why this priority**: Operability and dispute resolution; needed before cutover but not before the first test-mode transaction. P2.

**Independent Test**: Trigger a sequence of subscription lifecycle webhooks; verify each is recorded once in the billing-event ledger and the subscription's mirrored status matches the last authoritative Stripe event.

**Acceptance Scenarios**:

1. **Given** any processed subscription webhook, **When** an admin inspects the subscription, **Then** they see status, plan, current period bounds, and the ordered billing-event history.
2. **Given** an out-of-order webhook delivery, **When** an older event arrives after a newer one, **Then** the mirror does not regress to stale state.

---

### Edge Cases

- **Webhook before Checkout redirect**: `invoice.paid` may arrive before the browser returns from Checkout. Grant must be driven by the webhook, not the redirect; the redirect is cosmetic.
- **Unsigned / forged webhook**: any request failing Stripe signature verification is rejected before any DB read/write (fail-closed); a forged payload must never grant credits. (Directly fixes the documented risk that a live stub without verification would grant free packages.)
- **Duplicate Stripe customer for one user**: a user must map to exactly one Stripe customer; concurrent checkout starts must not create two customers.
- **Plan/price drift**: a Stripe price changed or archived in the dashboard must not silently change what a learner receives; the local plan mirror is the binding catalog and changes are explicit.
- **Grant when student linkage is ambiguous** (guardian paying for a child): the grant must resolve to the correct student deterministically or fail loudly — never grant to the wrong student.
- **Out-of-order subscription events**: cancellation followed by a late "active" retry, or vice versa, must resolve by Stripe event recency, not arrival order.
- **Partial refund / chargeback** on an invoice: must be recorded and must not leave granted-but-unpaid credits unaccounted (full revoke semantics deferred to 019, but the event must be captured here).
- **Currency**: all amounts are USD only in this phase; non-USD prices are rejected.

---

## Requirements *(mandatory)*

### Functional Requirements — Schema & Data (م٠)

- **FR-001**: System MUST persist a **subscription** record mirroring each Stripe subscription, including: owning student, plan reference, lifecycle status (e.g., active, past-due/dunning, canceled, incomplete), current period start/end, cancel-at-period-end flag, and the Stripe subscription identifier (unique).
- **FR-002**: System MUST persist a **customer mapping** linking exactly one platform user to exactly one Stripe customer identifier (unique on both the user and the customer id), so charges and portal sessions are unambiguous.
- **FR-003**: System MUST persist a **subscription-plan catalog** that mirrors Stripe products/prices, recording: plan code/name, billing type (recurring monthly vs limited-duration recurring), the **monthly credit count** to grant, session type/duration metadata sufficient to size a grant, USD price, active flag, and the Stripe product/price identifiers. The local catalog is the binding source for what a payment grants. *(Catalog semantics and the specific tiers are detailed in spec 019; this spec defines the table and its role.)*
- **FR-004**: System MUST persist a **billing-event ledger** recording every ingested Stripe event with the Stripe event id under a **unique** constraint (replay/idempotency key), event type, related subscription/customer, processing status, and raw payload for audit. A repeated event id MUST be a no-op.
- **FR-005**: System MUST grant monthly credits by creating rows in the **existing** `student_packages` model (reusing `sessions_total`, `sessions_used`, `status`, `expires_at`), tying each grant to its originating subscription and billing cycle so a cycle is granted at most once.
- **FR-006**: Every new table MUST ship Row Level Security enabled with policies **in the same migration**: a student may read only their own subscription/customer/grant rows; the plan catalog is readable by authenticated users; the billing-event ledger is readable by admins only; **all writes are service-role only** (no authenticated INSERT/UPDATE/DELETE on billing tables).
- **FR-007**: Financial/identity columns on the new subscription and grant linkage MUST be protected from client mutation following the existing `BEFORE UPDATE OF` guard pattern (service-role and migrations exempt; admins via own session permitted), so a learner cannot alter what they are entitled to.
- **FR-008**: All monetary amounts MUST be USD and validated; non-USD inputs MUST be rejected.
- **FR-009**: Regenerated database types MUST be produced for the new tables (`npm run db:types`) and the build/typecheck MUST pass.

### Functional Requirements — Stripe Integration (م١)

- **FR-010**: System MUST create Stripe **Checkout** sessions in subscription mode for a selected plan, associating the session with the authenticated user's customer mapping (creating the mapping if absent, exactly once). The student identity MUST come from the authenticated session, never from request input.
- **FR-011**: System MUST expose a **Customer Portal** entry that returns a Stripe-hosted session scoped strictly to the requesting user's own customer record.
- **FR-012**: System MUST ingest Stripe **webhooks** and verify each event's signature against the webhook signing secret **before** any database read or write; any event that fails verification MUST be rejected (fail-closed) with no side effects.
- **FR-013**: System MUST handle at minimum these webhook events: `invoice.paid` (grant the cycle's credits + record payment), `invoice.payment_failed` (enter dunning), `customer.subscription.created/updated/deleted` (mirror lifecycle, including cancel-at-period-end and cancellation). Unhandled event types MUST be acknowledged and recorded without error.
- **FR-014**: Credit grants triggered by webhooks MUST be **idempotent**: the unique Stripe event id (and/or invoice+cycle key) guarantees that retried or duplicate deliveries grant credits at most once. The system MUST reuse the existing idempotency-ledger pattern (`automation_logs.idempotency_key` unique, or an equivalent unique key on the billing-event ledger).
- **FR-015**: On `invoice.paid`, the system MUST record a payment in the existing `payments` model (reusing `stripe_payment_intent` uniqueness / provider fields) and grant credits **atomically with** recording the cycle as granted, so a payment without a grant — or a grant without a recorded payment — cannot occur.
- **FR-016**: On `invoice.payment_failed`, the system MUST mark the subscription past-due/dunning, grant **no** credits, **not** immediately release the learner's seat, and emit a billing event suitable for a pre-suspension alert. Final cancellation occurs only after Stripe exhausts its configured retries.
- **FR-017**: The integration MUST treat **Stripe as the source of truth** and resolve out-of-order deliveries by event recency, never regressing the local mirror to older state.
- **FR-018**: Secrets (`STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`) MUST be server-only, read from environment, never exposed to the client, `NEXT_PUBLIC_*`, or logs; the service-role key remains server-only.
- **FR-019**: The system MUST operate against Stripe **test mode** until go-live, switching to live keys by configuration only (no code change), per the plan's implementation decision.
- **FR-020**: Webhook handling MUST return appropriate non-2xx on internal failure so Stripe retries, but MUST return 2xx for successfully recorded duplicates (so retries stop). Transient downstream failures MUST be retry-safe given the idempotency guarantees.

### Non-Functional / Security Requirements

- **NFR-001**: No financial side effect may occur on any code path before webhook signature verification succeeds.
- **NFR-002**: SECURITY DEFINER grant functions MUST follow the established EXECUTE lockdown (revoke from `public`/`anon`/`authenticated`; grant to `service_role` only).
- **NFR-003**: Any migration with money/grant logic MUST be verified locally in Postgres by simulating grant + renewal + duplicate-delivery over multiple cycles before being considered done; `sb:advisors` MUST be clean for the new tables.
- **NFR-004**: The full check suite MUST pass: `tsc --noEmit`, `lint`, `test:unit`; critical billing flows covered by unit/integration tests including the idempotency and fail-closed paths.

### Key Entities *(data involved)*

- **Subscription**: a learner's recurring entitlement mirrored from Stripe — owner (student), plan, status, current period, cancel-at-period-end, Stripe subscription id. Relationships: belongs to a student (profiles), references a subscription plan, originates many monthly grants and billing events.
- **Stripe Customer Mapping**: one-to-one user↔Stripe customer link enabling charges and portal sessions.
- **Subscription Plan (catalog mirror)**: binding definition of what a paid cycle grants — billing type, monthly credit count, session metadata, USD price, active flag, Stripe product/price ids. (Tier specifics → spec 019.)
- **Billing Event (ledger)**: every ingested Stripe event, keyed uniquely by Stripe event id for replay safety; carries status, type, payload, and links.
- **Monthly Credit Grant**: a `student_packages` row created per paid cycle (reused existing entity), tied to its subscription + cycle so it grants once.
- **Payment** (reused): existing `payments` record for each paid invoice.

---

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: A new subscriber completing checkout receives their first month's credits and an active subscription with **zero** manual intervention, every time, in test mode.
- **SC-002**: Replaying any billing webhook (duplicate delivery) results in **0** extra credit grants and **0** duplicate payments across **100%** of retries.
- **SC-003**: A forged or unsigned webhook produces **0** credit grants and **0** state changes — verified by an automated test.
- **SC-004**: A failed renewal never results in immediate loss of access; **100%** of payment-failure cases enter dunning with an alert event and retain the seat until retries are exhausted.
- **SC-005**: Every paid invoice corresponds to exactly one credit grant and exactly one recorded payment (no orphan grants, no orphan payments) — verifiable by reconciliation query.
- **SC-006**: Local subscription status matches Stripe's authoritative status for **100%** of subscriptions after a lifecycle event sequence, including out-of-order deliveries.
- **SC-007**: A subscriber can update their payment method and view invoices via self-service for **100%** of active subscriptions without support involvement.

---

## Assumptions

- **Reuses existing debit kernel**: grants land in `student_packages`; debit/restore continues through `deduct_package_session`, `start_instant_session_booking`, `confirm_booking_with_session` (fail-closed), and `restore_student_package` — unchanged by this spec.
- **Reuses existing payment ledger**: `payments` (with `stripe_payment_intent` uniqueness, `provider`, `status` enum) records invoice payments; `invoices` continues to provide receipts.
- **Reuses webhook-verification + idempotency patterns**: `src/lib/security/secrets.ts` (constant-time compare / HMAC) and `automation_logs.idempotency_key` uniqueness, or the Stripe SDK's own `constructEvent` for signature verification.
- **Reuses RLS/guard conventions**: `( select auth.uid() )` initplan policies, `private.is_admin()`, `platform_settings` for adjustable values, and the `BEFORE UPDATE OF` financial-column guard.
- **Migration topology**: new timestamped migrations land in `supabase/migrations/` after the `20260428000000_remote_baseline.sql` baseline; the baseline is never `db push`ed.
- **Coexistence during build**: subscriptions are developed in test mode alongside the still-live per-session booking system; the old path is retired only at cutover (spec 024). This spec does **not** remove or disable the existing one-time package/booking paths.
- **Plan catalog rows are created** for at least one test plan to exercise end-to-end flows; full tier definitions arrive in spec 019.
- **One student per subscription** in this phase; guardian/family multi-child billing relationships are detailed in spec 019 (this spec must not preclude a guardian-owned customer paying for a child).
- **Stripe is the source of truth**; the local mirror is reconcilable and may be rebuilt from Stripe + the billing-event ledger.
- **Adjustable financial values** (credit counts per plan, prices) are data (plan catalog / `platform_settings`), not hardcoded.

## Dependencies

- Stripe account in test mode with API keys, webhook signing secret, and Customer Portal configured.
- Stripe Node SDK added to the project (currently absent — the integration is a stub).
- Existing tables: `payments`, `invoices`, `student_packages`, `packages`, `profiles`, `automation_logs`, `platform_settings`.
- Existing code: `src/lib/stripe/fulfillment.ts`, `src/app/api/stripe/checkout/route.ts`, `src/app/api/stripe/webhook/route.ts`, `src/lib/supabase/admin.ts`, `src/lib/security/secrets.ts`, `src/lib/csp.ts` (Stripe domains already allowlisted).
- **Blocks**: specs 019–024 all depend on the subscription/plan/grant primitives defined here.
