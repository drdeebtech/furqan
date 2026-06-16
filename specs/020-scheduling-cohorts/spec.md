# Feature Specification: Scheduling, Fixed-Teacher Assignment & Cohorts/Halaqas

**Feature Branch**: `020-scheduling-cohorts`
**Created**: 2026-06-16
**Status**: Draft
**Phase**: م٣ (Scheduling, fixed-teacher assignment, and group cohorts) of the Subscription + Courses Pivot
**Plan**: `/home/drdeeb/.claude/plans/you-are-acting-as-shimmering-cray.md`
**Input**: Define how subscribers are scheduled under the new subscription model — fixed-teacher assignment for individual hifz, student-chosen sessions from the assigned teacher's published availability, fixed pre-set schedules for group halaqas and courses, automatic new-cohort opening on overflow, and product-specific level/program handling — reusing the existing booking, availability, and cohort tables rather than rebuilding them.

---

## Context & Scope

The current platform lets a student **book any teacher freely** from a marketplace of slots. The approved pivot (decisions #6, #12, #20, #28, #33, #34, #38) **replaces** that with **product-specific scheduling**:

- **Individual hifz (product a-individual)** — the student is bound to one **fixed assigned teacher** for the subscription month; the teacher publishes available slots, and the student picks their sessions only from that teacher's slots.
- **Group hifz (a-group / b-group)** — a **fixed, pre-set schedule** that all cohort members follow; the only per-member variance is attendance/absence.
- **Defined memorization & other courses (c)** — a **fixed schedule** set by the assigned specialist teacher from the course's start.

This spec governs **who teaches whom, when sessions exist, and how a learner gets onto the schedule**. It reuses the existing `bookings`, `teacher_availability`, `class_offerings`, `sessions`, `session_participants`, and `halaqa_waiting_list` tables. It introduces **one new entity** — the fixed student↔teacher assignment for a subscription — and adapts the existing flow to the new constraints.

This spec **creates bookings and cohort memberships only**. The **session debit** (consuming a granted credit) continues to flow through the **existing, hardened kernel** (`deduct_package_session`, `confirm_booking_with_session` fail-closed, `start_instant_session_booking`, `restore_student_package`) owned by specs 018/019 — referenced here, **never redefined**.

**In scope:**
- Fixed student↔teacher assignment entity for a subscription (with admin-approved mid-month change).
- Student picking individual sessions from the assigned teacher's published availability (booking constrained to that teacher).
- Teacher availability publishing and lock-when-full for individual hifz.
- Fixed pre-set group/course schedules that members follow.
- Cohort (halaqa) membership, cohort-start below target, and **opening a new cohort on overflow** instead of waitlisting.
- Product-specific level/program handling: custom per-student program (individual), self-selected halaqa (group), entry conditions (courses c).
- RLS + financial/identity guards on the new assignment table and the adapted scheduling writes.

**Explicitly out of scope (owned by other specs):**
- Subscription/grant/billing rails, dunning, Stripe → **spec 018** (م١).
- Pricing catalog, the 6 tiers, single-active-hifz rule, family discounts, proration, **monthly credit grants** → **spec 019** (م٢).
- Attendance/absence marking, excuse acceptance, carry-forward compensation, teacher-hour tracking, payroll → **spec 021** (م٤).
- Assessment session, instant/specialized single sessions (product d) → **spec 022** (م٥).
- Reports, gamification, certificates, and notification *content/channels* (in-app/email/WhatsApp via n8n) → **spec 023** (م٦); this spec only **emits** schedule/assignment events for them to consume.
- Existing-user migration & cutover → **spec 024** (م٧).

**Three lenses** (per AGENTS.md §1):
- 🛠 **Engineer**: reuse `bookings`/`teacher_availability`/`class_offerings`/`session_participants`/`halaqa_waiting_list`; do not rebuild scheduling; constrain bookings to the assigned teacher server-side; RLS + identity guards in the same migration; fail-closed.
- 📖 **Quran teacher**: the fixed-teacher relationship and per-student program are the pedagogical core of hifz; level handling differs by product (no single rigid scale); program/level data is teacher-authored, never model-generated, and any `surah:ayah` stays exact.
- 🎓 **Platform expert**: a learner must clearly see their assigned teacher and open slots, self-select the right juz circle, and never be turned away when a cohort fills — a new circle opens instead.

---

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Individual hifz subscriber picks sessions from their fixed assigned teacher (Priority: P1)

A student on an individual hifz subscription has one fixed assigned teacher for the month. That teacher publishes their available weekly slots; the student picks their month's sessions only from those slots, and each booking is bound to the assigned teacher.

**Why this priority**: Without constrained booking against a fixed teacher, the subscription's defining promise (a consistent teacher and a coherent program) does not exist. This is the minimum viable scheduling slice for the largest product.

**Independent Test**: Assign a teacher to an individual-hifz subscriber; have the teacher publish availability; the student books sessions from those slots; verify every booking references the assigned teacher, a booking against any other teacher is rejected, and slots become unavailable once taken.

**Acceptance Scenarios**:

1. **Given** an individual-hifz subscriber with a fixed assigned teacher and that teacher's published availability, **When** the student selects an open slot, **Then** a booking is created bound to the assigned teacher for that time, and the slot is no longer offered to others.
2. **Given** the same subscriber, **When** a request attempts to book a slot belonging to **any teacher other than the assigned one**, **Then** the request is rejected (booking constrained to the assigned teacher).
3. **Given** a teacher whose published slots are all taken, **When** another student tries to book that teacher, **Then** no slot is available (availability locks when full — no hard numeric cap, just slot exhaustion).
4. **Given** a created booking, **When** it is confirmed, **Then** the credit debit proceeds through the **existing** booking-confirmation kernel (not redefined here), and identity columns (teacher/student/grant linkage) cannot be altered by the client.

---

### User Story 2 - Group hifz subscriber joins a fixed-schedule halaqa, and a full halaqa opens a new one (Priority: P1)

A student on a group hifz subscription self-selects the appropriate halaqa (e.g., the juz they want), joins its fixed pre-set schedule, and follows it with the rest of the cohort. When a halaqa reaches capacity, the system opens a **new** halaqa instead of putting the student on a waiting list.

**Why this priority**: Group halaqas are a core product and the overflow-opens-a-new-circle rule (#34) is an explicit, learner-facing promise that differs sharply from the current waitlist behavior. Equal P1 with Story 1.

**Independent Test**: Create a halaqa with a fixed schedule and a target capacity; enroll students up to capacity, then enroll one more; verify the cohort started even below target, the overflow enrollment lands in a newly opened halaqa (not the waiting list), and all members of a halaqa share the same fixed schedule.

**Acceptance Scenarios**:

1. **Given** an open group-hifz halaqa with a fixed schedule and available seats, **When** a subscriber self-selects and joins it, **Then** they become a member following that halaqa's fixed pre-set schedule (no per-member slot picking).
2. **Given** a halaqa configured to start with fewer than its target number, **When** the start time arrives below target, **Then** the halaqa **still starts** (no blocking minimum, per #33).
3. **Given** a halaqa at capacity, **When** another eligible subscriber tries to join, **Then** a **new** halaqa is opened (or an existing not-full sibling is used) and the student joins it — they are **not** placed on a waiting list (per #34).
4. **Given** halaqa membership, **When** the schedule's session occurs, **Then** members are tracked via the existing cohort-membership mechanism, and only attendance/absence varies per member (absence handling itself is spec 021).

---

### User Story 3 - Course (c) subscriber follows the specialist teacher's fixed course schedule (Priority: P2)

A student enrolled in a course (tajweed/matn or a defined memorization course) follows a fixed schedule set by the assigned specialist teacher from the course's start. The teacher is assigned (no student teacher-choice for courses), and some courses have entry conditions the specialist sets.

**Why this priority**: Courses are a distinct, lower-volume product than open-ended hifz; the platform is viable for the hifz products first. P2.

**Independent Test**: Create a course with an assigned specialist teacher, a fixed schedule, and (optionally) entry conditions; enroll a qualifying student and reject a non-qualifying one; verify the student follows the fixed schedule and cannot choose a different teacher.

**Acceptance Scenarios**:

1. **Given** a course with an assigned specialist teacher and a fixed schedule, **When** a student enrolls, **Then** they follow that fixed schedule and the teacher is the assigned specialist (no student teacher-selection).
2. **Given** a course with entry conditions set by the specialist, **When** a student who does not meet them tries to enroll, **Then** enrollment is rejected with the unmet condition surfaced; a qualifying student is accepted.
3. **Given** an enrolled course student, **When** they attempt to change the assigned teacher, **Then** the change is not permitted via self-service (courses have no student teacher-choice).

---

### User Story 4 - Teacher choice is locked during the month and changes only at renewal (Priority: P2)

For an individual hifz package, the **student** chose the teacher; that choice is **locked for the month** and can be changed only after the month ends (at renewal). A mid-month teacher change is allowed only with **admin approval** (e.g., incompatibility).

**Why this priority**: This fairness/continuity rule protects both the learner's program and teacher scheduling; it is important but the product functions with the default lock before the exception path is built. P2.

**Independent Test**: Lock a teacher assignment to a month; attempt a self-service change mid-month (rejected); attempt the same change after the month ends (allowed); attempt a mid-month change with admin approval (allowed, audited).

**Acceptance Scenarios**:

1. **Given** an individual-hifz subscriber whose teacher is assigned for the current month, **When** they request a teacher change mid-month via self-service, **Then** the request is rejected (assignment locked for the month).
2. **Given** the month has ended (renewal), **When** the student selects a different teacher, **Then** the new assignment takes effect for the new month.
3. **Given** a mid-month incompatibility, **When** an **admin** approves a teacher change, **Then** the assignment is reassigned mid-month, recorded with the approving actor, and future bookings bind to the new teacher (per #38).
4. **Given** any teacher reassignment, **When** it occurs, **Then** already-scheduled future sessions are handled deterministically (re-pointed to the new teacher or cancelled for rebooking) and the change is auditable.

---

### User Story 5 - Admin oversees assignments, cohorts, and capacity (Priority: P3)

An admin can view and manage fixed teacher assignments, cohort rosters and their schedules, capacity/overflow state, and approve exception teacher changes — for support, dispute resolution, and operations.

**Why this priority**: Operability matters for cutover but not for the first scheduled session. P3.

**Independent Test**: As an admin, inspect a subscriber's current assignment and a halaqa's roster/schedule/capacity; approve a mid-month teacher change; verify each action is permitted and audited while a non-admin cannot.

**Acceptance Scenarios**:

1. **Given** an admin, **When** they inspect a subscriber, **Then** they see the current fixed teacher assignment, its lock window, and assignment history.
2. **Given** an admin, **When** they inspect a halaqa, **Then** they see its fixed schedule, roster, capacity, and whether overflow opened a sibling cohort.
3. **Given** a non-admin, **When** they attempt any of the admin-only scheduling/assignment actions, **Then** the action is rejected by policy.

---

### Edge Cases

- **Booking against the wrong teacher**: an individual-hifz student must never create a booking for a teacher other than their assigned one — the constraint is enforced server-side from the authenticated session, not from request input.
- **Assigned teacher publishes no availability**: the student has no slots to pick; the system surfaces "no availability" rather than allowing an unconstrained marketplace fallback.
- **Slot double-book race**: two students (or two tabs) selecting the last open slot of the assigned teacher concurrently — exactly one booking succeeds; the other is rejected without creating a phantom debit.
- **Cohort fills mid-enrollment**: a halaqa reaches capacity between a student seeing a seat and confirming — overflow opens/uses a new halaqa rather than failing or waitlisting.
- **Halaqa starts under target then a late joiner arrives**: a below-target cohort that has already started must still accept eligible joiners (up to capacity) without "restarting."
- **Mid-month teacher change with future bookings**: reassigning a teacher (admin-approved) must deterministically resolve already-scheduled future sessions; no session may be left pointing at the old teacher silently.
- **Teacher-choice attempt for a course**: a course (b/c) student attempting to choose/change a teacher must be rejected (courses are teacher-assigned).
- **Group member tries to pick individual slots**: a group-product member cannot book ad-hoc individual slots from the assigned teacher's availability — their schedule is the fixed cohort schedule only.
- **Assignment without an active hifz subscription**: a fixed teacher assignment must require an active in-scope subscription/grant; it must not grant scheduling rights on its own (the grant/eligibility source of truth is specs 018/019).
- **Waiting-list legacy data**: `halaqa_waiting_list` exists from the prior model; under the new overflow-opens-new-cohort rule it must not be the path for group-hifz overflow (its disposition for legacy/other modes is noted, full migration is spec 024).
- **Course entry conditions are unmet for a borderline student**: the unmet condition is surfaced; the specialist (not a model) authored the condition and is the authority.

---

## Requirements *(mandatory)*

### Functional Requirements — Fixed Assignment & Teacher Choice

- **FR-001**: System MUST persist a **fixed student↔teacher assignment** for an in-scope hifz subscription, recording: the student, the assigned teacher, the owning subscription/grant reference, the product type (individual vs group), the lock window (the month the assignment is locked to), an active flag, and the actor who created/changed it. The assignment is the binding answer to "who teaches this student this month."
- **FR-002**: For individual hifz (product a-individual), the **student** MUST select the assigned teacher at the start of a subscription month; for courses (products b, c) the teacher MUST be **assigned** (no student teacher-selection).
- **FR-003**: A teacher assignment MUST be **locked during the active month**: self-service teacher changes MUST be rejected mid-month; a change MUST be permitted only after the month ends (at renewal).
- **FR-004**: A **mid-month** teacher change MUST be permitted only with **admin approval**, MUST record the approving admin, and MUST be auditable (per #38).
- **FR-005**: A fixed teacher assignment MUST require an **active in-scope subscription/grant** (eligibility owned by specs 018/019); the assignment alone MUST NOT confer scheduling rights without that eligibility.
- **FR-006**: On teacher reassignment (renewal or admin-approved mid-month), the system MUST resolve already-scheduled future sessions deterministically (re-point to the new teacher or cancel for rebooking) so no future session silently references the prior teacher.

### Functional Requirements — Individual Scheduling (availability-driven)

- **FR-007**: Teachers MUST be able to publish their **available recurring slots** using the existing availability mechanism; published slots define when an individually-assigned student may book.
- **FR-008**: An individual-hifz student MUST be able to create a session booking **only from their assigned teacher's** published, still-open slots; a booking request targeting any other teacher MUST be rejected, with the teacher/student identity derived from the **authenticated session, never from request input**.
- **FR-009**: Availability MUST **lock when full**: once a published slot is taken it MUST NOT be offered again; there is **no hard numeric capacity cap** for individual scheduling — availability exhaustion is the limit (per #28).
- **FR-010**: Concurrent attempts to book the **last open slot** MUST result in **at most one** successful booking; the losing attempt MUST be rejected without creating a booking or any debit.
- **FR-011**: Booking creation under this spec MUST stop at producing a `pending`/`confirmed` booking; the **session credit debit MUST flow through the existing confirmation kernel** (fail-closed, atomic) owned by specs 018/019 and MUST NOT be re-implemented here.

### Functional Requirements — Group Cohorts & Courses (fixed schedule)

- **FR-012**: Group-hifz halaqas and courses MUST follow a **fixed, pre-set schedule** defined for the cohort/course; members MUST NOT pick individual slots — the only per-member variance is attendance/absence (handled in spec 021).
- **FR-013**: A group-hifz student MUST be able to **self-select** an appropriate halaqa (e.g., by juz/level) and join it; the system records cohort membership via the existing cohort-membership mechanism.
- **FR-014**: A halaqa MUST be able to **start below its target number** of members — there is **no blocking minimum** (per #33).
- **FR-015**: When a halaqa is **at capacity**, the system MUST place an additional eligible joiner into a **newly opened** halaqa (or an existing not-full sibling cohort) — it MUST NOT add them to a waiting list (per #34).
- **FR-016**: For courses (c), the **assigned specialist teacher** MUST set the fixed schedule from the course start, and the system MUST support optional **entry conditions** set by that specialist; a student not meeting an entry condition MUST be rejected from enrollment with the unmet condition surfaced.
- **FR-017**: Level/program handling MUST be **product-specific**: individual hifz requires **no level** and uses a **teacher-authored custom program per student**; group hifz uses **student self-selection** of the halaqa; courses (c) may impose **specialist-set entry conditions** (per #20). Program/level content MUST be authored by the teacher, never model-generated.

### Functional Requirements — Security, RLS & Events

- **FR-018**: The new assignment table MUST ship **Row Level Security enabled with policies in the same migration**: a student may read only their own assignment rows; teachers may read assignments where they are the assigned teacher; admins/moderators may read all; **privileged writes** (create/lock/reassign) are restricted to service-role/admin paths — a student MUST NOT self-assign or self-reassign a teacher.
- **FR-019**: Identity/eligibility columns on the new assignment (student, teacher, subscription/grant linkage, lock window) MUST be protected from client mutation following the existing `BEFORE UPDATE OF` guard pattern (service-role and migrations exempt; admins via their own session permitted), so a learner cannot change who teaches them or the lock window.
- **FR-020**: All scheduling writes adapted by this spec (constrained booking creation, cohort membership) MUST continue to derive `userId`/teacher identity from the **authenticated session** and MUST keep the existing booking identity guards intact (no regression of the current `bookings`/`session_participants` protections).
- **FR-021**: The system MUST **emit schedule/assignment events** (assignment created/changed, cohort opened, member joined, booking created) for downstream consumers (notifications spec 023, attendance spec 021) without itself sending any notification or computing payroll.
- **FR-022**: Regenerated database types MUST be produced for the new table(s) (`npm run db:types`) and the build/typecheck MUST pass; `sb:advisors` MUST be clean for the new/changed tables.

### Non-Functional / Security Requirements

- **NFR-001**: No booking against a non-assigned teacher may be creatable by any client path — enforced server-side, verified by an automated test (a forged `teacher_id` in input MUST NOT bind a session to the wrong teacher).
- **NFR-002**: Any SECURITY DEFINER function added for assignment/overflow logic MUST follow the established EXECUTE lockdown (revoke from `public`/`anon`/`authenticated`; grant to `service_role` only, or to the specific privileged role).
- **NFR-003**: Concurrency for last-slot booking and capacity/overflow decisions MUST be race-safe (no double-book, no over-capacity cohort, no duplicate sibling-cohort storm) — verified locally in Postgres by simulating concurrent enrollment/booking before "done."
- **NFR-004**: Every scheduling/assignment surface MUST render correctly in **Arabic RTL** (teacher picker, slot picker, halaqa selector, course schedule).
- **NFR-005**: The full check suite MUST pass: `tsc --noEmit`, `lint`, `test:unit`; constrained-booking, overflow-opens-new-cohort, and teacher-lock paths covered by unit/integration tests.

### Key Entities *(data involved)*

- **Fixed Teacher Assignment** *(new)*: binds a student to one teacher for an in-scope hifz subscription month — student, assigned teacher, subscription/grant reference, product type, lock window (month), active flag, creating/approving actor. Relationships: belongs to a student and a teacher (both `profiles`), references a subscription/grant (specs 018/019), governs which teacher a booking may bind to.
- **Teacher Availability** *(reused — `teacher_availability`)*: recurring weekly slots (teacher, day-of-week, start/end time, slot duration, active) defining when an individually-assigned student may book.
- **Booking** *(reused — `bookings`)*: a `pending`/`confirmed` session reservation (student, teacher, scheduled time, status, `student_package_id`, optional `class_offering_id`/`session_id`) — under this spec constrained to the assigned teacher for individual hifz; debit owned by the existing kernel.
- **Cohort / Halaqa** *(reused — `class_offerings` + `sessions` with halaqa mode)*: a fixed-schedule group with a teacher, schedule, and capacity; siblings are opened on overflow.
- **Cohort Membership** *(reused — `session_participants`)*: a learner's enrollment in a halaqa/cohort, following its fixed schedule; per-member variance is attendance only (spec 021).
- **Course** *(reused — `class_offerings` / existing course/lesson system)*: a specialist-assigned, fixed-schedule offering with optional entry conditions.

---

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: For an individual-hifz subscriber, **100%** of created bookings reference the **assigned teacher**, and **0** bookings against any other teacher can be created — verified by an automated test including a forged-input attempt.
- **SC-002**: When an assigned teacher's published slots are exhausted, **0** further bookings against that teacher succeed (availability locks when full), with **no** marketplace fallback.
- **SC-003**: Concurrent attempts on the last open slot yield **exactly one** booking and **0** phantom debits, across repeated race simulations.
- **SC-004**: A halaqa reaching capacity results in a **new** halaqa opening (or a not-full sibling used) for the next joiner in **100%** of overflow cases, and **0** group-hifz overflow joiners are placed on a waiting list.
- **SC-005**: A below-target halaqa **starts** in **100%** of cases at its scheduled start time (no blocking minimum).
- **SC-006**: A self-service mid-month teacher change is rejected in **100%** of attempts; an after-month change succeeds; an admin-approved mid-month change succeeds and is recorded with the approving actor — all verifiable by test.
- **SC-007**: Enrollment in a course with entry conditions accepts **100%** of qualifying students and rejects **100%** of non-qualifying ones, with the unmet condition surfaced.
- **SC-008**: All new/adapted scheduling surfaces render correctly in Arabic RTL (manual RTL pass), and `sb:advisors` is clean for the new/changed tables.

## Assumptions

- **Reuses existing scheduling tables** (no rebuild): `teacher_availability` (recurring weekly slots; unique `avail_unique` on teacher+day+start), `bookings` (status enum `pending`/`confirmed`/`completed`/`cancelled`/`no_show`; `teacher_id`, `student_id`, `student_package_id`, `class_offering_id`, `session_id`; existing identity guards from `20260613140000`/`20260612120004`), `class_offerings` (group definitions; `class_offerings_set_updated_at` trigger; capacity 2–20; status open/full/confirmed/cancelled/completed), `sessions` (with `session_mode` private/halaqa/lecture, `capacity`, `current_enrollment`, `min_participants`), `session_participants` (cohort membership; gated by `session_participant_secdef` from `20260613120000`), and `halaqa_waiting_list` (legacy queue — **not** the path for group-hifz overflow under #34).
- **The only new table is the fixed teacher assignment**; cohorts and memberships reuse `class_offerings`/`sessions`/`session_participants`.
- **The session debit is owned elsewhere**: this spec creates bookings/memberships; consuming a credit flows through the existing kernel (`deduct_package_session`, `confirm_booking_with_session` fail-closed, `restore_student_package`) — unchanged by this spec.
- **Eligibility/grants come from specs 018/019**: an assignment requires an active in-scope subscription/grant; this spec does not define grants, tiers, or proration.
- **Reuses RLS/guard conventions**: `( select auth.uid() )` initplan policies, `private.is_admin()` / `is_admin_or_mod()`, `public.set_updated_at()`, and the `BEFORE UPDATE OF` identity guard; PK `uuid`; FKs → `public.profiles(id)`; enums via `CREATE TYPE`.
- **Migration topology**: new timestamped migrations land in `supabase/migrations/` after the `20260428000000_remote_baseline.sql` baseline (latest applied is `20260615150000_rls_initplan_optimize.sql`); RLS policies ship in the same migration as each new table; the baseline is never `db push`ed.
- **Coexistence during build**: the new constrained-scheduling path is built alongside the still-live marketplace booking; the old free-booking path is retired only at cutover (spec 024). This spec does not remove the existing booking/availability code.
- **Default individual session duration** is assumed 60 minutes per the plan (to be confirmed in catalog spec 019); durations are data, not hardcoded here.
- **Adjustable values** (cohort target/capacity, lock-window semantics) are configuration/data (e.g., `class_offerings.capacity`, `platform_settings`), not hardcoded in logic.

## Dependencies

- **Spec 018** (subscription/grant primitives) and **spec 019** (catalog, monthly credits, single-active-hifz rule) — the assignment references an active subscription/grant; **blocks** this spec.
- Existing tables: `bookings`, `teacher_availability`, `class_offerings`, `sessions`, `session_participants`, `halaqa_waiting_list`, `student_packages`, `profiles`, `platform_settings`.
- Existing kernel functions: `deduct_package_session`, `confirm_booking_with_session`, `start_instant_session_booking`, `restore_student_package`, `session_participant_secdef` (debit/membership — reused, not modified here).
- Existing guards: booking identity guard (`20260613140000`), student self-confirm block (`20260612120004`).
- **Blocks**: spec 021 (attendance/payroll consumes the schedule and cohort rosters), spec 023 (notifications consume the emitted schedule/assignment events).

### Open Clarifications

- **Teacher change booking behavior** *(resolved)*: On admin-approved mid-month teacher change (initiated by student/guardian request with stated reason), future bookings are **cancelled**; the student rebooks from the new teacher's published availability. Rationale: the new teacher's schedule may differ; cancel-and-rebook avoids phantom bookings on mismatched slots.
- **Halaqa overflow sibling preference** *(resolved)*: When a not-full sibling halaqa of the same juz/level exists, **prefer filling it** before opening a new one. A new halaqa opens only when no suitable not-full sibling exists. Rationale: prevents halaqa proliferation and keeps group sizes healthy.

## Clarifications

### Session 2026-06-16 (analyze remediation)

- Q: Do `class_offerings` have program_level / schedule_json / session_duration_min / start_date / entry_conditions_json? → A: VERIFIED ABSENT in local DB on 2026-06-16 (only `capacity` and `status` exist). This spec's migration MUST ALTER `class_offerings` to add these 5 columns before any logic references them. (Requires a tasks-regen pass to add the ALTER task.)
- Q: Catalog product codes vs `product_type` enum? → A: map explicitly in data-model — a-individual→hifz_individual, b→hifz_group, c→course.
- Q: Recurring availability slot locking? → A: materialize recurring `teacher_availability` templates into dated bookable instances; `is_booked` applies per instance, not to the recurring template.
- Q: Sibling-fill ordering? → A: `ORDER BY current_enrollment DESC` (least-empty-first); align research R-003 which lacked an ORDER BY.
