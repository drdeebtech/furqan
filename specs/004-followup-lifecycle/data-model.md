# Data Model: Follow-up Lifecycle (دورة حياة المتابعة)

**Branch**: `004-followup-lifecycle` | **Date**: 2026-05-08

> Brownfield documentation. This file captures the existing schema; no new tables, columns, or migrations are introduced by this PR.

---

## Tables in scope

### `public.homework_assignments` (canonical state)

| Column | Type | Nullable | Notes |
|---|---|---|---|
| `id` | `uuid` | NO | Primary key, default `gen_random_uuid()` |
| `student_id` | `uuid` | NO | FK → `profiles.id` (role='student') |
| `teacher_id` | `uuid` | NO | FK → `profiles.id` (role='teacher') |
| `booking_id` | `uuid` | YES | FK → `bookings.id`; the session this follow-up was created against |
| `homework_type` | `homework_type` enum | NO | `hifz | muraja | recitation | tajweed | writing | listening` |
| `title` | `text` | NO | Human-readable title (Arabic-first) |
| `description` | `text` | YES | Long-form details |
| `due_at` | `timestamptz` | YES | Soft deadline; UI hint, not enforced |
| `status` | `homework_status` enum | NO | `assigned | student_ready | completed_excellent | completed_good | completed_needs_work | completed_not_done` (6 states) |
| `assigned_at` | `timestamptz` | NO | Default `now()`; informs edit-window check |
| `student_ready_at` | `timestamptz` | YES | Set on `markStudentReady()` |
| `graded_at` | `timestamptz` | YES | Set on `gradeHomework()` |
| `parent_assignment_id` | `uuid` | YES | FK → `homework_assignments.id`; self-reference for auto-regen chains |
| `audio_url` | `text` | YES | Supabase Storage signed URL; added 2026-05-04 |
| `audio_duration_seconds` | `integer` | YES | CHECK constraint (audio_duration_check); added 2026-05-04 |
| `review_horizon` | `text` | NO | CHECK in (`near | far | none`); default `none`; added 2026-05-05 |
| `created_at` | `timestamptz` | NO | Default `now()` |

**Foreign keys**:
- `parent_assignment_id REFERENCES homework_assignments(id)` — declared without explicit `ON DELETE` clause (Decision 6 / D-005). Postgres default: `NO ACTION` (deferred RESTRICT). Deleting a parent that has children fails with FK violation.
- `booking_id REFERENCES bookings(id)` — explicit clause not yet verified; check before Phase 2 audit.

**Indexes**:
- `idx_homework_assignments_parent_assignment_id` ON `(parent_assignment_id)` — declared in `v10_002_homework.sql:87`. Speeds chain traversal.
- Partial index `homework_assignments(student_id, review_horizon, status) WHERE review_horizon IN ('near','far')` — declared 2026-05-05; murajaah scheduler hot path.
- `idx_homework_assignments_student_status` ON `(student_id, status)` — student dashboard query (assumed; verify).
- `idx_homework_assignments_teacher_status` ON `(teacher_id, status)` — teacher inbox (assumed; verify).

**Triggers**: **NONE** for state machine. There is no `validate_homework_status` trigger (D-002 / Decision 1). `set_updated_at` may apply to bump `updated_at`; verify.

---

## Enums in scope

### `homework_status` (PostgreSQL ENUM, 6 values)

```
assigned
student_ready
completed_excellent
completed_good
completed_needs_work
completed_not_done
```

Allowed transitions (TS-enforced; no DB trigger):

```
assigned        → student_ready
student_ready   → completed_excellent | completed_good | completed_needs_work | completed_not_done
completed_*     → (terminal)
```

Auto-regeneration trigger: when transitioning to `completed_needs_work` or `completed_not_done`, a NEW row in `assigned` is inserted inline (Decision 2). The original row stays terminal; the new row carries `parent_assignment_id = old.id`.

### `homework_type` (PostgreSQL ENUM)

```
hifz | muraja | recitation | tajweed | writing | listening
```

Drives UI rendering (icon, default duration, audio-required flag) but does not gate transitions.

### `review_horizon` (TEXT CHECK constraint, NOT enum)

```
near | far | none
```

Set at create time. `near | far` rows are eligible for the murajaah scheduler (spec 001) via the partial index. `none` means "not subject to spaced-repetition review."

---

## Storage layer

### Audio submissions (Supabase Storage)

Bucket convention: `homework-audio/<student_id>/<homework_id>.<ext>` (assumed; verify against the storage policy file or `getHomeworkAudioUrl()` implementation).

**RLS / Storage policies** (mirror table RLS):
- Student SELECT/INSERT: only files under their own `student_id` prefix.
- Teacher SELECT: files for follow-ups where `teacher_id = auth.uid()`.
- Admin SELECT: any audio.

The `audio_url` column stores either a signed URL (preferred — short TTL) or a public URL with bucket-level access controls. `getHomeworkAudioUrl()` is the canonical accessor.

---

## RLS policies in scope

`homework_assignments` is governed by RLS:

- **SELECT**:
  - Student: `student_id = auth.uid()`
  - Teacher: `teacher_id = auth.uid()`
  - Admin: `is_admin()`
- **INSERT**:
  - Teacher only: `teacher_id = auth.uid()` (via `createHomework` server action)
  - Auto-regen path: also teacher-context, runs inside `gradeHomework`
- **UPDATE**:
  - Teacher: own rows, restricted at TS layer to allowed transitions and editable fields
  - Student: own rows, only the `markStudentReady` transition's columns
  - Admin: any row (no DB-level guard against admin SQL ad-hoc UPDATEs of `completed_*` rows — D-003)
- **DELETE**:
  - Teacher: own rows in `assigned` state (with TS guard against deleting `student_ready` per spec.md US5)
  - Admin: any row

**RLS at scale**: `homework_assignments` will grow to ~3M rows/year at 50k DAU (~5 follow-ups/student/month × 50k students × 12 months). Indexes `(student_id, status)` and `(teacher_id, status)` keep dashboard queries selective. Partial index on `review_horizon` keeps murajaah nightly scan fast. ✅

---

## Cross-spec relationships

### With spec 001 (murajaah-scheduler)

- **Read-only**: murajaah scheduler reads `homework_assignments` rows where `review_horizon IN ('near','far') AND status IN ('assigned','student_ready')` to compute the daily review batch.
- **Index dependency**: the partial index (Decision 4) is shared. Removing it would break both spec 001 SC-005 and spec 004 SC-005.
- **No write coupling**: spec 001 does NOT write to `homework_assignments`. The relationship is one-way data flow.

### With spec 003 (booking-lifecycle)

- **`booking_id` FK**: every follow-up references the booking that triggered its creation. When a booking is `cancelled` after the follow-up is created, the follow-up persists (spec.md AS 2.3 says follow-ups are independent of booking state once created).
- **No reverse coupling**: bookings do not read `homework_assignments`.

### With Communication domain (notify, dispatch)

- `homework.assigned`, `homework.student_ready`, `homework.graded`, and the parent path on `completed_not_done` all dispatch via `notify()` / `dispatchNotification()` post-commit. No DB-level coupling.

---

## Key entities (cross-reference to spec.md FRs)

- **HomeworkAssignment** — `homework_assignments` table. FR-001 through FR-010 all reference this table's columns.
- **Booking** — `bookings.id` referenced via `booking_id`. FR-006 (edit-window check) reads `bookings.scheduled_at`.
- **AudioFile** — Supabase Storage. FR-005 (upload-before-flip).
- **Notification** — downstream of FR-009.

---

## Out of scope for this PR

- New columns, indexes, triggers, RLS policies — none in scope.
- DB trigger for state-machine enforcement — D-002 follow-up issue.
- DB CHECK constraint for graded immutability — D-003 follow-up issue.
- Explicit `ON DELETE` clause on `parent_assignment_id` FK — D-005 follow-up issue.
- Auto-regen depth cap — D-004 follow-up issue.

References:
- `LIFECYCLES.md` §3 — narrative state machine.
- `supabase/migrations/20260504210746_add_homework_audio_submission.sql`
- `supabase/migrations/20260505131935_add_review_horizon_to_homework.sql`
- `supabase/migrations/20260505191211_update_help_center_homework_label_to_followup.sql`
- `src/lib/supabase/migrations/v10_002_homework.sql`
- `src/types/supabase.generated.ts:4920` — homework_status enum values
