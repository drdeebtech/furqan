# Data Model: Booking Lifecycle (دورة حياة الحجز)

**Branch**: `003-booking-lifecycle` | **Date**: 2026-05-08

> Brownfield documentation. This file captures the existing schema; no new tables, columns, or migrations are introduced by this PR.

---

## Tables in scope

### `public.bookings` (canonical state)

| Column | Type | Nullable | Notes |
|---|---|---|---|
| `id` | `uuid` | NO | Primary key, default `gen_random_uuid()` |
| `student_id` | `uuid` | NO | FK → `profiles.id` (role='student') |
| `teacher_id` | `uuid` | NO | FK → `profiles.id` (role='teacher') |
| `scheduled_at` | `timestamptz` | NO | UTC; the picker shows local time but stores UTC |
| `duration_min` | `integer` | NO | Default 30 (per CLAUDE.md V1 default) |
| `status` | `booking_status` enum | NO | `pending | confirmed | cancelled | completed | no_show` |
| `cancel_reason` | `text` | YES | Freeform per Decision 4; populated when `status='cancelled'` |
| `cancelled_by` | `text` | YES | `student | teacher | admin | system` |
| `cancelled_at` | `timestamptz` | YES | Populated alongside `cancelled_by` |
| `no_show_party` | `text` | YES | `student | teacher | both`; populated when `status='no_show'` |
| `created_at` | `timestamptz` | NO | Default `now()` |
| `created_via` | `session_created_via` | NO | `student_request | admin_create | instant_session | recurring` |

**Indexes**:
- `idx_bookings_teacher_scheduled` ON `(teacher_id, scheduled_at)` — overlap check at confirm time (SC-002)
- `idx_bookings_student_status` ON `(student_id, status)` — student dashboard queries
- `idx_bookings_status_scheduled` ON `(status, scheduled_at)` — no-show detector scan

**Triggers**:
- `validate_booking_status` BEFORE UPDATE — enforces allowed state transitions (Decision 1)
- `set_updated_at` BEFORE UPDATE — bumps `updated_at`

### `public.sessions` (run-time artifact)

Created by booking-confirm orchestrator. References the booking via `booking_id` (nullable as of `20260506053029_make_sessions_booking_id_nullable.sql` to support Halaqa group sessions that have multiple students per session).

| Column | Type | Nullable | Notes |
|---|---|---|---|
| `id` | `uuid` | NO | Primary key |
| `booking_id` | `uuid` | YES | FK → `bookings.id`; null for Halaqa multi-student sessions |
| `room_url` | `text` | YES | Daily.co room URL; populated at confirm time |
| `room_expires_at` | `timestamptz` | YES | Daily.co room TTL; informs edge case 3 |
| `started_at` | `timestamptz` | YES | First participant join event |
| `ended_at` | `timestamptz` | YES | `endSession()` set or no-show detector closure |
| `lesson_plan` | `jsonb` | YES | Set by teacher pre-session |
| `session_mode` | `text` | NO | `private | halaqa | lecture` (added 2026-05-05) |
| `session_type` | `session_type` enum | YES | Quranic subject (tajweed, hifz, etc.); distinct from `session_mode` |

### `public.teacher_availability` (slot source)

Read-only from booking-domain perspective; defines which `scheduled_at` values `createBooking()` is allowed to reference.

| Column | Type | Notes |
|---|---|---|
| `teacher_id` | `uuid` | FK |
| `day_of_week` | `integer` | 0-6 (Sun-Sat) |
| `start_time` | `time` | Teacher local time |
| `end_time` | `time` | Teacher local time |
| `timezone` | `text` | Teacher's timezone (informs edge case 1: DST) |

### `public.availability_exceptions` (one-off overrides)

Used to block specific dates. Booking creation must check both `teacher_availability` and absence of an `availability_exceptions` row for the requested date.

### `public.student_packages` (balance source)

Read at booking creation (FR-009) and debited at terminal `completed` (Decision 5).

| Column | Type | Notes |
|---|---|---|
| `id` | `uuid` | PK |
| `student_id` | `uuid` | FK |
| `package_id` | `uuid` | FK → `packages.id` |
| `sessions_remaining` | `integer` | Decremented by `deduct_package_session()` |
| `expires_at` | `timestamptz` | Edge case 6 references this |
| `status` | `student_package_status` (text CHECK) | `active | expired | exhausted | refunded` |

### `public.audit_log` (mutation trail)

Best-effort append-only record. Booking transitions of severity ≥ `warning` (cancel, no-show, completed) are logged here. Failures piped through `logError` per Constitution Principle II.

---

## Enums in scope

### `booking_status` (PostgreSQL ENUM)

```
pending | confirmed | cancelled | completed | no_show
```

Allowed transitions enforced by `validate_booking_status` trigger:

```
pending   → confirmed | cancelled
confirmed → completed | no_show | cancelled (admin only)
cancelled → (terminal)
completed → (terminal)
no_show   → (terminal)
```

### `session_created_via` (text CHECK)

```
student_request | admin_create | instant_session | recurring
```

Used to distinguish booking provenance for analytics and for edge cases like instant-session-against-exhausted-package (D-003).

---

## RLS policies in scope

`bookings` is governed by RLS. The latest revision is `20260506054344_sessions_rls_via_participants_v2.sql` for the related `sessions` table; bookings policies follow the same shape:

- Student SELECT: `student_id = auth.uid()`
- Teacher SELECT: `teacher_id = auth.uid()`
- Admin SELECT: `is_admin()`
- INSERT: only via `createBooking()` server action; RLS additionally checks `student_id = auth.uid()` so a malicious client can't insert for another student
- UPDATE: confined by trigger to allowed transitions; RLS layer requires either teacher ownership, admin role, or system path

**RLS at scale**: `bookings` is expected to grow to ~3M rows/year at 50k DAU. `idx_bookings_student_status` keeps the most-common student-dashboard query (where `student_id = $1 AND status IN ('confirmed', 'completed')`) under 5ms. ✅

---

## Key entities (cross-reference to spec.md FRs)

- **Booking** — `bookings` table. FR-001, FR-002, FR-005, FR-007, FR-009, FR-010.
- **Session** — `sessions` table, created by confirm. FR-003.
- **TeacherAvailability + AvailabilityException** — slot validation. FR-001 (creation rejection rules).
- **StudentPackage** — balance check. FR-009 (creation), FR-006 (terminal-state deduction), Decision 5.
- **AuditLog** — mutation trail. FR-005 (cancellation logging), FR-006 (terminal-state side effects).

---

## Out of scope for this PR (cross-references)

- New columns, indexes, triggers, RLS policies — none in scope.
- Halaqa session-mode booking flow — handled in `src/app/student/halaqas/`, governed by `FURQAN_SESSION_MODES_MIGRATION_PLAN.md` Stages 4–6, separately from this lifecycle spec.
- Lecture/Majlis broadcast mode — net-new, Phase 3 of the plan.

References:
- `LIFECYCLES.md` §1 — narrative state machine.
- `supabase/migrations/` — full schema history.
- ADR-0002 — domain-write consolidation pattern.
- ADR-0004 — booking-confirm orchestrator.
