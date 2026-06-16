# Feature Specification: Onboarding (Assessment Session) + Per-Session-Paid Single Sessions

**Feature Branch**: `022-onboarding-single-sessions`
**Created**: 2026-06-16
**Status**: Draft
**Phase**: م٥ (Onboarding + single sessions) of the Subscription + Courses Pivot
**Plan**: `/home/drdeeb/.claude/plans/you-are-acting-as-shimmering-cray.md`
**Input**: Add an optional, nominally-paid **assessment/level session** that a student may take before subscribing (conducted by a specialist teacher matched to the requested specialty), and make **single one-off sessions** — the existing **instant session** plus new **specialized on-demand sessions** (review/مراجعة, consolidating a surah, memorizing specific mutoon, testing on certain juz/mutashabihat) — available as standalone products **paid per session via a Stripe one-time charge**, never debited from a subscription's monthly credits.

---

## Context & Scope

The subscription pivot (specs 018–021) replaces per-session billing with monthly subscriptions. But three real needs survive outside the subscription:

1. **Onboarding (assessment, decision #14/#19/#23):** a prospective student often does not know which package/level fits them. Before subscribing they MAY book one **assessment session** with a **specialist teacher** for the specialty they are interested in, to determine their level and the suitable package. The assessment is **optional** — a student can subscribe directly without it — and **nominally priced** (configurable; possibly free, set later).
2. **Instant sessions (decision #13):** the existing "book a session right now" product REMAINS available, but in the new world it is paid as its **own one-time payment per session**, not drawn from subscription credits.
3. **Specialized on-demand single sessions (product (d), decision #22):** a one-off session for a specific purpose — مراجعة (review), consolidating a specific surah, memorizing specific mutoon, or being tested on certain juz/mutashabihat — also paid **per session** as a one-time payment.

**The defining distinction of this phase:** these three products are **per-session paid via a Stripe one-time charge (Checkout in *payment* mode)** and recorded in the existing `payments` ledger. They **MUST NOT** consume subscription monthly credits and **MUST NOT** debit `student_packages`. They are modeled as **paid bookings**, not package debits.

**In scope:** a product/price concept for assessment + specialized single sessions (configurable prices); the booking + payment flow that charges a one-time Stripe payment and, only on confirmed payment, materializes the session; specialist-teacher matching for the assessment by requested specialty; data/RLS for any new rows; reuse of the existing instant-session atomic path adapted so its charge is a one-time payment rather than a package debit.

**Explicitly out of scope (owned by other specs):**
- Stripe **subscription**-mode rails (subscription Checkout, subscription webhooks, `grant_subscription_cycle`, `billing_events` idempotency ledger) → **spec 018** (م١). Spec 018 owns subscription-mode only. **This spec (022) owns** the Stripe **payment**-mode Checkout route, the `payment_intent.succeeded` webhook handler, and the `payments.booking_id` migration — these are Phase 0 of this spec's plan, not a reuse of spec 018 infrastructure.
- Subscription catalog, the 6 tiers, monthly credit grants, single-active-hifz rule, family discounts → **spec 019** (م٢). Single sessions here never touch those credits.
- Teacher assignment for subscriptions, availability, cohorts/halaqas → **spec 020** (م٣). The assessment's **specialist matching** references 020's assignment/availability primitives; it does not redefine scheduling.
- Attendance, excuses, payroll, teacher actual-hours → **spec 021** (م٤). A single session's attendance/payroll handling is inherited, not redefined here.
- Notification content/channels (in-app, email, WhatsApp via n8n) → **spec 023** (م٦). This spec only **emits** the events those notifications consume.
- Existing-user migration & cutover → **spec 024** (م٧).

**Three lenses** (per AGENTS.md §1):
- 🛠 **Engineer**: reuse `start_instant_session_booking` and the `payments` ledger; the one-time charge must be confirmed **before** a session exists (fail-closed); never debit `student_packages`; service-role-only financial writes; prices are data, never hardcoded.
- 📖 **Quran teacher**: an assessment must be conducted by a teacher whose **specialty matches** the student's interest (a hifz assessor for hifz, a tajweed assessor for tajweed), so the level judgment is sound; specialized sessions (مراجعة, mutoon, mutashabihat testing) carry an exact, named scope.
- 🎓 **Platform expert**: a newcomer must be able to "try before they commit" cheaply; a subscriber or non-subscriber must be able to buy a one-off session for a specific need without misunderstanding it as part of their plan; pricing and whether the assessment is free must be controllable by admins.

---

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Book an optional assessment session before subscribing (Priority: P1)

A prospective student who is unsure of their level books an **assessment session** for the specialty they care about (e.g. hifz, tajweed). The system charges the configured assessment price as a **one-time payment** (which may be zero/free if configured), assigns a **specialist** teacher matching that specialty, and only then creates the session. After the assessment the student can subscribe to a recommended package — or walk away.

**Why this priority**: This is the onboarding funnel's first touch and the headline new capability of م٥; without it the "assess before you commit" promise (decisions #14/#19/#23) does not exist. It is the minimum viable slice of this phase.

**Independent Test**: As a non-subscribed student, request an assessment for a given specialty; with the assessment price set to a non-zero amount, verify a one-time payment is required and on success exactly one assessment session is created with a specialist teacher of that specialty, no `student_packages` row is created or debited, and a payment row is recorded; with the price set to zero, verify the session is created with no charge.

**Acceptance Scenarios**:

1. **Given** a student with no subscription and a configured non-zero assessment price, **When** they complete the one-time payment for an assessment in a chosen specialty, **Then** exactly one assessment session is created, assigned to a teacher whose specialties include that specialty, and a `payments` row records the one-time charge — with **no** `student_packages` debit.
2. **Given** the assessment price is configured to **zero/free**, **When** a student requests an assessment, **Then** the session is created with no payment required (or a zero-amount record), still assigned to a matching specialist.
3. **Given** a student abandons the one-time payment, **When** the payment is not confirmed, **Then** **no** assessment session is created (fail-closed).
4. **Given** the assessment is optional, **When** a student chooses to subscribe directly without an assessment, **Then** subscription is allowed with no assessment prerequisite.

---

### User Story 2 - Buy an instant session as a standalone one-time payment (Priority: P1)

A student wants a session right now. They pay for it as a **separate one-time charge per session** (not from any subscription credit), and the existing instant-session booking flow creates the session atomically once payment is confirmed.

**Why this priority**: The instant session is an existing, used product (decision #13) that must keep working in the new model; reusing the hardened atomic path while switching its funding source from a package debit to a one-time payment is core to this phase. Equal P1 with Story 1.

**Independent Test**: As a student (subscribed or not), buy an instant session; verify the configured instant price is charged once via the one-time payment path, the session is created via the existing instant-session atomic function, the `payments` ledger has exactly one matching row, and **no** monthly subscription credit / `student_packages` balance is consumed.

**Acceptance Scenarios**:

1. **Given** a student requesting an instant session, **When** the one-time instant-session payment succeeds, **Then** the session is created exactly once and a single `payments` row is recorded, with no `student_packages` debit.
2. **Given** the one-time payment is duplicated/retried, **When** both deliveries are processed, **Then** at most one instant session and one payment result (idempotent, reusing 018's idempotency guarantee).
3. **Given** a student with an active subscription, **When** they buy an instant session, **Then** their subscription credits are unchanged (the instant session is funded entirely by its own one-time payment).
4. **Given** payment is not confirmed, **When** the booking is attempted, **Then** no instant session is created.

---

### User Story 3 - Buy a specialized single session for a specific purpose (Priority: P2)

A student (subscriber or not) buys a one-off **specialized session** scoped to a specific purpose — مراجعة (review), consolidating a specific surah, memorizing specific mutoon, or being tested on certain juz/mutashabihat — paid as a **one-time payment per session**, with the chosen purpose and its target (surah / juz / mutoon / mutashabihat scope) recorded on the session.

**Why this priority**: Product (d) (decision #22) is valuable and differentiating but secondary to onboarding and the already-live instant path; it can ship after the P1 slices without breaking them.

**Independent Test**: Request a specialized session of a given purpose with a named target (e.g. "review of juz 30"); verify the configured specialized price for that purpose is charged once via the one-time payment path, exactly one session is created carrying the purpose and target, a `payments` row is recorded, and no `student_packages` debit occurs.

**Acceptance Scenarios**:

1. **Given** a student selecting a specialized purpose and its target scope, **When** the one-time payment succeeds, **Then** one session is created carrying the purpose and the named target, with a single recorded payment and no package debit.
2. **Given** a target scope that references Quran structure (surah/juz), **When** the request is submitted, **Then** any surah/ayah/juz range is validated against the canonical Quran reference and rejected if invalid.
3. **Given** the specialized price is configured per purpose, **When** an admin changes a purpose's price, **Then** subsequent bookings charge the new price with no code change.
4. **Given** payment is not confirmed, **When** the booking is attempted, **Then** no specialized session is created.

---

### User Story 4 - Admin configures prices for assessment, instant, and specialized sessions (Priority: P2)

An admin sets and adjusts the prices for the assessment session, the instant session, and each specialized purpose — including setting the assessment to free — without a code change.

**Why this priority**: Operability and pricing control are required for the products to be usable in production, but the booking flows can be exercised in test against a configured default before self-service admin tooling is polished. P2.

**Independent Test**: As an admin, change each configurable price (assessment, instant, each specialized purpose), then verify a subsequent booking charges the updated amount; set the assessment price to zero and verify assessment booking requires no payment.

**Acceptance Scenarios**:

1. **Given** an admin updates the assessment price, **When** a student next books an assessment, **Then** the new price is charged (or no charge if zero).
2. **Given** these prices live as configuration data, **When** they are read at booking time, **Then** they come from the settings/price source, never a hardcoded constant.
3. **Given** a non-admin user, **When** they attempt to read or write these price settings, **Then** writes are rejected (service-role/admin only) per existing RLS conventions.

---

### Edge Cases

- **Payment confirmed but session creation fails** (e.g. no matching specialist available): the system must not leave a paid-but-sessionless charge unaccounted — it must either complete the booking on retry (idempotently) or surface a clearly recorded, refundable/​reconcilable failure; a charge must never silently vanish.
- **No specialist available for the requested assessment specialty**: the assessment booking must fail loudly **before** charging (or, if Stripe-first, must be refundable/reconcilable) rather than assigning a non-matching teacher; never assign a teacher whose specialties do not include the requested specialty.
- **Free assessment abuse**: if the assessment is configured free, a student must not be able to farm unlimited free specialist sessions — assessments are constrained to **1 per student per specialty** by default (configurable in `platform_settings`; admin can raise or lower the limit without a code change).
- **Subscriber buying a single session**: must be charged the one-time price and must **never** decrement subscription credits, even if they have credits available.
- **Duplicate / retried one-time payment**: reusing 018's idempotency, a retried payment yields at most one session and one payment.
- **Specialized target referencing Quran structure**: surah/ayah/juz ranges validated against `src/lib/quran/ayah-counts.ts` (and the existing `student_progress_ayah_range_guard` lineage); invalid ranges rejected, never "corrected" by a model.
- **Currency**: one-time charges are USD only in this phase, consistent with 018; non-USD is rejected.
- **Identity**: the student for any booking/payment comes from the authenticated session, never request input; a student cannot book or charge on behalf of another.

## Requirements *(mandatory)*

### Functional Requirements — Products & Pricing

- **FR-001**: System MUST represent three one-time-paid single-session products — **assessment**, **instant**, and **specialized** — distinguishable from subscription-funded sessions, so reporting and billing can tell a one-time-paid session apart from a credit-funded one.
- **FR-002**: System MUST store the price for each of these products as **configuration data** (assessment price; instant-session price; a price per specialized purpose), readable at booking time and adjustable by admins **without code changes**, reusing `platform_settings` (or an equivalent settings/price source). Prices MUST NOT be hardcoded.
- **FR-003**: The assessment price MUST support a **zero/free** configuration; when zero, an assessment booking MUST require no payment (or record a zero-amount payment) yet still proceed through the same booking path.
- **FR-004**: System MUST enumerate the supported **specialized purposes** (review/مراجعة, consolidate a specific surah, memorize specific mutoon, test on certain juz/mutashabihat) and capture, per specialized booking, the chosen purpose and its **target scope** (e.g. the surah, juz range, or mutoon/mutashabihat descriptor).

### Functional Requirements — Booking & Payment (one-time, NOT credits)

- **FR-005**: For all three products, the student identity MUST come from the authenticated session, never from request input.
- **FR-006**: System MUST charge each of these single sessions as a **one-time Stripe payment** via this spec's payment-mode Checkout infrastructure (Phase 0), and MUST record it in the existing `payments` model (reusing `stripe_payment_intent` uniqueness, `provider`, `status`). Spec 018 owns subscription-mode only — this spec builds the payment-mode route and `payment_intent.succeeded` handler. These bookings MUST be modeled as **paid bookings**.
- **FR-007**: These single sessions MUST **NOT** debit `student_packages` and MUST **NOT** consume any subscription monthly credit, even for a student who holds an active subscription with available credits.
- **FR-008**: A session for any of these products MUST be created **only after** the one-time payment is confirmed (fail-closed): an unconfirmed/abandoned/failed payment MUST result in **no** session.
- **FR-009**: The instant-session product MUST reuse the existing `start_instant_session_booking(...)` atomic SECURITY DEFINER function (service-role EXECUTE only) for session materialization; its funding source is the confirmed one-time payment, **not** a package debit. Any change required so that function can record a paid (rather than package-debited) instant session MUST preserve its atomicity and its existing EXECUTE lockdown.
- **FR-010**: Session materialization for all three products MUST be **idempotent** with respect to a duplicated/retried one-time payment (reusing 018's idempotency key on the payment/event), yielding at most one session and one payment per intent.
- **FR-011**: The recorded payment and the created session MUST be linked one-to-one (reuse `payments.booking_id` UNIQUE nullable), so a paid single session has exactly one payment and a one-time payment maps to at most one booking.

### Functional Requirements — Assessment specialist matching

- **FR-012**: An assessment booking MUST be assigned to a teacher whose **specialties** include the requested specialty (reusing the existing `profiles`/teacher-profile `specialties` and the existing session-type↔specialty validation lineage), referencing spec 020's assignment/availability for *how* a matching teacher is selected.
- **FR-013**: If **no** specialist matching the requested specialty is available, the assessment MUST fail loudly **without** assigning a non-matching teacher, and MUST NOT leave the student charged-but-unserved (no charge taken, or a charge that is reconcilable/refundable per 018).
- **FR-014**: Assessment availability MUST be constrained per student to prevent free/cheap assessment farming, per a configured policy. *(See clarification on the exact limit.)*

### Functional Requirements — Quran integrity & validation

- **FR-015**: Any Quran-structural target on a specialized session (surah, ayah range, juz) MUST be validated against the canonical reference (`src/lib/quran/ayah-counts.ts` and the `student_progress_ayah_range_guard` lineage); invalid ranges MUST be rejected, never auto-corrected.
- **FR-016**: All single-session inputs (product, purpose, target scope, specialty) MUST be validated with zod at the route/action boundary; external input is never trusted.

### Functional Requirements — Data, RLS & types

- **FR-017**: Any new table introduced by this phase MUST ship Row Level Security enabled with policies **in the same migration**, using `( select auth.uid() )` initplan policies and `private.is_admin()`: a student may read only their own single-session bookings/payments; price/settings rows follow existing `platform_settings` RLS; **all financial writes are service-role only**.
- **FR-018**: Financial/identity columns on any new single-session row MUST be protected from client mutation via the existing `BEFORE UPDATE OF` guard pattern (service-role and migrations exempt; admins via own session per existing convention), so a student cannot alter the product, price, payment linkage, or assigned teacher of a booking.
- **FR-019**: New migrations MUST be timestamped and land in `supabase/migrations/` **after** the `20260428000000_remote_baseline.sql` baseline (never `db push`ed); new enums via `CREATE TYPE`; PKs `uuid`; FKs reference `public.profiles(id)`.
- **FR-020**: Regenerated database types MUST be produced for any new tables/columns (`npm run db:types`) and `tsc --noEmit`, `lint`, and `test:unit` MUST pass.

### Non-Functional / Security Requirements

- **NFR-001**: No session may be materialized on any code path before its one-time payment is confirmed (fail-closed), and no path may debit `student_packages` for these products.
- **NFR-002**: Any new SECURITY DEFINER function (and any change to `start_instant_session_booking`) MUST follow the established EXECUTE lockdown: revoke from `public`/`anon`/`authenticated`; grant to `service_role` only.
- **NFR-003**: Any migration touching money/booking logic MUST be verified locally in Postgres — simulate paid booking, free assessment, duplicate-payment retry, and the no-debit invariant over multiple runs — before being considered done; `sb:advisors` MUST be clean for any new tables.
- **NFR-004**: Every component in these flows MUST render correctly in Arabic RTL (per AGENTS.md §4) — including specialty selection and specialized-purpose labels.

### Key Entities *(data involved)*

- **Single-session product / purpose**: the catalog of one-time-paid session kinds — assessment, instant, and the specialized purposes (review, consolidate-surah, memorize-mutoon, test-juz/mutashabihat) — each with a configurable price. (Distinct from spec 019's subscription catalog.)
- **Single-session booking** (reuses/extends `bookings` + `sessions`): a paid booking for one of these products, carrying its product/purpose, target scope (for specialized), assigned teacher, and a one-to-one link to its one-time payment; **never** linked to `student_packages`.
- **Payment** (reused `payments`): the one-time Stripe charge for the booking — `stripe_payment_intent` unique, `booking_id` unique nullable, `provider`, `status`.
- **Teacher profile / specialties** (reused `profiles`): the specialist matching source for assessments.
- **Price settings** (reused `platform_settings`): the configurable assessment/instant/specialized prices, including the free-assessment setting.
- **Canonical Quran reference** (reused `src/lib/quran/`): validates specialized targets.

---

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: For **100%** of completed single-session bookings (assessment, instant, specialized), exactly one `payments` row exists and **zero** `student_packages` debits occur — verifiable by reconciliation query.
- **SC-002**: A student with an active subscription who buys any single session has their subscription credit balance unchanged in **100%** of cases.
- **SC-003**: Every assessment session is conducted by a teacher whose specialties include the requested specialty in **100%** of bookings; **0** assessments are assigned to a non-matching teacher.
- **SC-004**: An unconfirmed/abandoned/failed one-time payment yields **0** created sessions (fail-closed), verified by automated test.
- **SC-005**: A duplicated/retried one-time payment yields at most **1** session and **1** payment across **100%** of retries.
- **SC-006**: An admin can change any configured price (including setting the assessment free) and the next booking reflects it, with **0** code changes.
- **SC-007**: Every Quran-structural target on a specialized session passes canonical range validation; **0** invalid ranges are persisted.

---

## Assumptions

- **This spec owns the payment-mode Checkout infrastructure**: spec 018 built subscription-mode only. Phase 0 of this spec builds: (a) `POST /api/stripe/checkout/single-session` in payment mode, (b) the `payment_intent.succeeded` webhook handler that resolves `booking_id` from PI metadata and calls the existing booking confirmation kernel, and (c) the `payments.booking_id uuid UNIQUE REFERENCES bookings(id)` migration. Spec 018's signature-verified webhook ingestion and `billing_events` idempotency ledger are reused as-is.
- **Webhook endpoint sharing**: the `payment_intent.succeeded` handler is added to the **existing** `/api/stripe/webhook` route as a new event-type branch alongside spec 018's handlers. A single Stripe webhook registration covers all event types. No second endpoint or webhook secret is registered.
- **Reuses the instant-session atomic path**: `start_instant_session_booking(...)` (service-role EXECUTE only) materializes the instant session; for these products the funding source is the confirmed one-time payment rather than a `student_packages` debit. Adapting it preserves atomicity and EXECUTE lockdown.
- **Reuses booking/session/payment tables**: `bookings`, `sessions`, `payments` (with `stripe_payment_intent` unique, `booking_id` unique nullable, `provider`, `status`).
- **Specialist matching defers to 020**: teacher `specialties` on `profiles` and the existing session-type↔specialty validation lineage select the assessor; *availability/assignment* mechanics are 020's.
- **Prices are data**: assessment / instant / per-purpose specialized prices live in `platform_settings` (or equivalent), adjustable by admins; the assessment may be set free.
- **Quran integrity**: specialized targets validated against `src/lib/quran/` and the `student_progress_ayah_range_guard` lineage; never model-generated.
- **Coexistence**: these one-time-paid products are developed in Stripe test mode alongside the still-live booking system; nothing here disables existing paths (cutover is spec 024).
- **Migration topology**: new timestamped migrations land after `20260428000000_remote_baseline.sql`; the baseline is never `db push`ed; RLS + guards ship in the same migration as any new table.
- **USD only** in this phase, consistent with 018.

### [NEEDS CLARIFICATION]

- **[NEEDS CLARIFICATION 1]**: The **default assessment price** at launch — a specific nominal amount, or **free (zero)** — and whether it ships configured to a placeholder until pricing is finalized. (Decision #23 says optional/nominal; the value is "set later".)
- **[NEEDS CLARIFICATION 2]**: The exact **assessment frequency limit per student** (FR-014) to prevent free/cheap assessment farming — e.g. one assessment per student lifetime, one per specialty, or one per N days.
- **[NEEDS CLARIFICATION 3]**: Whether the **specialized purposes** and the **specialty taxonomy** for assessments are a **new enumerated set/table** introduced here, or are reused from existing `session_type` / teacher `specialties` values already in the baseline.

## Dependencies

- **Spec 018** (`billing_events` idempotency ledger, webhook signature verification, `billing_events` UNIQUE pattern) — hard dependency for the idempotency infrastructure this spec extends. **Note**: payment-mode Checkout and `payment_intent.succeeded` handler are Phase 0 of *this* spec, not a deliverable from 018.
- **Spec 020** (teacher assignment/availability) — referenced for assessment specialist selection.
- Existing tables: `bookings`, `sessions`, `payments`, `profiles` (teacher `specialties`), `platform_settings`. **Not used**: `packages` / `student_packages` (these products never debit them).
- Existing functions: `start_instant_session_booking(...)` (atomic, service-role EXECUTE only).
- Existing references: `src/lib/quran/` (`ayah-counts.ts`), the `student_progress_ayah_range_guard` migration lineage.
- **Blocks**: nothing downstream depends on this phase except final cutover/migration accounting (spec 024) treating one-time-paid sessions distinctly from credit-funded ones.
