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

- [ ] T002a Create `supabase/migrations/20260617990000_class_offerings_extend.sql` — **applies BEFORE T003** (earlier timestamp):
  - **VERIFIED 2026-06-16 against local schema**: `class_offerings` currently has only `capacity` + `status`; the 5 columns below are ABSENT and assumed by T003/T004/T018.
  - `ALTER TABLE class_offerings ADD COLUMN IF NOT EXISTS program_level text, ADD COLUMN IF NOT EXISTS schedule_json jsonb, ADD COLUMN IF NOT EXISTS session_duration_min integer, ADD COLUMN IF NOT EXISTS start_date date, ADD COLUMN IF NOT EXISTS entry_conditions_json jsonb`
  - Existing rows get NULL (no legacy local course offerings); a NULL `program_level` is excluded from sibling matching (document in fn).
  - Preconditions enabled: T003 `idx_class_offerings_sibling` (needs `program_level`), T004 `open_overflow_halaqa` (sibling match on `program_level`), T018 `entry_conditions_json`, session scheduling (`schedule_json`/`session_duration_min`/`start_date`). See spec Clarifications §2026-06-16.

- [ ] T003 Create `supabase/migrations/20260618000000_scheduling_teacher_assignment.sql`:
  - CREATE TABLE `subscription_teacher_assignments` (all columns per data-model.md: id, student_id FK, teacher_id FK, subscription_id FK, product_type CHECK, lock_month date, is_active boolean DEFAULT true, approved_by FK nullable, cancelled_future_bookings_at timestamptz, created_at, updated_at)
  - CREATE TRIGGER `set_updated_at_sta` BEFORE UPDATE using existing `public.set_updated_at()`
  - CREATE UNIQUE INDEX `uix_sta_student_active ON subscription_teacher_assignments(student_id) WHERE is_active = true`
  - CREATE INDEX `idx_sta_student` WHERE is_active; CREATE INDEX `idx_sta_teacher` WHERE is_active
  - RLS ENABLE; 4 policies: student SELECT own `(select auth.uid())`, teacher SELECT own, admin/mod SELECT all, service_role INSERT, service_role+admin UPDATE
  - BEFORE UPDATE trigger `sta_identity_guard` on (student_id, subscription_id, product_type, lock_month) — blocked
  - ADD INDEX `idx_class_offerings_sibling ON class_offerings(teacher_id, program_level, status)` for sibling lookup (requires `program_level` from T002a)

- [ ] T004 Create `supabase/migrations/20260618000001_overflow_halaqa_fn.sql`:
  - CREATE OR REPLACE FUNCTION `open_overflow_halaqa(p_source_offering_id uuid) RETURNS uuid` — SECURITY DEFINER SET search_path = public; FOR SHARE on source; prefer not-full sibling (same teacher_id + program_level + status='open' + current_enrollment < capacity); else INSERT new class_offerings row cloning source
  - REVOKE EXECUTE FROM public, anon, authenticated; GRANT TO service_role

- [ ] T005 `supabase migration up` → `npm run db:types` → commit regenerated `src/types/database.ts`

- [ ] T006 Local concurrency verification (NFR-003):
  - Concurrent double-assignment insert: two transactions both try `INSERT INTO subscription_teacher_assignments (student_id=X, is_active=true, ...)` → unique index blocks second
  - Concurrent last-slot booking: two concurrent transactions on same `teacher_availability` row with `FOR UPDATE` → exactly one booking created
  - Concurrent overflow: two students join same full halaqa simultaneously → each lands in halaqa (sibling or new), no duplicate clone created

**Checkpoint**: `npm run sb:advisors` clean for new table; `npx tsc --noEmit` passes.

---

## Phase 3: User Story 1 — Individual Booking Constrained to Assigned Teacher (P1) 🎯 MVP

**Goal**: Student can only book their assigned teacher's open slots; any other teacher → 403.

**Independent Test**: Create assignment → teacher publishes slot → student books → `booking.teacher_id = assignment.teacher_id`. Then attempt booking from different teacher's slot → 403.

- [ ] T007 [P] [US1] Create `src/lib/domains/scheduling/assignments.ts`:
  - `getMyAssignment(userId: string): Promise<Assignment | null>` — queries `subscription_teacher_assignments WHERE student_id = userId AND is_active = true`; joins `profiles` for teacher name/name_ar
  - `createAssignment(input: AssignTeacherInput): Promise<string>` — service-role client INSERT

- [ ] T008 [P] [US1] Create `src/lib/domains/scheduling/availability.ts`:
  - `getOpenSlots(teacherId: string, month?: string): Promise<AvailabilitySlot[]>` — queries `teacher_availability WHERE teacher_id = teacherId AND is_booked = false AND is_active = true` for given month
  - `lockSlot(slotId: string): Promise<boolean>` — `SELECT ... FOR UPDATE`; UPDATE `is_booked = true`; returns false if already booked

- [ ] T009 [P] [US1] Create `src/lib/domains/scheduling/bookings.ts`:
  - `createConstrainedBooking(userId: string, slotId: string, scheduledAt: string): Promise<string>` — gets assignment; gets slot teacher; validates match; calls `lockSlot`; INSERTs `bookings` row with `status='pending'`; returns bookingId

- [ ] T010 [US1] Create `src/app/api/scheduling/my-assignment/route.ts` — GET, auth required, zod response, calls `getMyAssignment`

- [ ] T011 [US1] Create `src/app/api/scheduling/available-slots/route.ts` — GET, auth required, zod query params, resolves assigned teacher if teacherId omitted, calls `getOpenSlots`

- [ ] T012 [US1] Create `src/app/api/scheduling/book-slot/route.ts` — POST, auth required, zod input, calls `createConstrainedBooking`; maps errors to 403/409/404

- [ ] T013 [US1] Create `src/app/api/scheduling/assign-teacher/route.ts` — POST, admin/service-role only, zod input, calls `createAssignment`; 409 on unique index violation

- [ ] T014 [US1] Unit test `src/lib/domains/scheduling/bookings.test.ts`:
  - Verify booking succeeds when teacher matches assignment
  - Verify 403 when teacher doesn't match (forged `teacher_id` in input rejected)
  - Verify 409 when slot already booked (race simulation)

**Checkpoint**: `GET /api/scheduling/available-slots` returns slots; `POST /api/scheduling/book-slot` with wrong teacher returns 403; correct teacher returns 201. `booking.teacher_id = assignment.teacher_id` verified by query.

---

## Phase 4: User Story 2 — Group Halaqa Join + Overflow (P1)

**Goal**: Student joins open halaqa; full halaqa triggers sibling preference → new halaqa; zero waiting-list placements.

**Independent Test**: Fill halaqa to capacity → 5th joiner → lands in sibling/new halaqa, not waiting list. Below-target halaqa starts on schedule.

- [ ] T015 [P] [US2] Create `src/lib/domains/scheduling/cohorts.ts`:
  - `joinHalaqa(userId: string, classOfferingId: string, entryConfirmation?: string): Promise<JoinResult>` — fetch offering; if at capacity call `openOverflowHalaqa(classOfferingId)` to get targetId; INSERT `session_participants` into targetId; increment `current_enrollment`
  - `openOverflowHalaqa(sourceId: string): Promise<string>` — calls `open_overflow_halaqa(sourceId)` via service-role RPC

- [ ] T016 [US2] Create `src/app/api/scheduling/join-halaqa/route.ts` — POST, auth required, zod input `{classOfferingId, entryConfirmation?}`, calls `joinHalaqa`; returns `{membershipId, classOfferingId, overflowRedirected}`

- [ ] T017 [US2] Unit test `src/lib/domains/scheduling/cohorts.test.ts`:
  - Verify normal join inserts into original halaqa (`overflowRedirected: false`)
  - Verify at-capacity join calls `openOverflowHalaqa` and inserts into returned id (`overflowRedirected: true`)
  - Verify no `halaqa_waiting_list` INSERT ever occurs in this flow

**Checkpoint**: 5th joiner to full halaqa → `session_participants` row in new/sibling halaqa; `halaqa_waiting_list` count unchanged.

---

## Phase 5: User Story 3 — Course Enrollment with Entry Conditions (P2)

**Goal**: Course enrollment validates specialist-set entry conditions; qualifying → 201; non-qualifying → 422 with reason.

**Independent Test**: Course with entry condition → non-qualifying student → 422 with `unmetCondition`; qualifying student → 201.

- [ ] T018 [US3] Extend `joinHalaqa` in `src/lib/domains/scheduling/cohorts.ts` to handle `product_type = 'course'`:
  - Fetch `class_offerings.entry_conditions_json` if present
  - Validate `entryConfirmation` against conditions; if unmet throw `EntryConditionError` with reason string
  - Specialist-authored condition text sourced from `class_offerings.entry_conditions_json`, never model-generated

- [ ] T019 [US3] Map `EntryConditionError` → HTTP 422 `{success: false, unmetCondition: string}` in `src/app/api/scheduling/join-halaqa/route.ts`

- [ ] T020 [US3] Unit test: qualifying entry → 201; non-qualifying entry → 422; missing `entryConfirmation` on required course → 422

**Checkpoint**: Course join flow branches correctly; condition text preserved from DB without model modification.

---

## Phase 6: User Story 4 — Teacher Lock + Admin Reassignment (P2)

**Goal**: Self-service mid-month teacher change blocked (403); admin reassignment succeeds, audited, future bookings cancelled.

**Independent Test**: Student calls admin route → 403; admin calls route → 200, `approved_by` set, future bookings cancelled.

- [ ] T021 [P] [US4] Extend `src/lib/domains/scheduling/assignments.ts`:
  - `reassignTeacher(assignmentId: string, newTeacherId: string, reason: string, adminId: string): Promise<ReassignResult>` — UPDATE `subscription_teacher_assignments` (teacher_id, approved_by, cancelled_future_bookings_at); bulk UPDATE `bookings` to cancelled; return cancellation count
  - `emitAssignmentChangedEvent(studentId: string, newTeacherId: string, reason: string): Promise<void>` — inserts into event/notification queue for spec 023

- [ ] T022 [US4] Create `src/app/api/scheduling/admin/reassign-teacher/route.ts` — POST, `private.is_admin()` gate, zod input, calls `reassignTeacher` + `emitAssignmentChangedEvent`

- [ ] T023 [US4] Unit test `src/lib/domains/scheduling/assignments.test.ts`:
  - Non-admin call → 403
  - Admin call → UPDATE applied with `approved_by = adminId`
  - Future `bookings` (status pending/confirmed, scheduled_at > now) cancelled; past bookings untouched

**Checkpoint**: `approved_by` and `cancelled_future_bookings_at` set on assignment row; future booking count = 0; past bookings unaffected.

---

## Phase 7: User Story 5 — Admin Scheduling Views (P3)

**Goal**: Admin can inspect any student's assignment history and any halaqa's roster/capacity/overflow state.

- [ ] T024 [US5] Add admin query fns to `src/lib/domains/scheduling/assignments.ts`:
  - `getStudentAssignmentHistory(studentId: string): Promise<Assignment[]>` — all rows for student (active + inactive), ordered by created_at desc
  - `getHalaqaRoster(classOfferingId: string): Promise<{members: Profile[], capacity: number, current_enrollment: number, sibling_halaqas: ClassOffering[]}>` — join session_participants + profiles + class_offerings siblings

- [ ] T025 [US5] Create `src/app/api/scheduling/admin/assignment-history/route.ts` — GET, admin only, query `?studentId=`, calls `getStudentAssignmentHistory`

- [ ] T026 [US5] Create `src/app/api/scheduling/admin/halaqa-roster/route.ts` — GET, admin only, query `?classOfferingId=`, calls `getHalaqaRoster`

**Checkpoint**: Non-admin call → 403; admin call returns full history/roster with sibling halaqa list.

---

## Phase 8: Polish

- [ ] T027 [P] `npx tsc --noEmit` — fix all type errors from new domain files + new DB types
- [ ] T028 [P] `npm run lint` — fix ESLint issues
- [ ] T029 `npm run test:unit` — all existing + new tests pass
- [ ] T030 `npm run sb:advisors` — zero new advisories on `subscription_teacher_assignments`
- [ ] T031 RTL: verify `my-assignment` response includes `teacherNameAr` field from `profiles.full_name_ar` for Arabic RTL display
- [ ] T032 Commit all spec artifacts to `docs/pivot-specs-019-024`; push

---

## Dependencies

- **T002a** (class_offerings columns) → applies before **T003** (sibling index) and all logic referencing `program_level` / `entry_conditions_json` / `schedule_json`
- **Phase 2** → **Phases 3–7** (db:types must regenerate first)
- **US1 + US2** parallel after Phase 2 (T007–T017 share no file conflicts)
- **US3** extends `cohorts.ts` from US2 — complete T015 before T018
- **US4** extends `assignments.ts` from US1 — complete T007 before T021
- **US5** depends on US4 domain fns
- **Phase 8** → all stories complete

## MVP Scope (P1 only)

Phases 1 → 2 → 3 → 4 → 8 partial. Unblocks spec 021 (attendance consumes booking/cohort rosters).
