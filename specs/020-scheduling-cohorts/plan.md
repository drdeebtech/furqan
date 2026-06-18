# Implementation Plan: Scheduling, Fixed-Teacher Assignment & Cohorts

**Branch**: `020-scheduling-cohorts` | **Date**: 2026-06-16 | **Spec**: [spec.md](spec.md)
**Input**: Feature specification from `specs/020-scheduling-cohorts/spec.md`

---

## Summary

Add `subscription_teacher_assignments` (binds a student to a teacher for an in-scope hifz subscription month, enforced by a partial unique index at the DB layer) and `teacher_availability_instances` (dated, per-occurrence bookable slots materialized from the recurring `teacher_availability` template, carrying the authoritative per-instance `is_booked`). Also extend `class_offerings` with the 5 columns the scheduling/overflow logic assumes (`program_level`, `schedule_json`, `session_duration_min`, `start_date`, `entry_conditions_json`). Constrain individual booking creation server-side so a student can only book their assigned teacher's published slots, locking the dated instance (never the recurring template). Add a `open_overflow_halaqa` SECURITY DEFINER function that atomically prefers a not-full sibling halaqa before opening a new one. Add admin mid-month reassignment with future-booking cancellation and an audit trail. All layered on the existing `bookings`/`teacher_availability`/`class_offerings`/`session_participants` kernel — nothing in that kernel is rebuilt or modified.

---

## Technical Context

**Language/Version**: TypeScript 5 strict, Node 24, Next.js App Router
**Primary Dependencies**: Supabase JS v2, Zod v3; no new npm packages required
**Storage**: PostgreSQL 15 via Supabase; migrations in `supabase/migrations/` after baseline
**Testing**: Vitest (unit), local Postgres for concurrency verification
**Target Platform**: Vercel serverless — all assignment/booking writes server-only
**Constraints**: RLS every new table; service-role-only writes for assignment creation; `userId` from `auth.getUser()`, never from request input; `(select auth.uid())` initplan on all policies; SECURITY DEFINER EXECUTE lockdown; BEFORE UPDATE identity guards

---

## Constitution Check

| Gate | Status | Notes |
|------|--------|-------|
| RLS on every new table, policies in same migration | ✅ PASS | `subscription_teacher_assignments` + `teacher_availability_instances` |
| Service-role key server-only | ✅ PASS | Assignment INSERT + overflow fn are service-role only |
| `userId` from auth session, never request input | ✅ PASS | `student_id` from `auth.getUser()` in all routes |
| Zod validation at every route handler | ✅ PASS | All 6 endpoints |
| BEFORE UPDATE OF guards on identity columns | ✅ PASS | `student_id`, `subscription_id`, `product_type`, `lock_month` |
| SECURITY DEFINER EXECUTE lockdown | ✅ PASS | `open_overflow_halaqa`: revoke public/anon/authenticated, grant service_role |
| `npm run db:types` + tsc + lint pass | ✅ GATE | Required before PR merge |
| Local Postgres concurrency verification | ✅ GATE | NFR-003: double-book + overflow storm simulated before done |
| Existing booking kernel not rebuilt | ✅ PASS | `deduct_package_session`, `confirm_booking_with_session` untouched |
| Arabic RTL on all scheduling surfaces | ✅ PASS | NFR-004 |

---

## Project Structure

```text
supabase/migrations/
├── 20260617990000_class_offerings_extend.sql        (T002a — applies first)
│   — ALTER TABLE class_offerings ADD COLUMN IF NOT EXISTS program_level, schedule_json,
│     session_duration_min, start_date, entry_conditions_json (the 5 columns absent in live DB)
│   — program_level required at creation for overflow-eligible offerings (NULL strands siblings)
├── 20260617990001_availability_instances.sql        (T003a)
│   — CREATE TABLE teacher_availability_instances (dated, bookable; per-instance is_booked)
│     + UNIQUE (template_id, slot_date) + open-slot index + RLS
│   — CREATE FUNCTION materialize_availability_instances(date) SECURITY DEFINER (idempotent gen)
│     + REVOKE/GRANT EXECUTE (service_role only)
├── 20260618000000_scheduling_teacher_assignment.sql
│   — CREATE TABLE subscription_teacher_assignments + indexes + RLS + BEFORE UPDATE guard + set_updated_at trigger
│   — ADD INDEX idx_class_offerings_sibling ON class_offerings(teacher_id, program_level, status)
└── 20260618000001_overflow_halaqa_fn.sql
    — CREATE FUNCTION open_overflow_halaqa(uuid) RETURNS uuid
    — REVOKE/GRANT EXECUTE

src/
├── app/api/scheduling/
│   ├── my-assignment/route.ts         ← GET current active assignment
│   ├── assign-teacher/route.ts        ← POST create assignment (admin/service-role)
│   ├── available-slots/route.ts       ← GET open slots for assigned teacher
│   ├── book-slot/route.ts             ← POST constrained booking creation
│   ├── join-halaqa/route.ts           ← POST group join + overflow
│   └── admin/
│       └── reassign-teacher/route.ts  ← POST admin mid-month change
└── lib/domains/scheduling/
    ├── assignments.ts                  ← getMyAssignment, createAssignment, reassignTeacher
    ├── availability.ts                 ← getOpenSlots (dated instances), lockSlot (FOR UPDATE on the dated instance)
    ├── bookings.ts                     ← createConstrainedBooking (teacher check + dated-instance lock)
    └── cohorts.ts                      ← joinHalaqa, openOverflowHalaqa (calls DB fn)
```

---

## Key Implementation Decisions

1. **Single new table**: `subscription_teacher_assignments` with partial unique index `uix_sta_student_active ON (student_id) WHERE is_active = true`. Historical assignments retained as `is_active = false` rows — no separate history table needed.

2. **Constrained booking enforcement is server-side**: Before inserting into `bookings`, the route reads the caller's active assignment and verifies `teacher_id` matches. The existing booking identity guard (`20260613140000`) is the backstop; the server check provides a clear 403 before any DB write.

3. **Overflow atomicity via SECURITY DEFINER fn**: `open_overflow_halaqa(source_offering_id)` runs with service-role privileges, uses `FOR SHARE` on the source to prevent concurrent clone storms, prefers not-full siblings, and opens a new halaqa only as a last resort.

4. **Slot double-book race prevention**: `SELECT ... FOR UPDATE` on the dated `teacher_availability_instances` row (one materialized occurrence of the recurring template on a specific date) serializes concurrent slot selections — **the recurring `teacher_availability` template is never the lock target** (a weekly template recurs and cannot carry a global `is_booked` flag; see data-model §2a-bis). `is_booked` is per dated instance. The debit race is already handled by the existing `deduct_package_session` kernel — no new credit logic here.

5. **Admin mid-month reassignment audit**: UPDATE `subscription_teacher_assignments` sets `approved_by = adminUid` and `cancelled_future_bookings_at = now()`; bulk-cancels future `bookings` for the student; emits `assignment_changed` event. Cancel-and-rebook model avoids phantom bookings at mismatched times. **Identity columns are protected by the `sta_identity_guard` BEFORE UPDATE trigger (fires for all roles), not by RLS `WITH CHECK`** — `WITH CHECK` cannot express per-column immutability. The `sta_admin_update` policy carries `WITH CHECK (private.is_admin())` purely as defense-in-depth on the actor predicate (closing the USING-only asymmetric-policy gap); see data-model §1 "sta_admin_update — is WITH CHECK needed?".

6. **Arabic RTL**: All assignment/availability/halaqa data returned as structured JSON — rendering RTL is the UI concern (spec 023/020 UI phase). Field names are RTL-agnostic. Teacher name from `profiles.full_name_ar` included in `my-assignment` response for RTL display.

---

## Artifacts

| File | Status |
|------|--------|
| research.md | ✅ Complete |
| data-model.md | ✅ Complete |
| contracts/api.md | ✅ Complete |
| quickstart.md | ✅ Complete |
| tasks.md | ✅ Complete |
