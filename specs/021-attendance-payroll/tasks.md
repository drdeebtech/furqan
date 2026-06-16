# Tasks: Attendance, Excuses & Teacher Payroll (Spec 021)

**Input**: `specs/021-attendance-payroll/` (spec.md, plan.md, data-model.md, research.md, contracts/api.md)
**Branch**: `021-attendance-payroll` (cut from `020-scheduling-cohorts` after merge)
**Prerequisites**: spec 020 merged — `subscription_teacher_assignments`, `bookings`, `sessions`, `session_participants` must exist. spec 018's `restore_student_package` fn must exist.

---

## Phase 1: Setup

- [ ] T001 Verify branch cut from `020-scheduling-cohorts`; confirm `restore_student_package` fn exists: `SELECT proname FROM pg_proc WHERE proname = 'restore_student_package'`
- [ ] T002 Add 2 new keys to `ALLOWED_SETTING_KEYS` in `src/lib/settings.ts`: `excuse_notice_threshold_seconds`, `payroll_run_day_of_month`

**Checkpoint**: `npx tsc --noEmit` + `npm run lint` pass.

---

## Phase 2: Foundational — DB Migrations

**⚠️ CRITICAL**: All user story work blocked until T007 (`npm run db:types`) completes.

- [ ] T002a Create `supabase/migrations/20260619000000_profiles_hourly_rate.sql` — **applies first in this spec's set**:
  - **VERIFIED 2026-06-16 against local schema**: `profiles.hourly_rate_usd` does NOT exist; T006 `finalize_attendance` snapshots it into `session_deliveries`, so it must exist first.
  - `ALTER TABLE profiles ADD COLUMN IF NOT EXISTS hourly_rate_usd numeric(10,2) CHECK (hourly_rate_usd >= 0)`
  - Precondition for T006 (rate snapshot) and T007 (`db:types`). See spec Clarifications §2026-06-16.
  - **Cross-spec ordering (resolved):** all 021 migrations are timestamped `20260619xxxxxx` so they sort strictly AFTER spec 020's `20260618xxxxxx` set — removes the prior `20260618000000` collision between 020 and 021.

- [ ] T003 Create `supabase/migrations/20260619000001_subscription_extensions.sql`:
  - CREATE TABLE `subscription_extensions (id uuid PK, subscription_id uuid FK subscriptions, booking_id uuid NOT NULL FK bookings, session_id uuid FK sessions nullable, granted_by_user_id uuid FK profiles, reason text NOT NULL, extension_seconds bigint CHECK(>0), granted_at timestamptz DEFAULT now())`
  - **Idempotency anchor = `booking_id`** (Clarifications §2026-06-16): `session_id` is nullable on `bookings`, so it cannot anchor idempotency for individual sessions. `booking_id` is always present.
  - CREATE UNIQUE INDEX `uix_subscription_extensions_booking ON subscription_extensions(subscription_id, booking_id)` — the idempotency guard
  - `session_id` retained as nullable informational FK (audit link to the delivered session when one exists)
  - CREATE INDEX `idx_subscription_extensions_sub ON subscription_extensions(subscription_id)`
  - RLS: student reads own (via subscription → student_id); admin reads all; service_role writes only
  - BEFORE UPDATE OF (`extension_seconds`, `subscription_id`, `booking_id`, `session_id`) guard
  - Seed `platform_settings`: `excuse_notice_threshold_seconds='7200'`, `payroll_run_day_of_month='1'`

- [ ] T004 Create `supabase/migrations/20260619000002_attendance_excuses.sql`:
  - CREATE TYPE `attendance_outcome AS ENUM ('present','student_absent','teacher_absent','excused_carried')`
  - CREATE TYPE `credit_action AS ENUM ('none','debited','restored')`
  - CREATE TYPE `excuse_status AS ENUM ('pending','accepted','rejected','ineligible')`
  - CREATE TABLE `attendance_records (id uuid PK, booking_id uuid UNIQUE FK bookings, student_id uuid FK profiles, teacher_id uuid FK profiles, session_id uuid FK sessions nullable, outcome attendance_outcome NOT NULL, credit_action credit_action DEFAULT 'none', finalized_at timestamptz, created_at, updated_at)` + indexes on student_id, teacher_id + set_updated_at trigger
  - CREATE TABLE `excuse_requests (id uuid PK, booking_id uuid FK bookings, student_id uuid FK profiles, teacher_id uuid FK profiles, reason text NOT NULL, submitted_at timestamptz DEFAULT now(), is_eligible boolean NOT NULL, status excuse_status DEFAULT 'pending', decided_by uuid FK profiles nullable, decided_at timestamptz nullable, created_at)` + UNIQUE on booking_id + indexes
  - RLS for `attendance_records`: student SELECT own; teacher SELECT own; admin all; service_role INSERT/UPDATE
  - RLS for `excuse_requests`: student INSERT own upcoming; student/teacher SELECT own; teacher UPDATE status (own rows, status='pending'); admin all
  - BEFORE UPDATE OF (`booking_id`, `student_id`) on attendance_records; BEFORE UPDATE OF (`booking_id`, `student_id`, `teacher_id`, `is_eligible`) on excuse_requests

- [ ] T005 Create `supabase/migrations/20260619000003_payroll_tables.sql`:
  - CREATE TYPE `payout_status AS ENUM ('pending','paid','failed')`
  - CREATE TABLE `session_deliveries (id uuid PK, session_id uuid UNIQUE FK sessions, teacher_id uuid FK profiles, duration_minutes integer CHECK(>0), hourly_rate_usd numeric(10,2) CHECK(>=0), delivered_at timestamptz NOT NULL, payroll_period_month date NOT NULL, created_at)` + composite index (teacher_id, payroll_period_month)
  - CREATE TABLE `teacher_payouts (id uuid PK, teacher_id uuid FK profiles, payroll_period_month date NOT NULL, total_hours numeric(10,2) CHECK(>=0), hourly_rate_usd numeric(10,2) CHECK(>=0), total_amount_usd numeric(10,2) CHECK(>=0), status payout_status DEFAULT 'pending', run_at timestamptz DEFAULT now(), created_at)` + UNIQUE (teacher_id, payroll_period_month) + index
  - RLS for `session_deliveries`: teacher SELECT own; admin all; service_role INSERT; no UPDATE/DELETE
  - RLS for `teacher_payouts`: teacher SELECT own; admin all; service_role INSERT; admin/service_role UPDATE status only
  - BEFORE UPDATE OF (`session_id`, `teacher_id`, `duration_minutes`, `hourly_rate_usd`, `delivered_at`) on session_deliveries (fully immutable — matches data-model.md)
  - BEFORE UPDATE OF (`teacher_id`, `payroll_period_month`, `total_hours`, `total_amount_usd`) on teacher_payouts

- [ ] T006 Create `supabase/migrations/20260619000004_attendance_payroll_fns.sql`:
  - `finalize_attendance(p_booking_id uuid, p_outcome attendance_outcome, p_actual_teacher_id uuid DEFAULT NULL) RETURNS void` — upsert attendance_records; if excused_carried: check credit_action != 'restored' then call `restore_student_package(p_booking_id)`, set credit_action='restored', insert subscription_extensions with `booking_id = p_booking_id` (ON CONFLICT (subscription_id, booking_id) DO NOTHING); if teacher_absent: restore credit, no session_deliveries for absent teacher; if present or teacher_absent with substitute: insert session_deliveries with hourly_rate_usd snapshot; SECURITY DEFINER; REVOKE from public/anon/authenticated; GRANT to service_role
  - `run_monthly_payroll(p_month date) RETURNS int` — INSERT INTO teacher_payouts SELECT teacher_id, p_month, ROUND(SUM(duration_minutes)/60.0,2), MAX(hourly_rate_usd), ROUND(SUM(duration_minutes/60.0*hourly_rate_usd),2) FROM session_deliveries WHERE payroll_period_month=p_month GROUP BY teacher_id ON CONFLICT DO NOTHING; RETURN count; same EXECUTE lockdown

- [ ] T007 `supabase migration up` → `npm run db:types` → commit regenerated `src/types/database.ts`

- [ ] T008 Local verification (NFR-002):
  - Double-finalize same booking → second call no-ops (idempotent)
  - Excused carry-over called twice → `credit_action = 'restored'` exactly once; `subscription_extensions` 1 row
  - `run_monthly_payroll` called twice same month → 0 duplicate payouts
  - BEFORE UPDATE on `teacher_payouts.total_amount_usd` → blocked

**Checkpoint**: `npm run sb:advisors` clean for new tables; `npx tsc --noEmit` passes.

---

## Phase 3: User Story 1 — Attendance Recording (P1)

**Goal**: Admin/service_role can record a session outcome; unexcused absence leaves credit consumed; `attendance_records` row created.

**Independent Test**: Confirm booking → POST `/api/attendance/record` with `student_absent` → attendance_records.credit_action = 'none', sessions_remaining unchanged.

- [ ] T009 [P] [US1] Create `src/lib/domains/attendance/finalize.ts`: `finalizeAttendance(bookingId, outcome, actualTeacherId?)` — calls `finalize_attendance` via service-role client; maps DB errors to typed errors
- [ ] T010 [P] [US1] Create `src/app/api/attendance/record/route.ts`: POST, admin/service_role auth guard, zod input, calls `finalizeAttendance`
- [ ] T011 [P] [US1] Create `src/app/api/attendance/[studentId]/route.ts`: GET, auth guard (student own, teacher own sessions, admin all), RLS enforced, zod query params, paginated
- [ ] T012 [US1] Unit test `src/lib/domains/attendance/finalize.test.ts`: mock service-role client; verify unexcused = credit_action 'none'; verify idempotent second call

**Checkpoint**: `POST /api/attendance/record` creates attendance_records row; student balance unchanged for student_absent.

---

## Phase 4: User Story 2 — Excuse Submit + Teacher Decide (P1)

**Goal**: Student submits excuse; teacher accepts/rejects; eligibility enforced by threshold.

**Independent Test**: Submit excuse ≥2h before session → isEligible=true, status=pending. Submit <2h → isEligible=false, status=ineligible. Teacher accept → carry-over triggered.

- [ ] T013 [P] [US2] Create `src/lib/domains/attendance/excuses.ts`: `submitExcuse(bookingId, reason, userId)` — reads session scheduledAt, reads `excuse_notice_threshold_seconds` from settings, computes isEligible; inserts excuse_requests; `decideExcuse(excuseId, decision, deciderId)` — validates teacher_id matches deciderId; updates status; on accepted triggers finalizeAttendance
- [ ] T014 [P] [US2] Create `src/app/api/excuses/submit/route.ts`: POST, auth (student), zod input, calls `submitExcuse`
- [ ] T015 [US2] Create `src/app/api/excuses/[id]/decide/route.ts`: PATCH, auth (teacher or admin), zod input, calls `decideExcuse`; emits domain event for spec 023
- [ ] T016 [US2] Unit test `src/lib/domains/attendance/excuses.test.ts`: boundary cases (exactly at threshold = eligible; 1 second inside = ineligible); teacher inaction; ineligible cannot be accepted

**Checkpoint**: Eligible excuse + teacher accept → attendance_records.outcome = 'excused_carried', credit_action = 'restored'. Ineligible excuse returns 422 on accept attempt.

---

## Phase 5: User Story 3 — Subscription Extension on Carry-over (P1)

**Goal**: Excused carry-over inserts `subscription_extensions` row equivalent to session duration; idempotent.

**Independent Test**: Accept excuse for 60-min session → subscription_extensions row with extension_seconds=3600; re-accept → no second row.

- [ ] T017 [US3] Wire `subscription_extensions` insert inside `finalize_attendance` fn (already in T006 migration fn): ensure `ON CONFLICT (subscription_id, booking_id) DO NOTHING` is present (anchor is `booking_id`, not the nullable `session_id`)
- [ ] T018 [US3] Add `computeEffectiveEndDate(subscriptionId)` to `src/lib/domains/attendance/finalize.ts`: queries SUM(extension_seconds) from subscription_extensions; adds to current_period_end
- [ ] T019 [US3] Unit test: excused carry-over → exactly 1 subscription_extensions row; idempotent retry → still 1 row; unexcused absence → 0 rows

**Checkpoint**: Effective end date query returns `current_period_end + extension_seconds`; no mutation of `subscriptions.current_period_end`.

---

## Phase 6: User Story 4 — Teacher Absence (P1)

**Goal**: teacher_absent outcome restores student credit, inserts no session_deliveries for absent teacher; substitute gets delivery credit.

**Independent Test**: Record teacher_absent → credit_action='restored', no session_deliveries for absent teacher. With substitute → session_deliveries for substitute.

- [ ] T020 [US4] `finalize_attendance` fn (T006) handles `teacher_absent` branch: call `restore_student_package`, set credit_action='restored'; if `p_actual_teacher_id` provided (substitute), insert session_deliveries with substitute's hourly_rate_usd
- [ ] T021 [US4] Unit test `src/lib/domains/attendance/finalize.test.ts`: teacher_absent = student credit restored; teacher_absent not in student's student_absent count; substitute gets session_deliveries row; original absent teacher gets no session_deliveries row

**Checkpoint**: For teacher_absent: attendance_records.outcome='teacher_absent', credit_action='restored', 0 session_deliveries for absent teacher.

---

## Phase 7: User Story 5 — Teacher Payroll (P1)

**Goal**: Monthly payroll run aggregates delivered hours × rate into teacher_payouts; idempotent; teacher rate is configurable field.

**Independent Test**: 3 × 60-min sessions at $20/hr → run_monthly_payroll → total_hours=3, total_amount_usd=60; re-run → payoutsCreated=0.

- [ ] T022 [P] [US5] Create `src/lib/domains/attendance/payroll.ts`: `runMonthlyPayroll(month)` — calls `run_monthly_payroll(month)` via service-role; `getPayouts(teacherId?, month?, status?)` — queries teacher_payouts with RLS
- [ ] T023 [P] [US5] Create `src/app/api/payroll/run/route.ts`: POST, admin/service_role only, zod `{month: YYYY-MM-01}`, validates month not in future, calls `runMonthlyPayroll`
- [ ] T024 [US5] Create `src/app/api/payroll/payouts/route.ts`: GET, auth, RLS enforced, paginated
- [ ] T025 [US5] Verify the `profiles.hourly_rate_usd` column (added in T002a) is captured as a snapshot in the `finalize_attendance` fn → `session_deliveries.hourly_rate_usd` (column existence is no longer conditional — see T002a)
- [ ] T026 [US5] Unit test `src/lib/domains/attendance/payroll.test.ts`: aggregation math; idempotency; zero-delivery teacher produces no payout; rate-at-delivery correctness

**Checkpoint**: run_monthly_payroll idempotent; total_amount_usd = SUM(duration_minutes/60 × hourly_rate_usd); rate change after delivery does not affect closed month.

---

## Phase 8: Polish

- [ ] T027 [P] `npx tsc --noEmit` — fix all type errors
- [ ] T028 [P] `npm run lint` — fix all lint issues
- [ ] T029 `npm run test:unit` — all existing + new tests pass
- [ ] T030 `npm run sb:advisors` — zero new advisories for 5 new tables
- [ ] T031 Hardcoded value scan: `grep -rn '[0-9]\+\.[0-9]\+\|7200\|2 hour' src/lib/domains/attendance/ src/app/api/attendance/ src/app/api/excuses/ src/app/api/payroll/` → zero hardcoded thresholds or rates
- [ ] T032 RTL audit: excuse submission form, attendance list, payroll view — verify RTL rendering
- [ ] T033 Commit all spec artifacts to `docs/pivot-specs-019-024`; push

---

## Dependencies

- **T002a** (`profiles.hourly_rate_usd`) → applies before **T006** (`finalize_attendance` rate snapshot) and **T007** (db:types)
- **Phase 2** (migrations) → blocks all user stories
- **US1** (T009-T012): no dependency on other stories; prerequisite for US2/US4
- **US2** (T013-T016): depends on US1 (`finalizeAttendance` fn)
- **US3** (T017-T019): depends on US2 (excuse accept triggers carry-over)
- **US4** (T020-T021): depends on US1 (`finalizeAttendance` fn); independent of US2/US3
- **US5** (T022-T026): depends on Phase 2 (session_deliveries table); independent of US1-US4
- **Phase 8**: all stories complete

## Parallel Opportunities

- T009 + T010 + T011 within US1
- T013 + T014 within US2
- T022 + T023 within US5
- T027 + T028 in Phase 8

## MVP Scope (P1 — all stories are P1)

Phases 1 → 2 → 3 → 4 → 5 → 6 → 7 → 8. All 5 user stories are P1; deliver in dependency order.
