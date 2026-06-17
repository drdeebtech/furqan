# Feature Specification: Product Catalog + Credit/Package Redesign

**Feature Branch**: `019-catalog-credit-redesign`
**Created**: 2026-06-16
**Status**: Draft
**Phase**: م٢ (product catalog + credit/package redesign) of the Subscription + Courses Pivot
**Plan**: `plan.md`
**Input**: Define the product catalog (open-ended memorization packages, defined memorization courses, one-time tajweed/mutoon courses), the six price tiers with captured pricing, the single-active-hifz rule, how monthly credit grants tie into the subscription from spec 018, family/guardian accounts with sibling/second-subscription discounts, and same-type/same-teacher mid-month tier changes with proration — all driven by the existing `packages`/`student_packages`/`platform_settings` infrastructure, with every adjustable financial value stored as admin-editable data, never hardcoded.

---

## Context & Scope

Spec 018 (م٠/م١) built the **billing rails**: the subscription data model and a secure, idempotent Stripe Subscriptions integration that grants monthly session credits into the existing `student_packages` debit kernel. It deliberately deferred **what** a learner can buy and **what each cycle grants** to this spec.

This spec defines the **product catalog and the credit/package semantics** layered on those rails. It establishes: the catalog of purchasable hifz products and their six price tiers; the binding rule that a student holds exactly one active hifz product; how a paid subscription cycle (from spec 018) sizes and lands its **monthly credit grant** in `student_packages`; the family/guardian relationship and its discounts; and the constrained mid-month tier change with proration. It does not build new billing rails, scheduling, or single-session payment — it gives those phases a well-defined catalog to schedule against and bill from.

**In scope:**
- **Product catalog** entries and their six price tiers (type, sessions/month, session duration, USD price), mirrored to the **subscription plan catalog** (spec 018) so a paid cycle knows what to grant.
- **Single active hifz product rule**: a student is in EITHER an open-ended memorization package OR a defined memorization course — never both; tajweed/mutoon courses run alongside.
- **Monthly credit grant** sizing/landing in the existing `student_packages` model, additively merged per the progress-never-overwritten rule.
- **Family/guardian accounts**: one guardian managing multiple children's subscriptions, with a second-subscription discount (individual hifz) and sibling discount (group hifz).
- **Mid-month tier change** with proration, allowed only when staying within the **same type and same teacher**; type/teacher changes occur at renewal.
- All adjustable financial values (prices, discount tiers, assessment price) stored as **admin-editable data** (`platform_settings` key/value or catalog rows), never hardcoded.

**Explicitly out of scope (owned by other specs):**
- Billing rails — subscriptions, Stripe Checkout/Portal, webhooks, dunning, idempotent grant-on-payment → **spec 018** (م٠/م١). This spec consumes them.
- Teacher assignment (fixed individual teacher / fixed group halaqa), availability, cohorts, schedule generation, opening a new halaqa when full → **spec 020** (م٣).
- Attendance, absence-excuse acceptance, carry-forward compensation, teacher-hour tracking, payroll → **spec 021** (م٤).
- Specialized single sessions (product (د)), instant sessions, and the optional paid assessment session — per-session payment → **spec 022** (م٥). This spec only references their pricing settings.
- Notifications/content/channels (renewal alerts, certificates, honor board) → **spec 023** (م٦); this spec only defines the discounts/entitlements they describe.
- Existing-user migration & cutover → **spec 024** (م٧).
- **Coupons/discount codes** are DEFERRED to a later phase (decision #36) — family discounts only at first. See *Out of scope* below.

**Three lenses** (per AGENTS.md §1):
- 🛠 **Engineer**: reuse `packages`/`student_packages`/`platform_settings`; never hardcode money; single-active-hifz enforced at the data layer; proration is additive, never destructive.
- 📖 **Quran teacher**: a tier is "the right to a defined amount of teaching time"; changing a teacher or group mid-program disrupts memorization continuity, so those changes are renewal-only — the program a child is in must not silently shift.
- 🎓 **Platform expert**: a guardian must clearly understand what each child is enrolled in, what they pay, and the family discount; upgrading should feel instant and fair (prorated), while disruptive changes wait for a clean monthly boundary.

---

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Choose a hifz product tier from the catalog (Priority: P1)

A guardian (or adult student) browses the catalog of memorization products, sees the six price tiers (group and individual) with their sessions-per-month, session duration, and USD price, and selects one tier to subscribe to.

**Why this priority**: There is no subscription to bill (spec 018) until a learner can pick a concrete, priced tier; the catalog is the entry point to the entire pivot. Minimum viable slice.

**Independent Test**: Seed the catalog with the six captured tiers; render the catalog for a student; verify each tier shows type (individual/group), sessions/month, session duration, and its price read from data (not a literal), and that selecting one produces a subscription request bound to that tier's plan-catalog entry.

**Acceptance Scenarios**:

1. **Given** the catalog is seeded, **When** a student opens the hifz catalog, **Then** they see exactly the active tiers with type, sessions/month, duration, and USD price sourced from catalog/`platform_settings`.
2. **Given** a student selects a group tier (e.g., 4 sessions/month at $12), **When** they proceed, **Then** the subscription request references the subscription-plan-catalog entry whose monthly credit count equals that tier's sessions/month.
3. **Given** an admin edits a tier's price in settings/catalog, **When** a student next views the catalog, **Then** the new price is shown with no code change or deploy.

---

### User Story 2 - Single active hifz product is enforced (Priority: P1)

A student already in an open-ended memorization package attempts to also subscribe to a defined memorization course (another hifz product). The system prevents holding two active hifz products at once, while still allowing a tajweed/mutoon course alongside.

**Why this priority**: Decision #5 is a binding business invariant; allowing two active hifz products would double-grant credits, confuse scheduling, and over-bill a family. Financial-correctness and pedagogy lens both make this P1.

**Independent Test**: Give a student one active hifz subscription; attempt to start a second hifz subscription (package or course); verify it is rejected with a clear reason; then start a tajweed/mutoon (one-time) course and verify it succeeds.

**Acceptance Scenarios**:

1. **Given** a student with an active open-ended memorization package, **When** they try to subscribe to a defined memorization course, **Then** the second hifz subscription is blocked with a reason indicating one active hifz product is allowed.
2. **Given** a student with an active hifz product, **When** they enroll in a tajweed/mutoon one-time course, **Then** it succeeds and runs concurrently.
3. **Given** a student whose hifz subscription has ended/cancelled, **When** they subscribe to a different hifz product, **Then** it is allowed.

---

### User Story 3 - Monthly cycle grants the tier's credits into `student_packages` (Priority: P1)

When a paid subscription cycle (spec 018) lands, the student receives exactly that tier's monthly credit count and session duration as a `student_packages` grant, additively merged with any unused remainder, never overwritten.

**Why this priority**: The catalog is meaningless unless a paid cycle deterministically grants the right amount; this is the bridge between 018's rails and the learner's entitlement. Equal P1.

**Independent Test**: For a seeded tier (e.g., 8 sessions/month), simulate a paid cycle from spec 018; verify one `student_packages` grant with `sessions_total` equal to the tier's sessions/month, the correct session duration recorded, and that a prior unused remainder is added — never reset.

**Acceptance Scenarios**:

1. **Given** a paid cycle for an 8-sessions/month tier, **When** the grant lands, **Then** a `student_packages` row records `sessions_total = 8` for that cycle, tied to the originating subscription.
2. **Given** the prior cycle left unused sessions, **When** the new cycle grants, **Then** the remaining sessions are added to the new grant total — never silently lost, reset, or overstated (AGENTS.md §4).
3. **Given** a tier defines a session duration, **When** the grant lands, **Then** the duration is carried on the grant so scheduling (spec 020) can size each booked session.

---

### User Story 4 - Guardian manages multiple children with family discounts (Priority: P2)

A guardian holds one account and manages subscriptions for several children. The second-and-onward individual hifz subscription under that guardian receives a discount, and group hifz packages receive a sibling discount.

**Why this priority**: Family accounts and discounts are a major adoption and fairness lever (decision #26), but a single-child subscription is viable first; multi-child billing can follow. P2.

**Independent Test**: Create a guardian with two children; subscribe child A and child B to individual hifz tiers; verify child B's price reflects the configured second-subscription discount; subscribe two siblings to a group tier and verify the sibling discount applies — both percentages read from settings.

**Acceptance Scenarios**:

1. **Given** a guardian with one active individual hifz subscription, **When** they add a second individual hifz subscription for another child, **Then** the second subscription's price reflects the configured second-subscription discount.
2. **Given** a guardian subscribing two siblings to group hifz, **When** the second sibling subscribes, **Then** the configured sibling discount applies to the group package.
3. **Given** the discount percentages are admin settings, **When** an admin changes them, **Then** subsequent subscriptions use the new values with no code change; existing cycles are unaffected until renewal.

---

### User Story 5 - Increase tier mid-month within the same type and teacher (Priority: P2)

A student on an individual hifz tier wants more hours/sessions this month. If they stay within the same type and same teacher, the increase applies immediately with a prorated charge for the remainder of the cycle; changing type (individual↔group) or teacher is only available at renewal.

**Why this priority**: Immediate upgrades capture intent and revenue and reward engaged learners, but the constrained, renewal-only path for disruptive changes is what protects continuity. Valuable but not the first viable slice. P2.

**Independent Test**: Put a student on an individual tier with a fixed teacher; mid-cycle request a higher-session tier of the same type and teacher; verify the change applies now, additional credits are granted prorated, and the proration amount is computed from catalog prices; then attempt an individual→group change and verify it is scheduled for renewal, not applied now.

**Acceptance Scenarios**:

1. **Given** a student mid-cycle on an individual tier with teacher T, **When** they upgrade to a higher-session individual tier with the same teacher T, **Then** the upgrade applies immediately, the additional monthly credits for the cycle remainder are granted, and a prorated charge is computed from the price difference.
2. **Given** a student requests a change of type (individual↔group) or a different teacher, **When** they submit it mid-cycle, **Then** it is recorded to take effect at the next renewal, not immediately.
3. **Given** a mid-cycle increase, **When** the credits are granted, **Then** they are added to the existing grant (additive), preserving any used/remaining counts.

---

### Edge Cases

- **Downgrade mid-month**: decreasing sessions/time mid-cycle is NOT an immediate proration path; decreases take effect at renewal (only increases are immediate, decision #15). A mid-cycle downgrade request is queued for renewal.
- **Upgrade across teachers via same physical person**: if the "same teacher" check is by teacher identity, an upgrade must verify the assigned teacher is unchanged; an upgrade that would require a different teacher is renewal-only even within the same type.
- **Family discount when the first subscription lapses**: if the guardian's first (full-price) subscription is cancelled, whether the discounted second subscription's price re-rates at renewal is an admin-policy choice — see [NEEDS CLARIFICATION] below.
- **Individual hifz hour bundling**: individual hifz is modeled as discrete admin-defined hour bundles (e.g. 4/6/8 hours/month) each as a catalog row with a fixed `sessions_per_month`. Price = hours × per-hour rate (admin setting, default $10). This keeps parity with the spec 018 plan-per-tier mirror requirement and avoids continuous billing complexity. New bundles are added as catalog rows, not code changes.
- **Tier edited after a student subscribed**: an admin changing a tier's price/sessions must not retroactively alter an active cycle's grant; changes bind at the next renewal (the cycle's terms are captured at grant time, like spec 018's plan-mirror).
- **Two active hifz attempts racing**: two concurrent subscribe requests for two hifz products must not both succeed (single-active-hifz must hold under concurrency, enforced at the data layer, not only the UI).
- **Group tier with a session duration other than 60 min**: captured group pricing assumes 60-minute sessions; a tier must always carry its own duration so a grant is unambiguous even if future tiers differ.
- **Sibling vs. second-subscription discount overlap**: a guardian could qualify for both a group sibling discount and (on a different child) an individual second-subscription discount; the two discount families apply to their respective product types and must not stack on one subscription unless an admin setting permits it.
- **Assessment session price**: the optional assessment (spec 022) may be free or symbolically priced; its value is an admin setting referenced here only as data, never hardcoded.

---

## Requirements *(mandatory)*

### Functional Requirements — Product Catalog

- **FR-001**: System MUST represent each purchasable hifz product as a catalog entry distinguishing the three forms: (a) open-ended monthly memorization package, (b) defined (fixed-duration) monthly memorization course, and (c) one-time tajweed/mutoon course. Forms (a) and (b) are recurring (subscription); form (c) is one-time. *(🛠 reuse `packages.package_type`; recurring forms mirror to the subscription-plan catalog from spec 018.)*
- **FR-002**: Each hifz tier MUST define, as data: its **type** (individual or group), its **sessions per month**, its **session duration**, and its **USD price**. These values MUST be stored as admin-editable catalog rows / `platform_settings`, never hardcoded.
- **FR-003**: System MUST seed the six captured price tiers: **group** hifz at 60-minute sessions — 4 sessions/month = $12, 6 = $15, 8 = $20; and **individual** hifz as **discrete admin-defined hour bundles** (e.g. 4/6/8 hours/month) priced at a configurable per-hour rate (default **$10/hour**). Individual tiers are discrete catalog entries, each with a fixed `sessions_per_month` (= hours/month given 60-min sessions) and a corresponding subscription-plan-catalog entry. The per-hour rate and group tier prices MUST be admin-editable settings; new individual bundles are added as new catalog rows, not by code change.
- **FR-004**: Each recurring hifz tier MUST map to a **subscription plan catalog** entry (spec 018) whose **monthly credit count** equals the tier's sessions per month, so a paid cycle grants the correct amount. The catalog entry is the binding definition of what a paid cycle grants.
- **FR-005**: The catalog MUST expose only **active** tiers to students; archived/inactive tiers MUST remain referenceable by existing subscriptions but not be newly selectable.
- **FR-006**: Tajweed/mutoon courses (form (c)) MUST be representable as one-time-payment products with their own pricing setting; their detailed capacity and mixed recorded+live structure are out of scope here (referenced for catalog completeness only).

### Functional Requirements — Single Active Hifz Product

- **FR-007**: System MUST enforce that a student holds **at most one active hifz product** (an open-ended package OR a defined memorization course) at any time. Attempting to activate a second hifz product MUST be rejected with a clear, user-facing reason.
- **FR-008**: System MUST allow a tajweed/mutoon (form (c)) course and specialized/instant single sessions (spec 022) to run **concurrently** with an active hifz product; only hifz products are mutually exclusive.
- **FR-009**: The single-active-hifz constraint MUST be enforced at the **data layer** (not solely UI), so two concurrent activation attempts cannot both succeed. *(🛠 a partial unique constraint or guarded activation function over active hifz subscriptions per student.)*

### Functional Requirements — Monthly Credit Grant Sizing

- **FR-010**: When a paid subscription cycle lands (via spec 018's grant-on-payment), the system MUST create a `student_packages` grant whose `sessions_total` equals the tier's sessions-per-month and which carries the tier's session duration, tied to the originating subscription and billing cycle (granted at most once per cycle, per spec 018).
- **FR-011**: A new cycle's grant MUST be **additively merged** with any unused remainder from the prior cycle — sessions are never silently lost, reset, or overstated (AGENTS.md §4). The merge MUST preserve `sessions_used` semantics so `sessions_remaining` (GENERATED) stays correct.
- **FR-012**: The grant MUST record the binding tier terms at grant time (sessions, duration, price basis) so that a later admin edit to the catalog does not retroactively change an already-granted cycle.

### Functional Requirements — Family / Guardian Accounts & Discounts

- **FR-013**: System MUST represent a **guardian↔child** relationship allowing one guardian account to own and manage multiple children's hifz subscriptions, with the paying customer (spec 018 customer mapping) resolvable to the guardian.
- **FR-014**: System MUST apply a configurable **second-subscription discount** to the second-and-onward **individual** hifz subscription under the same guardian, and a configurable **sibling discount** to **group** hifz packages for siblings under the same guardian. Both discount values MUST be admin-editable settings, never hardcoded.
- **FR-015**: Discount application MUST be deterministic and auditable: the system MUST record which discount (and percentage) was applied to each subscription so a price can be reconciled and explained to the guardian.
- **FR-016**: A change to a discount setting MUST affect only **future** subscriptions/renewals, never silently re-rate an already-granted cycle.

### Functional Requirements — Mid-Month Tier Change & Proration

- **FR-017**: System MUST allow an **immediate** tier increase (more sessions/time) **only** when the new tier has the **same type AND same teacher** as the current one; the additional credits for the remainder of the cycle MUST be granted immediately and **added** to the existing grant.
- **FR-018**: An immediate increase MUST compute a **prorated charge** from the price difference between the old and new tiers for the remaining portion of the billing cycle, coordinated with the billing rails (spec 018 / Stripe proration).
- **FR-019**: Any change of **type** (individual↔group) or **teacher**, and any **decrease** in sessions/time, MUST be deferred to the **next renewal** — recorded as a pending change, not applied mid-cycle.
- **FR-020**: A mid-cycle increase MUST NOT reset or discard the student's current `sessions_used`/remaining; it is additive (consistent with FR-011).

### Non-Functional / Security Requirements

- **NFR-001**: All adjustable financial values — tier prices, per-hour individual rate, discount percentages, assessment price — MUST be stored as data (`platform_settings` key/value or catalog rows), admin-editable without a deploy, and MUST NOT appear as literals in application code.
- **NFR-002**: Every new table MUST ship Row Level Security enabled with policies **in the same migration**, using the established `( select auth.uid() )` initplan pattern and `private.is_admin()`: a student/guardian may read only their own catalog selections, subscriptions, and grants; catalog tier rows are readable by authenticated users; price/discount **writes** are admin-only; grant writes remain service-role only (per spec 018).
- **NFR-003**: Financial/identity columns on catalog and grant linkage (price, sessions, tier reference, guardian linkage) MUST be protected from client mutation following the existing `BEFORE UPDATE OF` guard pattern (service-role, migrations, and admin-session exempt), so a learner cannot alter their tier, price, or discount.
- **NFR-004**: Any migration with money/grant/proration logic MUST be verified locally in Postgres — simulating grant, additive merge over multiple cycles, single-active-hifz under concurrency, and a prorated increase — before being considered done; `sb:advisors` MUST be clean for the new tables.
- **NFR-005**: The full check suite MUST pass: `tsc --noEmit`, `lint`, `test:unit`; the single-active-hifz invariant, additive-merge, and proration paths MUST have unit/integration coverage. Regenerated database types (`npm run db:types`) MUST be produced and typecheck green.
- **NFR-006**: Every catalog and family-management surface MUST render correctly in Arabic RTL (AGENTS.md §4).

### Key Entities *(data involved)*

- **Hifz Catalog Tier**: a purchasable memorization product tier — form (open-ended package / defined course / one-time tajweed-mutoon), type (individual/group), sessions per month, session duration, USD price, active flag. Recurring tiers reference a subscription-plan-catalog entry (spec 018). *(🛠 reuse/extend `packages` — `package_type`, `session_count`, `price_usd`, `session_mode_allowances`.)*
- **Subscription Plan Catalog entry** (spec 018, reused): binding definition of what a paid cycle grants; this spec sets its monthly credit count = the tier's sessions/month and its session metadata.
- **Monthly Credit Grant**: a `student_packages` row per paid cycle (reused) — `sessions_total`, `sessions_used`, `sessions_remaining` (GENERATED), `status`, `expires_at`, carrying tier duration and binding terms; additively merged across cycles.
- **Guardian Relationship**: links one guardian (`profiles`) to multiple child (`profiles`) accounts and to the paying customer mapping (spec 018), enabling family discounts.
- **Discount Record**: which discount type (second-individual-subscription / group-sibling) and percentage was applied to a subscription, for reconciliation; percentages sourced from settings.
- **Pending Tier Change**: a recorded change (type switch, teacher change, or decrease) deferred to the next renewal.
- **Pricing Settings** (`platform_settings`, reused): per-hour individual rate, group tier prices, discount percentages, assessment price — all admin-editable.

---

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: A student can view all six captured tiers with correct type, sessions/month, duration, and price — **100%** sourced from data — and select one in under 2 minutes, with **zero** hardcoded prices in code (verifiable by a code scan for price literals).
- **SC-002**: A student can never hold two active hifz products simultaneously — **0** double-hifz states across **100%** of attempts, including concurrent ones (verifiable by a data-layer constraint test).
- **SC-003**: Each paid cycle grants exactly the tier's sessions-per-month into `student_packages`, with unused remainder **always added, never reset** — **100%** of cycles, verifiable by a reconciliation query across multiple simulated cycles.
- **SC-004**: A guardian's second individual subscription and sibling group subscriptions reflect the configured discounts for **100%** of qualifying cases, with the applied discount recorded and explainable.
- **SC-005**: A same-type/same-teacher increase applies immediately and prorates correctly for **100%** of valid requests, while **100%** of type/teacher changes and decreases are deferred to renewal (no mid-cycle disruptive change ever applies immediately).
- **SC-006**: An admin can change any tier price, the per-hour rate, or any discount percentage and see it reflected in new subscriptions with **no** code change or deploy, while **0** already-granted cycles are retroactively altered.

---

## Assumptions

- **Reuses the packages catalog**: hifz tiers extend/reuse `packages` (`package_type`, `session_count` → sessions/month, `price_usd`, `session_mode_allowances` jsonb for individual/group); legacy `student_credits` is not extended.
- **Reuses the grant kernel and plan mirror from spec 018**: grants land in `student_packages` via spec 018's grant-on-payment; this spec only sizes the grant from the tier and enforces additive merge. The subscription-plan catalog table (spec 018) is the recurring tier's binding plan record.
- **Reuses settings + RLS/guard conventions**: `platform_settings` (authenticated read, admin write) holds all adjustable money; `( select auth.uid() )` initplan policies, `private.is_admin()`, and the `BEFORE UPDATE OF` financial-column guard apply to new tables.
- **Migration topology**: new timestamped migrations land in `supabase/migrations/` after `20260428000000_remote_baseline.sql`; the baseline is never `db push`ed. Types via `npm run db:types`.
- **Individual hifz pricing**: priced at $10/hour (admin setting). The default individual session duration is assumed 60 minutes (= 1 hour) pending confirmation (plan open question); a tier carries its own duration regardless.
- **Group pricing** assumes 60-minute sessions per the captured sheet; each tier still stores its own duration so future non-60-minute tiers are unambiguous.
- **One paying guardian per subscription**: a child's subscription resolves to the guardian's customer mapping (spec 018), which already allowed a guardian-owned customer to pay for a child.
- **Discounts apply to their own product family**: second-subscription discount is for individual hifz; sibling discount is for group hifz; they do not stack on a single subscription unless an admin setting explicitly permits it.
- **Tier terms are captured at grant time** (like spec 018's plan mirror), so admin catalog edits bind only at the next renewal.
- **Defined memorization course (b) duration/price** (who sets it, whether fixed per surah/juz) is a plan open question carried into spec 020's scheduling work; this spec models it as a fixed-duration recurring tier without fixing the duration value.

### Open clarifications

- **Individual-hifz hour bundling** *(resolved)*: Individual hifz uses discrete admin-defined hour bundles (e.g. 4/6/8 hours/month), each a catalog row with fixed `sessions_per_month`. Continuous billing is deferred; discrete bundles satisfy the spec-018 plan-per-tier mirror requirement.
- **[NEEDS CLARIFICATION]**: Exact discount percentages for the second individual subscription and for group siblings (decision #26 says "configurable/tiered, TBD"). Modeled here as admin settings with values to be entered; no percentage is hardcoded.
- **[NEEDS CLARIFICATION]**: Whether a discounted second/sibling subscription **re-rates** at renewal if the qualifying first subscription has lapsed, or retains its discounted price. (Assumption: re-rate at renewal based on then-current family state; this is an admin-policy setting.)

## Dependencies

- **Spec 018** (blocking): subscription, customer mapping, subscription-plan catalog, billing-event ledger, and idempotent grant-on-payment into `student_packages`. This spec sets the plan catalog's credit counts and grant sizing; it cannot grant without 018's rails.
- Existing tables: `packages`, `student_packages`, `student_credits` (legacy, not extended), `profiles`, `platform_settings`, plus spec 018's subscription/plan/billing-event tables.
- Existing conventions/functions: `( select auth.uid() )` initplan RLS, `private.is_admin()`, `public.set_updated_at()`, the `BEFORE UPDATE OF` financial-column guard, the SECURITY DEFINER EXECUTE lockdown.
- **Blocks**: spec 020 (scheduling/teacher-assignment/cohorts schedules against these tiers and grant durations), spec 021 (attendance/payroll references granted sessions), spec 022 (single sessions reference pricing settings), spec 023 (notifications reference renewal/discount entitlements), spec 024 (migration maps existing users into these tiers).

## Clarifications

### Session 2026-06-16 (analyze remediation)

- Q: Stripe `proration_behavior` value for mid-month upgrade? → A: `always_invoice` (force immediate prorated invoice). NOTE: `create_prorated_invoice` used in research/contracts is an INVALID Stripe enum — must be replaced everywhere.
- Q: `add-child` request input contract? → A: `{childEmail}` (zod-validated); server resolves to `child_id` via email lookup. The `child_user_id` uuid form in contracts/api.md is superseded.
- Q: How many new `package_type` CHECK members? → A: ONE new value `tajweed_course` (total 6 — baseline has 5: `single_session`, `pack_4`, `pack_8`, `pack_12`, `full_course`), per data-model.md §1c. The tasks.md "7 new values" wording is an error.
- Q: Who applies `pending_tier_changes` at renewal (FR-019)? → A: the `invoice.paid` webhook branch transitions pending→applied and re-grants at the new tier. (Implementation task to be added in a later tasks-regen pass.)
- Q: Enforce single pending change per subscription? → A: make `idx_pending_changes_subscription` a partial UNIQUE index (WHERE status='pending').
