# Tasks: Scheduling, Fixed-Teacher Assignment & Cohorts (Spec 020)

**Input**: `specs/020-scheduling-cohorts/` (spec.md, plan.md, data-model.md, research.md, contracts/api.md)
**Branch**: `020-scheduling-cohorts` (cut from `019-catalog-credit-redesign` after merge)
**Prerequisites**: specs 018 + 019 merged — `subscriptions`, `subscription_plans`, `student_packages`, `bookings`, `teacher_availability`, `class_offerings`, `session_participants` must exist.

---

## Phase 1: Setup

- [ ] T001 Verify branch cut from `019-catalog-credit-redesign` (or main after merge); confirm `bookings`, `teacher_availability`, `class_offerings`, `session_participants` tables exist locally
- [ ] T002 Verify existing booking identity guard migrations present: `20260613140000` and `20260612120004`

**Checkpoint**: `npx tsc --noEmit` + `npm run lint` pass on current codebase.

---

## Phase 2: Foundational — DB Migrations

**⚠️ CRITICAL**: All user story work blocked until T005 (`npm run db:types`) completes.

- [x] T002a Create `supabase/migrations/20260617990000_class_offerings_extend.sql` — **applies BEFORE T003** (earlier timestamp):
  - **VERIFIED 2026-06-16 against local schema**: `class_offerings` currently has only `capacity` + `status`; the 5 columns below are ABSENT and assumed by T003/T004/T018.
  - `ALTER TABLE class_offerings ADD COLUMN IF NOT EXISTS program_level text, ADD COLUMN IF NOT EXISTS schedule_json jsonb, ADD COLUMN IF NOT EXISTS session_duration_min integer, ADD COLUMN IF NOT EXISTS start_date date, ADD COLUMN IF NOT EXISTS entry_conditions_json jsonb`
  - Existing rows get NULL (no legacy local course offerings); a NULL `program_level` is excluded from sibling matching (document in fn). **Guard at creation** (data-model §2c): because a NULL `program_level` can never match/become a sibling (SQL NULL semantics) and would strand overflow joiners, `program_level` MUST be required when creating any overflow-eligible group/course offering — enforce in the offering-create path now and add a `CHECK`/`NOT NULL` once legacy NULL rows are backfilled.
  - Preconditions enabled: T003 `idx_class_offerings_sibling` (needs `program_level`), T004 `open_overflow_halaqa` (sibling match on `program_level`), T018 `entry_conditions_json`, session scheduling (`schedule_json`/`session_duration_min`/`start_date`). See spec Clarifications §2026-06-16.

- [x] T003 Create `supabase/migrations/20260618000000_scheduling_teacher_assignment.sql`:
  - CREATE TABLE `subscription_teacher_assignments` (all columns per data-model.md: id, student_id FK, teacher_id FK, subscription_id FK, product_type CHECK, lock_month date, is_active boolean DEFAULT true, approved_by FK nullable, cancelled_future_bookings_at timestamptz, created_at, updated_at)
  - CREATE TRIGGER `set_updated_at_sta` BEFORE UPDATE using existing `public.set_updated_at()`
  - CREATE UNIQUE INDEX `uix_sta_student_active ON subscription_teacher_assignments(student_id) WHERE is_active = true`
  - CREATE INDEX `idx_sta_student` WHERE is_active; CREATE INDEX `idx_sta_teacher` WHERE is_active
  - RLS ENABLE; 4 policies: student SELECT own `(select auth.uid())`, teacher SELECT own, admin/mod SELECT all, service_role INSERT, service_role+admin UPDATE
  - BEFORE UPDATE trigger `sta_identity_guard` on (student_id, subscription_id, product_type, lock_month) — blocked
  - ADD INDEX `idx_class_offerings_sibling ON class_offerings(teacher_id, program_level, status)` for sibling lookup (requires `program_level` from T002a)

- [x] T003a Create `supabase/migrations/20260617990001_availability_instances.sql` — dated slot-instance materialization (Clarifications §2026-06-16; data-model §2a-bis). Timestamp sorts right after T002a and before T003/T004 (independent table; depends only on baseline `teacher_availability`):
  - CREATE TABLE `teacher_availability_instances` (id uuid PK, template_id uuid FK `teacher_availability`, teacher_id uuid FK profiles, slot_date date, start_time time, end_time time, is_booked boolean DEFAULT false, created_at)
  - UNIQUE `(template_id, slot_date)` — idempotent materialization, no duplicate dated instances
  - Index on `(teacher_id, slot_date) WHERE is_booked = false` for open-slot lookup
  - RLS ENABLE in the same migration: authenticated SELECT of instances for an assigned teacher; service_role INSERT/UPDATE (materialization + booking lock run service-side)
  - Provide the **generation rule** as a SECURITY DEFINER fn `materialize_availability_instances(p_horizon_end date)` that, for each active `teacher_availability` template, INSERTs one instance per matching `day_of_week` date up to the horizon, `ON CONFLICT (template_id, slot_date) DO NOTHING`; REVOKE EXECUTE FROM public/anon/authenticated, GRANT service_role (NFR-002)
  - Note: the recurring template's legacy `is_booked` is deprecated for booking decisions; the dated instance's `is_booked` is authoritative

- [x] T004 Create `supabase/migrations/20260618000001_overflow_halaqa_fn.sql`:
  - CREATE OR REPLACE FUNCTION `open_overflow_halaqa(p_source_offering_id uuid) RETURNS uuid` — SECURITY DEFINER SET search_path = public; FOR SHARE on source; prefer not-full sibling (same teacher_id + program_level + status='open' + current_enrollment < capacity) `ORDER BY current_enrollment DESC LIMIT 1` (least-empty first; deterministic — matches data-model §3 / research R-003); else INSERT new class_offerings row cloning source
  - Sibling SELECT keys on `program_level = v_source.program_level`; a NULL `program_level` never matches (SQL NULL semantics) — see data-model §2c NULL-guard; offering creation MUST require `program_level` for overflow-eligible offerings
  - So the caller can emit `cohort_opened` only on an actual open (FR-021 / T015): return enough to distinguish new-clone vs reused-sibling (e.g. a `(halaqa_id, was_created boolean)` record, or expose a companion that reports it) — do not fire `cohort_opened` on sibling reuse
  - REVOKE EXECUTE FROM public, anon, authenticated; GRANT TO service_role

- [x] T005 `supabase migration up` → `npm run db:types` → commit regenerated `src/types/database.ts`

- [ ] T006 Local concurrency verification (NFR-003):
  - Concurrent double-assignment insert: two transactions both try `INSERT INTO subscription_teacher_assignments (student_id=X, is_active=true, ...)` → unique index blocks second
  - Concurrent last-slot booking: two concurrent transactions on the same **dated `teacher_availability_instances` row** with `FOR UPDATE` → exactly one booking created (the recurring template is never the lock target)
  - Concurrent overflow: two students join same full halaqa simultaneously → each lands in halaqa (sibling or new), no duplicate clone created

**Checkpoint**: `npm run sb:advisors` clean for new table; `npx tsc --noEmit` passes.

---

## Phase 3: User Story 1 — Individual Booking Constrained to Assigned Teacher (P1) 🎯 MVP

**Goal**: Student can only book their assigned teacher's open slots; any other teacher → 403.

**Independent Test**: Create assignment → teacher publishes slot → student books → `booking.teacher_id = assignment.teacher_id`. Then attempt booking from different teacher's slot → 403.

- [x] T007 [P] [US1] Create `src/lib/domains/scheduling/assignments.ts`:
  - `getMyAssignment(userId: string): Promise<Assignment | null>` — queries `subscription_teacher_assignments WHERE student_id = userId AND is_active = true`; joins `profiles` for teacher name/name_ar
  - `createAssignment(input: AssignTeacherInput): Promise<string>` — service-role client INSERT

- [x] T008 [P] [US1] Create `src/lib/domains/scheduling/availability.ts` (operates on **dated instances**, not recurring templates — Clarifications §2026-06-16 / data-model §2a-bis):
  - `getOpenSlots(teacherId: string, month?: string): Promise<AvailabilitySlot[]>` — queries `teacher_availability_instances WHERE teacher_id = teacherId AND is_booked = false` joined to the active template, for the given month/horizon (ensure instances are materialized for the horizon first, via T003a's generation fn)
  - `lockSlot(slotInstanceId: string): Promise<boolean>` — locks **one dated instance**: `SELECT ... FROM teacher_availability_instances WHERE id = slotInstanceId AND is_booked = false FOR UPDATE`; UPDATE that instance `is_booked = true`; returns false if already booked. (Locks the dated instance, NOT the weekly template.)

- [x] T009 [P] [US1] Create `src/lib/domains/scheduling/bookings.ts`:
  - `createConstrainedBooking(userId: string, slotInstanceId: string, scheduledAt: string): Promise<string>` — gets assignment; gets dated slot-instance teacher; validates match; calls `lockSlot(slotInstanceId)` (dated instance); INSERTs `bookings` row with `status='pending'`; returns bookingId
  - **Emit `booking_created` event** (FR-021) after the booking row is committed — enqueue for spec 023 consumers using the typed event enum (spec 023); do not send any notification here

- [x] T010 [US1] Create `src/app/api/scheduling/my-assignment/route.ts` — GET, auth required, zod response, calls `getMyAssignment`

- [x] T011 [US1] Create `src/app/api/scheduling/available-slots/route.ts` — GET, auth required, zod query params, resolves assigned teacher if teacherId omitted, calls `getOpenSlots`

- [x] T012 [US1] Create `src/app/api/scheduling/book-slot/route.ts` — POST, auth required, zod input, calls `createConstrainedBooking`; maps errors to 403/409/404

- [x] T013 [US1] Create `src/app/api/scheduling/assign-teacher/route.ts` — POST, admin/service-role only, zod input, calls `createAssignment`; 409 on unique index violation

- [x] T014 [US1] Unit test `src/lib/domains/scheduling/bookings.test.ts`:
  - Verify booking succeeds when teacher matches assignment
  - Verify 403 when teacher doesn't match (forged `teacher_id` in input rejected)
  - Verify 409 when slot already booked (race simulation)

**Checkpoint**: `GET /api/scheduling/available-slots` returns slots; `POST /api/scheduling/book-slot` with wrong teacher returns 403; correct teacher returns 201. `booking.teacher_id = assignment.teacher_id` verified by query.

---

## Phase 4: User Story 2 — Group Halaqa Join + Overflow (P1)

**Goal**: Student joins open halaqa; full halaqa triggers sibling preference → new halaqa; zero waiting-list placements.

**Independent Test**: Fill halaqa to capacity → 5th joiner → lands in sibling/new halaqa, not waiting list. Below-target halaqa starts on schedule.

- [x] T015 [P] [US2] Create `src/lib/domains/scheduling/cohorts.ts`:
  - `joinHalaqa(userId: string, classOfferingId: string, entryConfirmation?: string): Promise<JoinResult>` — fetch offering; if at capacity call `openOverflowHalaqa(classOfferingId)` to get targetId; INSERT `session_participants` into targetId; increment `current_enrollment`
  - `openOverflowHalaqa(sourceId: string): Promise<string>` — calls `open_overflow_halaqa(sourceId)` via service-role RPC
  - **Emit events** (FR-021), using the typed event enum (spec 023), no notifications sent here:
    - `cohort_opened` — when `openOverflowHalaqa` returns a **newly created** halaqa id (distinguish new-clone vs reused-sibling so this fires only on actual open)
    - `member_joined` — after the `session_participants` insert succeeds, for the target halaqa

- [x] T016 [US2] Create `src/app/api/scheduling/join-halaqa/route.ts` — POST, auth required, zod input `{classOfferingId, entryConfirmation?}`, calls `joinHalaqa`; returns `{membershipId, classOfferingId, overflowRedirected}`

- [x] T017 [US2] Unit test `src/lib/domains/scheduling/cohorts.test.ts`:
  - Verify normal join inserts into original halaqa (`overflowRedirected: false`)
  - Verify at-capacity join calls `openOverflowHalaqa` and inserts into returned id (`overflowRedirected: true`)
  - Verify no `halaqa_waiting_list` INSERT ever occurs in this flow

**Checkpoint**: 5th joiner to full halaqa → `session_participants` row in new/sibling halaqa; `halaqa_waiting_list` count unchanged.

---

## Phase 5: User Story 3 — Course Enrollment with Entry Conditions (P2)

**Goal**: Course enrollment validates specialist-set entry conditions; qualifying → 201; non-qualifying → 422 with reason.

**Independent Test**: Course with entry condition → non-qualifying student → 422 with `unmetCondition`; qualifying student → 201.

- [x] T018 [US3] Extend `joinHalaqa` in `src/lib/domains/scheduling/cohorts.ts` to handle `product_type = 'course'`:
  - Fetch `class_offerings.entry_conditions_json` if present
  - Validate `entryConfirmation` against conditions; if unmet throw `EntryConditionError` with reason string
  - Specialist-authored condition text sourced from `class_offerings.entry_conditions_json`, never model-generated

- [x] T019 [US3] Map `EntryConditionError` → HTTP 422 `{success: false, unmetCondition: string}` in `src/app/api/scheduling/join-halaqa/route.ts`

- [x] T020 [US3] Unit test: qualifying entry → 201; non-qualifying entry → 422; missing `entryConfirmation` on required course → 422

**Checkpoint**: Course join flow branches correctly; condition text preserved from DB without model modification.

---

## Phase 6: User Story 4 — Teacher Lock + Admin Reassignment (P2)

**Goal**: Self-service mid-month teacher change blocked (403); admin reassignment succeeds, audited, future bookings cancelled.

**Independent Test**: Student calls admin route → 403; admin calls route → 200, `approved_by` set, future bookings cancelled.

- [x] T021 [P] [US4] Extend `src/lib/domains/scheduling/assignments.ts`:
  - `reassignTeacher(assignmentId: string, newTeacherId: string, reason: string, adminId: string): Promise<ReassignResult>` — UPDATE `subscription_teacher_assignments` (teacher_id, approved_by, cancelled_future_bookings_at); bulk UPDATE `bookings` to cancelled; return cancellation count
  - `emitAssignmentChangedEvent(studentId: string, newTeacherId: string, reason: string): Promise<void>` — inserts into event/notification queue for spec 023, using the typed event enum (spec 023). This is the **assignment created/changed** event of FR-021; together with `cohort_opened` + `member_joined` (T015) and `booking_created` (T009) it covers all FOUR FR-021 events. Also call this (or an equivalent create-variant) on initial assignment creation in T007 `createAssignment` so "assignment created" is emitted, not only "changed".

- [x] T022 [US4] Create `src/app/api/scheduling/admin/reassign-teacher/route.ts` — POST, `private.is_admin()` gate, zod input, calls `reassignTeacher` + `emitAssignmentChangedEvent`

- [x] T023 [US4] Unit test `src/lib/domains/scheduling/assignments.test.ts`:
  - Non-admin call → 403
  - Admin call → UPDATE applied with `approved_by = adminId`
  - Future `bookings` (status pending/confirmed, scheduled_at > now) cancelled; past bookings untouched

**Checkpoint**: `approved_by` and `cancelled_future_bookings_at` set on assignment row; future booking count = 0; past bookings unaffected.

---

## Phase 7: User Story 5 — Admin Scheduling Views (P3)

**Goal**: Admin can inspect any student's assignment history and any halaqa's roster/capacity/overflow state.

- [x] T024 [US5] Add admin query fns to `src/lib/domains/scheduling/assignments.ts`:
  - `getStudentAssignmentHistory(studentId: string): Promise<Assignment[]>` — all rows for student (active + inactive), ordered by created_at desc
  - `getHalaqaRoster(classOfferingId: string): Promise<{members: Profile[], capacity: number, current_enrollment: number, sibling_halaqas: ClassOffering[]}>` — join session_participants + profiles + class_offerings siblings

- [x] T025 [US5] Create `src/app/api/scheduling/admin/assignment-history/route.ts` — GET, admin only, query `?studentId=`, calls `getStudentAssignmentHistory`

- [x] T026 [US5] Create `src/app/api/scheduling/admin/halaqa-roster/route.ts` — GET, admin only, query `?classOfferingId=`, calls `getHalaqaRoster`

**Checkpoint**: Non-admin call → 403; admin call returns full history/roster with sibling halaqa list.

---

## Phase 8: Polish

- [x] T027 [P] `npx tsc --noEmit` — fix all type errors from new domain files + new DB types
- [x] T028 [P] `npm run lint` — fix ESLint issues
- [x] T029 `npm run test:unit` — all existing + new tests pass
- [x] T030 `npm run sb:advisors` — zero new advisories on `subscription_teacher_assignments`
- [x] T031 RTL: verify `my-assignment` response includes `teacherNameAr` field from `profiles.full_name_ar` for Arabic RTL display
- [x] T032 Commit all spec artifacts to `docs/pivot-specs-019-024`; push

---

## Dependencies

- **T002a** (class_offerings columns) → applies before **T003** (sibling index) and all logic referencing `program_level` / `entry_conditions_json` / `schedule_json`
- **T003a** (`teacher_availability_instances` + materialization fn) → applies before **T008** `getOpenSlots`/`lockSlot` and **T009** `createConstrainedBooking` (booking targets a dated instance, not the recurring template)
- **FR-021 event emission** is spread across **T009** (`booking_created`), **T015** (`cohort_opened`, `member_joined`), **T021/T007** (assignment created/changed) — all use the spec-023 typed event enum
- **Phase 2** → **Phases 3–7** (db:types must regenerate first)
- **US1 + US2** parallel after Phase 2 (T007–T017 share no file conflicts)
- **US3** extends `cohorts.ts` from US2 — complete T015 before T018
- **US4** extends `assignments.ts` from US1 — complete T007 before T021
- **US5** depends on US4 domain fns
- **Phase 8** → all stories complete

## MVP Scope (P1 only)

Phases 1 → 2 → 3 → 4 → 8 partial. Unblocks spec 021 (attendance consumes booking/cohort rosters).
