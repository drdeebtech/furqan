# Feature Specification: Attendance, Excuses & Teacher Payroll

**Feature Branch**: `021-attendance-payroll`
**Created**: 2026-06-16
**Status**: Draft
**Phase**: م٤ (Attendance, excuses, and teacher payroll) of the Subscription + Courses Pivot
**Plan**: `/home/drdeeb/.claude/plans/you-are-acting-as-shimmering-cray.md`
**Input**: Track per-session attendance and absences; let students request excuses and teachers accept/reject them; debit unexcused absences from the balance while carrying over excused ones (compensated by extending the subscription period); handle teacher absence via substitute-or-apology without penalizing the student; and compute teacher payroll from actual teaching hours, aggregated monthly and paid on a fixed date — reusing the platform's existing session, package, and credit-debit infrastructure.

---

## Context & Scope

The platform now bills via monthly subscriptions (spec 018) over scheduled cohorts/halaqas and one-to-one sessions (spec 020). What was missing is the **lifecycle of an individual session once its time arrives**: did it happen, was someone absent, was an absence excused, and — on the supply side — how much is each teacher owed for the hours they actually taught.

This spec owns three coupled concerns:

1. **Attendance & absence accounting** — recording per-session attendance outcomes and applying the platform's absence/credit policy.
2. **Excuses** — a student-initiated request with a notice threshold, decided by the teacher, that converts a would-be debit into a carried-over (rescheduled) session compensated by a subscription-period extension.
3. **Teacher payroll** — per-teacher tracking of actually-delivered teaching hours, monthly aggregation, and a single monthly payout recorded in a ledger.

It reuses the hardened debit kernel: an unexcused absence **leaves the session debited** (the credit already consumed at booking is lost); an excused-and-carried session **restores the exact charged credit** via the existing restore path so it can be rescheduled. No new debit/restore primitive is invented.

**In scope:**
- Per-session attendance records (present / student-absent / teacher-absent / completed) tied to existing `sessions`/`bookings`.
- Absence policy: unexcused absence with sufficient prior notice → session cancelled and **debited (lost)**; excused absence → session **carried over, credit restored**, no debit.
- Excuse requests with a notice threshold (default **2 hours** before session start) and teacher accept/reject decision.
- Carry-over compensation by **extending the subscription/course duration** by an equivalent amount, coordinated with the spec-018 subscription period.
- Teacher-absence handling: substitute-if-available, otherwise apology; student's session preserved/compensated and **never counted as the student's absence**.
- Per-teacher hourly rate as a configurable field; monthly aggregation of delivered hours; a **payout ledger** with a fixed monthly run date (default **first of the following month**).
- RLS on every new table (same migration); financial/hour columns guarded; service-role-only writes for money/hour mutations.

**Explicitly out of scope (owned by other specs):**
- Billing rails (Stripe subscriptions, invoices, payment ingestion) → **spec 018** (م١). This spec **consumes** the subscription period defined there.
- Pricing catalog, tiers, credits/package sizing semantics, family discounts → **spec 019** (م٢).
- Scheduling, teacher assignment, availability, cohorts/halaqas (when sessions are created and seated) → **spec 020** (م٣).
- Assessment / instant / specialized single sessions → **spec 022** (م٥). (This spec's attendance applies to scheduled subscription sessions; single-session debit rules live in 022.)
- Notification **content and channels** for absence/excuse/payroll alerts (in-app + email + WhatsApp via n8n) → **spec 023** (م٦). This spec only **emits** the domain events those notifications consume.
- Existing-user migration & cutover → **spec 024** (م٧).

**Subscription-extension dependency (explicit):** the carry-over compensation in this spec works by **extending the effective subscription/course period** so the learner is not shortchanged for an excused, rescheduled session. The authoritative Stripe-mirrored period (`subscriptions.current_period_end`) is read-only — it is recency-guarded against mutation by spec 018's identity guard. Extension is therefore additive: **this spec (021) Phase 0 introduces a `subscription_extensions` table** that accumulates extension grants without touching the mirror. Effective period end = `current_period_end + SUM(extension_seconds)` from active extension rows. This keeps the Stripe mirror untouched and provides a full audit trail per extension.

**Three lenses** (per AGENTS.md §1):
- 🛠 **Engineer**: reuse `restore_student_package` for excused carry-over and leave unexcused absences debited; never duplicate financial logic; payout amounts and hour counts are financial → service-role writes + `BEFORE UPDATE OF` guards; fail-closed.
- 📖 **Quran teacher**: an excused absence is part of the discipline of memorization (a student with a genuine reason must not lose progress or a paid session); a teacher who genuinely taught must be paid for exactly the hours delivered. Continuity of ḥifẓ is never broken by a billing/attendance edge case.
- 🎓 **Platform expert**: students need a clear, fair, low-friction excuse flow with an honest deadline; teachers need transparent, predictable monthly pay tied to real work; teacher-side failures (teacher absent) must never punish the learner.

---

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Unexcused absence is debited; excused absence is carried over (Priority: P1)

When a student misses a scheduled session, the outcome depends on whether they filed an accepted excuse in time. Without an accepted excuse, the session is cancelled and the already-charged credit is **lost (debited)**. With a teacher-accepted excuse filed before the notice deadline, the session is **carried over** — the credit is **restored** and the session is rescheduled, with no loss to the student.

**Why this priority**: This is the core fairness rule of the whole phase and the only behavior that touches the learner's paid balance. Equal-highest priority.

**Independent Test**: Mark a scheduled session as a student no-show with no accepted excuse; verify the booking is cancelled and the credit remains consumed (balance not restored). Separately, file and accept an excuse before the deadline; verify the same outcome instead **restores** the exact charged credit via the existing restore path and flags the session for rescheduling — with no double-restore on retry.

**Acceptance Scenarios**:

1. **Given** a scheduled session and a student who does not attend, **When** no accepted excuse exists, **Then** the session is recorded as an unexcused absence, the booking is cancelled, and the consumed credit is **not** restored (it is lost/debited).
2. **Given** a scheduled session, **When** the student files an excuse before the notice deadline and the teacher accepts it, **Then** the session is recorded as excused-and-carried, the originally charged credit is **restored exactly once** (reusing the existing restore path), and the session is marked for rescheduling.
3. **Given** an excused-and-carried session, **When** the restore is processed twice (retry/duplicate), **Then** the credit is restored **at most once** (idempotent — no over-credit).
4. **Given** an absence outcome, **When** progress/memorization state is consulted, **Then** memorization progress is **merged, never reset or overstated** (per AGENTS.md §4).

---

### User Story 2 - Student requests an excuse; teacher decides (Priority: P1)

A student who cannot attend an upcoming session submits an excuse with a reason. If they submit at least the required notice before the session (default 2 hours), the excuse is **eligible**; the assigned teacher then accepts or rejects it. Acceptance carries the session over; rejection (or an ineligible/late request) leaves the normal unexcused-absence rule to apply.

**Why this priority**: The excuse decision is the gate that determines Story 1's branch; the teacher's authority over acceptance is an explicit product decision. P1.

**Independent Test**: Submit an excuse more than the threshold before the session → it is eligible and pending; the teacher accepts → carry-over path runs. Submit an excuse inside the threshold → it is marked ineligible (late) and cannot be accepted to trigger carry-over.

**Acceptance Scenarios**:

1. **Given** an upcoming session, **When** the student submits an excuse at least the notice threshold before start, **Then** the excuse is recorded as eligible and pending the teacher's decision.
2. **Given** an upcoming session, **When** the student submits an excuse **inside** the notice threshold, **Then** the excuse is recorded as ineligible/late and does **not** qualify for carry-over.
3. **Given** a pending eligible excuse, **When** the assigned teacher accepts it, **Then** the session is carried over (Story 1, scenario 2) and a domain event is emitted for notification.
4. **Given** a pending excuse, **When** the assigned teacher rejects it, **Then** the carry-over does not occur and, if the student is absent, the unexcused-absence rule applies.
5. **Given** an excuse, **When** a user other than the assigned teacher (or admin) attempts to decide it, **Then** the decision is rejected (authorization enforced).

---

### User Story 3 - Excused carry-over extends the subscription period (Priority: P1)

Because a subscriber pays for a fixed amount of teaching per period, an excused-and-carried session is compensated by **extending the subscription/course duration** by an equivalent amount, so the rescheduled session does not effectively shorten what the learner paid for.

**Why this priority**: Without the extension, restoring the credit alone could still cost the learner time at the period boundary; this closes the fairness loop and is the spec-018 coordination point. P1.

**Independent Test**: For a subscriber, accept an excuse that carries a session over; verify an equivalent extension is recorded against the subscription/course period (coordinated with spec 018) and is auditable, with no extension applied for unexcused absences.

**Acceptance Scenarios**:

1. **Given** an excused-and-carried session for an active subscription, **When** the carry-over is finalized, **Then** an equivalent subscription/course-period extension is recorded against that subscription.
2. **Given** an unexcused absence, **When** it is finalized, **Then** **no** period extension is applied.
3. **Given** a recorded extension, **When** it is applied twice (retry), **Then** the cumulative extension reflects the carry-over **once** (idempotent).

---

### User Story 4 - Teacher absence never penalizes the student (Priority: P1)

When the **teacher** misses a session, the platform tries to provide a substitute teacher if one is available; otherwise it records an apology. Either way the student's session is **preserved or compensated** and is **never counted as the student's absence** — no credit is lost and the learner is made whole.

**Why this priority**: A supply-side failure silently charged to a child is the worst learner harm and a trust-breaker. P1 on the platform-expert and Quran-teacher lenses.

**Independent Test**: Mark a session as teacher-absent; verify it is recorded as a teacher-side absence (not student absence), the student's credit is preserved (restored if it had been debited) and/or the session is reassigned to a substitute or marked for rescheduling, and that this absence does **not** contribute to the student's absence record.

**Acceptance Scenarios**:

1. **Given** a scheduled session, **When** the teacher is absent and a substitute is available, **Then** the session is reassigned to the substitute and the student's credit and continuity are preserved.
2. **Given** a scheduled session, **When** the teacher is absent and no substitute is available, **Then** an apology/compensation outcome is recorded, the student's credit is preserved (restored if debited) and the session is carried over for rescheduling.
3. **Given** a teacher-absent outcome, **When** the student's absence history is computed, **Then** this session is **not** counted as a student absence and is **not** debited from the student.
4. **Given** a teacher-absent session that is reassigned to a substitute who delivers it, **When** payroll is computed, **Then** the delivered hours accrue to the **substitute** teacher, not the absent one.

---

### User Story 5 - Teacher payroll from actual delivered hours, paid monthly (Priority: P1)

Each delivered session accrues teaching hours (sessions actually delivered × their duration) to the teacher who delivered it, at that teacher's configurable hourly rate. At month end the platform aggregates each teacher's delivered hours for the ended month and, on a fixed run date (default the **first of the following month**), produces a single payout per teacher recorded in a payout ledger.

**Why this priority**: This is the entire supply-side compensation system; without it teachers are not paid correctly or predictably. P1.

**Independent Test**: Deliver several sessions of known durations for a teacher across a month at a known hourly rate; run the monthly aggregation for that month; verify exactly one payout row per teacher equal to (sum of delivered hours × rate), covering only delivered sessions in that month, computed once and idempotent on re-run.

**Acceptance Scenarios**:

1. **Given** a teacher who delivered sessions in a month, **When** payroll for that month runs, **Then** exactly one payout is produced equal to the sum of delivered hours × that teacher's hourly rate.
2. **Given** sessions that were **not** delivered (student no-show debited, cancelled, excused-carried-not-yet-redelivered), **When** payroll runs, **Then** those non-delivered sessions do **not** accrue payable hours.
3. **Given** a payroll run for a month, **When** the same month's run is executed again, **Then** no duplicate payout is created (idempotent per teacher per month).
4. **Given** a teacher with a per-teacher hourly rate, **When** the rate changes after a month closes, **Then** the closed month's payout reflects the rate effective during that month, not a later change. [NEEDS CLARIFICATION: rate effective-dating — does payroll use the rate at time of each session, or the rate at month close?]
5. **Given** a produced payout, **When** an unauthorized actor attempts to alter its amount or mark it paid, **Then** the change is rejected (financial-column guard + admin/service-role only).

---

### Edge Cases

- **Excuse filed exactly at the threshold boundary** (e.g., precisely 2 hours before): boundary is inclusive of "at least 2 hours" — at-or-before the deadline is eligible; even one second inside is late.
- **Excuse filed, teacher never decides before session start**: an undecided excuse at session time must resolve deterministically — it does not auto-accept; if the student is absent and no acceptance exists, the unexcused rule applies (teacher inaction ≠ acceptance).
- **Student attends despite filing an excuse**: a filed/accepted excuse on a session the student actually attends is moot — no carry-over, no restore, no double-credit; the session is simply completed.
- **Double outcome / retry**: the same session must not be both debited and restored; outcome finalization is idempotent and single-valued per session.
- **Restore for a session whose credit was already restored** (e.g., teacher-absent then later also excused): restore is idempotent; a session's credit is restored **at most once**.
- **Teacher absent AND student absent**: classified as teacher-absent (student is held harmless); not a student absence.
- **Session spanning a month boundary / payroll cutoff**: a session's hours accrue to the month in which it was **delivered**; the run aggregates only sessions whose delivery falls in the closed month. [NEEDS CLARIFICATION: timezone/boundary basis for "delivered in month" — platform timezone vs. teacher local time.]
- **Substitute delivers a session**: payable hours follow the **actual deliverer**, never the originally-assigned teacher.
- **Zero delivered hours for a teacher in a month**: no payout row (or a zero-value row) is produced — must be unambiguous and not error.
- **Carry-over extension at period end of a canceling subscription**: if `cancel_at_period_end = true`, an extension row still accumulates in `subscription_extensions`. Effective end = `current_period_end + SUM(extension_seconds)` is honored regardless of cancel state — the student is owed the time they paid for. The platform surfaces this as "extended until [effective end]" to the student.
- **Rate missing/zero for a teacher**: payroll must fail loudly or treat as configuration error, never silently pay $0 without flagging.

---

## Requirements *(mandatory)*

### Functional Requirements — Attendance & Absence Policy

- **FR-001**: System MUST record a per-session **attendance outcome** for each scheduled session, drawn from a fixed set: present/completed, student-absent (no-show), teacher-absent, and excused-carried. Each session resolves to exactly one outcome.
- **FR-002**: System MUST, for a **student absence without an accepted eligible excuse**, record the absence as unexcused, cancel the booking, and **leave the originally consumed credit debited (lost)** — it MUST NOT restore the credit. This reuses the existing booking-cancellation path and does **not** call the restore kernel.
- **FR-003**: System MUST, for a **student absence with a teacher-accepted eligible excuse**, mark the session excused-carried, **restore the exact originally-charged credit by reusing the existing `restore_student_package` path**, and flag the session for rescheduling. The credit MUST be restored **at most once** per session (idempotent).
- **FR-004**: A single session MUST resolve to a single, final outcome; the system MUST prevent a session from being both debited and restored (no double accounting), and finalization MUST be idempotent.
- **FR-005**: Memorization/progress state associated with an absent or carried session MUST be **merged, never overwritten, reset, or overstated** (per AGENTS.md §4).

### Functional Requirements — Excuses

- **FR-006**: Students MUST be able to submit an **excuse request** against an upcoming scheduled session, with a reason, recording submission time relative to session start.
- **FR-007**: System MUST evaluate excuse **eligibility** against a configurable **notice threshold** (default **2 hours** before session start, stored as an adjustable setting, not hardcoded): submitted at-or-before the deadline → eligible; submitted later → ineligible/late.
- **FR-008**: Only the **assigned teacher** (or an admin) MUST be able to **accept or reject** an excuse; acceptance is the sole trigger for the carry-over path (FR-003). Authorization MUST be enforced; identity MUST come from the authenticated session, never from request input.
- **FR-009**: An **ineligible/late** excuse, a **rejected** excuse, or an **undecided** excuse at session time MUST NOT trigger carry-over; teacher inaction MUST NOT be treated as acceptance.
- **FR-010**: An accepted excuse, a rejection, and an eligibility determination MUST each emit a domain event for downstream notification (content/channels owned by spec 023).

### Functional Requirements — Carry-over Compensation (subscription extension)

- **FR-011**: On an excused-carried session for a subscriber, the system MUST record an **equivalent extension** of the subscription/course period (equivalent to the carried session's duration/cycle share), coordinated with the spec-018 subscription period. No extension MUST be applied for unexcused absences or completed sessions.
- **FR-012**: The carry-over extension MUST be **idempotent** per carried session (a retry MUST NOT extend twice) and MUST be auditable (which session caused which extension).
- **FR-013**: The extension mechanism MUST NOT mutate `subscriptions.current_period_end` (the read-only Stripe mirror). Extensions MUST be recorded in `subscription_extensions` (introduced in Phase 0 of this spec) — one row per carry-over, carrying `subscription_id`, `granted_by_user_id`, `reason`, `extension_seconds`, `granted_at`. Effective access end is computed as `current_period_end + SUM(extension_seconds)` where needed. The `subscription_extensions` table ships with RLS, a `BEFORE UPDATE OF` guard on `extension_seconds`, and service-role-only write access, consistent with spec 018's conventions.

### Functional Requirements — Teacher Absence

- **FR-014**: System MUST record a **teacher-absent** outcome distinctly from a student absence; a teacher-absent session MUST NOT be counted in the student's absence history and MUST NOT debit the student.
- **FR-015**: On teacher absence, the system MUST attempt to provide a **substitute** (if one is available per spec-020 assignment/availability) and reassign the session; if no substitute is available, it MUST record an **apology/compensation** outcome.
- **FR-016**: On teacher absence, the student's credit MUST be **preserved** — restored (reusing the existing restore path, idempotently) if it had already been debited — and the session preserved or carried for rescheduling; the student MUST be made whole.
- **FR-017**: Delivered teaching hours for a reassigned session MUST accrue to the **actual delivering** teacher (the substitute), never the originally-assigned absent teacher.

### Functional Requirements — Teacher Payroll

- **FR-018**: System MUST store a **configurable per-teacher hourly rate** (a field on the teacher profile or an equivalent per-teacher settings row), adjustable without a code deploy, varying per teacher.
- **FR-019**: System MUST track **delivered teaching hours** per teacher = sum over **actually-delivered** sessions of (session duration), attributing each session to its actual deliverer. Non-delivered sessions (no-show debited, cancelled, excused-not-yet-redelivered) MUST NOT accrue payable hours.
- **FR-020**: System MUST **aggregate delivered hours monthly** and, on a fixed **payroll run date** (default the **first of the following month**, stored as an adjustable setting), produce **exactly one payout per teacher** for the closed month equal to (delivered hours × applicable hourly rate).
- **FR-021**: The monthly payroll run MUST be **idempotent**: re-running for the same month MUST NOT create duplicate payouts (unique per teacher per payroll period).
- **FR-022**: System MUST persist a **payout ledger** recording, per payout: teacher, payroll period (month), aggregated hours, rate applied, computed amount (USD), payout status (e.g., pending/paid), and run timestamp. Payout amounts and hour counts are **financial** columns.
- **FR-023**: Payout amounts, aggregated hour counts, and the hourly rate MUST be protected from client mutation via the existing `BEFORE UPDATE OF` financial-column guard (service-role, migrations, and admin-via-own-session exempt); marking a payout paid MUST be restricted to admin/service-role.

### Functional Requirements — Data, RLS & Verification

- **FR-024**: Every new table MUST ship Row Level Security enabled with policies **in the same migration**, using the `( select auth.uid() )` initplan pattern: a student may read only their own attendance/excuse rows; a teacher may read attendance/excuses/payouts for their own sessions/self; the payout ledger is otherwise admin-only; **all financial/hour/outcome writes are service-role only** (no authenticated INSERT/UPDATE/DELETE on payout or credit-affecting columns). Excuse submission by a student is permitted only for their own upcoming sessions.
- **FR-025**: SECURITY DEFINER functions for outcome finalization, restore-on-carry, and payroll aggregation MUST follow the established **EXECUTE lockdown** (revoke from `public`/`anon`/`authenticated`; grant to `service_role` only), and MUST reuse — not redefine — `restore_student_package`/`refund_package_session` for credit restoration.
- **FR-026**: All monetary amounts MUST be USD and validated; rate and payout inputs MUST reject non-USD and negative values.
- **FR-027**: Regenerated database types MUST be produced for the new tables (`npm run db:types`) and the build/typecheck MUST pass.
- **FR-028**: Adjustable values (notice threshold, payroll run date, and any policy constants) MUST be stored as settings (`platform_settings` or equivalent), never hardcoded in application logic.

### Non-Functional / Security Requirements

- **NFR-001**: No credit restore, debit, extension, or payout side effect may occur outside the locked-down service-role functions; a learner or teacher MUST NOT be able to alter their own balance, excuse outcome, or payout via direct table writes.
- **NFR-002**: Any migration with money/grant/restore/payout logic MUST be **verified locally in Postgres** by simulating multiple cycles — debit→unexcused (stays lost), debit→excused (restored once, idempotent on retry), teacher-absent (restored, not counted as student absence), and a full month of delivered/non-delivered sessions through a payroll run (single payout, idempotent re-run) — before being considered done; `sb:advisors` MUST be clean for the new tables.
- **NFR-003**: The full check suite MUST pass: `tsc --noEmit`, `lint`, `test:unit`; the absence-branch logic, excuse eligibility boundary, carry-over restore idempotency, teacher-absent hold-harmless, and payroll aggregation/idempotency MUST be covered by unit/integration tests.
- **NFR-004**: All new UI (excuse submission, teacher excuse decisions, payroll views) MUST render correctly in Arabic RTL.

### Key Entities *(data involved)*

- **Attendance Record**: the resolved outcome of a scheduled session — links to the existing `sessions`/`bookings` row, the student, the (actual) teacher, the outcome (present/completed, student-absent, teacher-absent, excused-carried), and the resulting credit action (none/debited/restored). One per session.
- **Excuse Request**: a student's request against an upcoming session — reason, submission time, eligibility (eligible/late) vs the notice threshold, decision (pending/accepted/rejected), deciding teacher, decision time. Drives the carry-over branch.
- **Subscription-Period Extension** (`subscription_extensions` table, introduced Phase 0): one row per excused-carried session that earned an extension — `id`, `subscription_id` FK, `granted_by_user_id` FK, `reason`, `extension_seconds bigint`, `session_id` FK (audit + idempotency anchor), `granted_at`. Effective access end = `subscriptions.current_period_end + SUM(extension_seconds)`. The mirror column is never mutated.
- **Teacher Hourly Rate**: configurable per-teacher rate (profile field or per-teacher settings row), USD, adjustable without deploy.
- **Delivered-Hours Aggregation / Payroll Period**: per-teacher, per-month sum of delivered-session durations attributed to the actual deliverer; the basis for a payout.
- **Teacher Payout (ledger)**: one row per teacher per payroll month — hours, rate, USD amount, status (pending/paid), run timestamp. Financial columns guarded; admin/service-role writes only.
- **Reused entities**: `sessions`, `bookings` (status enum incl. `no_show`/`completed`/`cancelled`, `amount_usd`, `student_package_id`), `student_packages` (`sessions_used`/`sessions_total`/`status`), `profiles` (teacher), `platform_settings` (thresholds/run date), plus the existing `restore_student_package`/`refund_package_session`/`deduct_package_session`/`confirm_booking_with_session` kernel — **referenced, not redefined**.

---

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: For **100%** of student no-shows without an accepted eligible excuse, the credit remains consumed (lost) and is never restored — verified by reconciliation.
- **SC-002**: For **100%** of teacher-accepted eligible excuses, the exact originally-charged credit is restored **exactly once** and the session is flagged for rescheduling — **0** double-restores under retry.
- **SC-003**: An excuse submitted inside the notice threshold is marked ineligible in **100%** of cases and can never trigger a carry-over.
- **SC-004**: Every excused-carried subscriber session results in exactly one equivalent subscription/course-period extension; unexcused absences produce **0** extensions.
- **SC-005**: For **100%** of teacher-absent sessions, the student is held harmless — credit preserved, **0** student-absence counts, **0** student debits attributable to teacher absence.
- **SC-006**: Each monthly payroll run produces **exactly one** payout per teacher for the closed month equal to (delivered hours × rate), with **0** duplicate payouts on re-run and **0** payable hours from non-delivered sessions.
- **SC-007**: Delivered hours for any reassigned session accrue to the actual deliverer in **100%** of cases (never the absent teacher).
- **SC-008**: No learner or teacher can alter their own balance, excuse outcome, or payout via direct table writes — verified by an automated authorization/guard test (**0** successful unauthorized mutations).

---

## Assumptions

- **Reuses the existing debit/restore kernel**: excused carry-over and teacher-absence restoration go through the hardened `restore_student_package` (AFTER UPDATE → cancelled restores the exact charged package) / `refund_package_session`; unexcused absences leave the existing booking-cancellation debit in place. No new debit/restore primitive is introduced.
- **Reuses the booking lifecycle**: `bookings.status` already includes `no_show`, `completed`, and `cancelled`; attendance outcomes drive these existing transitions rather than inventing a parallel status.
- **Reuses RLS/guard conventions**: `( select auth.uid() )` initplan policies, `private.is_admin()`, `public.set_updated_at()`, PK uuid, FKs → `public.profiles(id)`, enums via `CREATE TYPE`, and the `BEFORE UPDATE OF` financial-column guard.
- **Adjustable values are settings**: the **2-hour** notice threshold and the **first-of-following-month** payroll run date are stored in `platform_settings` (or equivalent), not hardcoded; per-teacher hourly rate is a configurable per-teacher field.
- **Session duration is known**: each session carries (or derives) a duration (default 60 min per the plan, pending confirmation in scheduling) used both for hour accrual and extension sizing.
- **Substitute availability comes from spec 020**: the substitute-selection/assignment and availability data are owned by spec 020; this spec consumes them and only records the outcome and hour attribution.
- **Subscription period comes from spec 018** (read-only): `subscriptions.current_period_end` is the Stripe mirror and MUST NOT be mutated. Carry-over extensions are recorded in `subscription_extensions` (owned by this spec, Phase 0); effective end = mirror + SUM of extension rows. No clarification outstanding — the mechanism is fully specified in FR-013 and the Key Entities section.
- **Migration topology**: new timestamped migrations land in `supabase/migrations/` after the `20260428000000_remote_baseline.sql` baseline; the baseline is never `db push`ed; RLS ships in the same migration as each table.
- **Single-student scheduled sessions are the primary attendance subject**; instant/specialized single-session attendance specifics are owned by spec 022.
- **Coexistence during build**: developed alongside the still-live legacy booking system; the old path is retired only at cutover (spec 024).

## Dependencies

- **Spec 018** (subscription billing foundation): the subscription/course period this spec extends for carry-over compensation; the `payments`/billing-event primitives. **Hard dependency** for Story 3.
- **Spec 020** (scheduling/cohorts): when sessions are created and seated, teacher assignment, and substitute availability consumed by teacher-absence handling.
- **Spec 019** (catalog/credits): credit/package sizing semantics that determine what a restored credit represents.
- Existing tables: `sessions`, `bookings`, `student_packages`, `packages`, `profiles`, `platform_settings`, `payments`.
- Existing functions (referenced, not redefined): `restore_student_package`, `refund_package_session`, `deduct_package_session`, `confirm_booking_with_session`, `private.is_admin()`, `public.set_updated_at()`.
- **Blocks**: downstream notification content (spec 023) consumes the absence/excuse/payroll domain events emitted here; spec 024 migration converts legacy attendance/payout state.
