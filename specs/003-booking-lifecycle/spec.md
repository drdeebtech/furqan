# Feature Specification: Booking Lifecycle (دورة حياة الحجز)

**Feature Branch**: `003-booking-lifecycle`
**Created**: 2026-05-08
**Status**: Brownfield documentation (the lifecycle is already in production; this spec captures observed behaviour)
**Input**: Formalize the prose state machine from `LIFECYCLES.md` §1 into spec-kit format so the booking domain is governed by `.specify/memory/constitution.md` and findable from `specs/INDEX.md`.

> **Brownfield framing.** The booking lifecycle has been in production since FURQAN's V1 build and is exercised by every paying student. This spec is a *descriptive* document — it captures what production currently does, not what it should do. Any divergence between intent and observed behaviour is filed as a separate GitHub issue ("gaps"), not encoded into this spec. Per Constitution Principle V (Tracer-Bullet Adoption), retrofitting an already-shipped feature into spec-kit format is permissible documentation work and does not require the v0→v1 framing used for `specs/001-murajaah-scheduler/spec.md`.

## State machine (source of truth: `bookings.status` enum)

```
                  ┌──────────┐
                  │ pending  │ ← Student creates booking via createBooking()
                  └────┬─────┘
                       │
              Teacher confirms │ Teacher declines
                       │              │
                  ┌────▼─────┐   ┌────▼──────┐
                  │confirmed │   │ cancelled │
                  └────┬─────┘   └───────────┘
                       │
            Session completes │ Student/teacher absent
                       │              │
                  ┌────▼─────┐   ┌────▼──────┐
                  │completed │   │  no_show  │
                  └──────────┘   └───────────┘
```

**Authoritative enforcement**: `validate_booking_status` PostgreSQL trigger (referenced from `src/app/teacher/dashboard/actions.ts:226`). The trigger blocks invalid transitions at the DB level — TypeScript pre-checks in server actions are belt-and-suspenders, not the source of truth.

**Owner files**:
- `src/app/student/bookings/new/actions.ts` — `createBooking()` (the only producer of `pending` rows on the student path)
- `src/app/teacher/dashboard/actions.ts` — `updateBookingStatus()`, `markNoShow()`, `endSession()`, `recreateRoom()`, `startInstantSession()` (all transitions out of `pending`)
- `supabase/functions/no-show-detector/index.ts` — automation path that sets `no_show` after the session window without participant join events

## User Scenarios & Testing *(mandatory)*

### User Story 1 — Student books a slot with a chosen teacher (Priority: P1)

A student browses available teachers, picks a slot from `teacher_availability`, and submits a booking request. The booking lands in `pending` and the teacher is notified.

**Why this priority**: P1 — without this path, the academy has no transactions. Every other booking flow assumes a `pending` row exists.

**Independent Test**: Sign in as student → `/student/teachers/<id>` → pick available slot → submit. Verify a row in `bookings` with `status='pending'` and a notification dispatched to the teacher.

**Acceptance Scenarios**:

1. **Given** a teacher with a free slot at 14:00 UTC, **when** a student submits a booking for that slot, **then** a `bookings` row exists with `status='pending'`, `student_id` set, `teacher_id` set, `scheduled_at='14:00 UTC'`, and the teacher receives an in-app notification via `notify()`.
2. **Given** a student already has a `pending` or `confirmed` booking that overlaps the requested slot, **when** the student submits, **then** the request is rejected before any insert (server-action returns `{ error }`; no row created).
3. **Given** the student has zero remaining sessions in their active package, **when** the student submits, **then** the request is rejected with a package-exhausted message; no row created.

### User Story 2 — Teacher confirms a pending booking (Priority: P1)

The teacher reviews their inbox of pending requests and confirms one. Confirmation creates the Daily.co room and the session record atomically.

**Why this priority**: P1 — confirmation is the gate that turns a request into a real, joinable session. Without it, students cannot enter the video room.

**Independent Test**: Sign in as teacher → `/teacher/dashboard` → click "Confirm" on a pending row. Verify (a) `bookings.status='confirmed'`, (b) a `sessions` row was created with a non-null `room_url`, (c) the student was notified.

**Acceptance Scenarios**:

1. **Given** a `pending` booking for teacher T at 14:00 UTC, **when** T calls `updateBookingStatus(bookingId, 'confirmed')`, **then** the trigger allows the transition, the corresponding `sessions` row is upserted with `room_url` from Daily.co, and the student is notified.
2. **Given** T has another `confirmed` booking that overlaps 14:00 UTC, **when** T attempts to confirm a second pending booking for that window, **then** the action rejects (overlap guard) — no double-booking is created.
3. **Given** Daily.co room creation fails mid-confirmation, **when** the teacher confirms, **then** the booking remains in `pending` (not partially-confirmed) and the failure surfaces via `loudAction` / `<ActionFeedback>` so the teacher can retry. Routes to `EXCEPTION_PLAYBOOKS.md` PB-01.

### User Story 3 — Booking ends in `completed` or `no_show` (Priority: P2)

After the scheduled time, a booking transitions to one of two terminal states based on what actually happened during the session window.

**Why this priority**: P2 — terminal-state correctness drives package deduction (`completed` → deduct; `no_show` with `no_show_party='teacher'` → do **not** deduct), reporting, and parent notifications. Wrong terminal state = wrong billing.

**Independent Test**: Run a confirmed booking through to its scheduled time without participants joining; verify the no-show edge function flips it to `no_show`. Run another booking through `endSession()`; verify it flips to `completed`.

**Acceptance Scenarios**:

1. **Given** a `confirmed` booking whose scheduled window has ended and `endSession()` was called by the teacher, **when** `endSession()` runs, **then** `bookings.status='completed'`, `sessions.ended_at` is set, and `deduct_package_session()` deducts one session from the student's active package.
2. **Given** a `confirmed` booking whose scheduled window has ended without any join events for either party, **when** the no-show-detector edge function runs, **then** `bookings.status='no_show'` and `no_show_party` is recorded based on session_presence_events.
3. **Given** the teacher manually marks no-show via `markNoShow()`, **when** the action runs, **then** the booking transitions to `no_show`, `no_show_party='student'` (or 'teacher' if teacher self-flags), and the package deduction is skipped or reverted depending on which party was absent.

### User Story 4 — Student or admin cancels a pending booking (Priority: P3)

Either the student (their own pending booking) or admin (any pending booking) can cancel before confirmation.

**Why this priority**: P3 — important for UX but does not block any other flow.

**Independent Test**: As student, cancel a pending booking. Verify `status='cancelled'`, `cancelled_by='student'`, `cancel_reason` and `cancelled_at` populated.

**Acceptance Scenarios**:

1. **Given** a `pending` booking, **when** the student cancels, **then** `status='cancelled'`, `cancelled_by='student'`, `cancelled_at=now()`. No package deduction.
2. **Given** a `confirmed` booking, **when** the student attempts to cancel without admin intervention, **then** the action rejects (cancellation of confirmed bookings requires admin path with refund/credit logic).

### Edge Cases

> *AI-drafted pending operator review.* Operator delegated drafting to the assistant; replace or extend with real production scars before merge or in a follow-up commit.

- **DST boundary in Egypt timezone.** Egypt reinstated DST in 2023; on spring-forward / fall-back nights, an availability slot at 02:30 local time either doesn't exist or exists twice. `bookings.scheduled_at` is stored in UTC so the row is unambiguous, but the student's picker shows local time and can land on the gap. Kuwait does not observe DST, so a Cairo↔Kuwait teacher pair has one calendar week per year of misalignment that the picker doesn't surface.
- **Last session in a package, then same-day cancellation.** Student has 1 session remaining, books at 14:00, cancels at 13:55. Per FR-009 the package balance was checked at create-time. If a legacy code path debited at confirm rather than at terminal `completed`, cancellation must credit back — the freeform `cancel_reason` (D-002) makes refund eligibility hard to bucket from admin reports.
- **Daily.co room created but never joined within TTL.** Teacher confirms at 09:00 for a 14:00 session; the room's default ~4h TTL means it's already expired when the student tries to join at 13:55. `recreateRoom()` is the operational mitigation but requires someone to notice. Distinct from PB-01 (which is room *creation* failure, not room *expiry*).
- **Teacher account suspended between confirm and session start.** Admin disables the teacher's account after `updateBookingStatus(...,'confirmed')` but before scheduled_at. The row stays `confirmed`; the no-show edge function eventually flips to `no_show` with `no_show_party='teacher'`, but the student already wasted the slot. No automatic notification cascades to the student today.
- **Slot race from two students.** Two `createBooking()` calls against the same `teacher_availability` row land within milliseconds. Without a unique constraint on `(teacher_id, scheduled_at)` for `status IN ('pending','confirmed')`, both inserts succeed. The overlap guard at confirm-time catches one, but only after both students saw "request submitted" — a UX surprise.
- **Package expires mid-pending.** Student books at 14:00 today; their `student_packages.expires_at` is 23:59 today; teacher confirms at 09:00 tomorrow. FR-009 checked balance at create-time only. The confirm path needs an expiry re-check or `deduct_package_session()` will silently fail or deduct from an inactive package.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: System MUST persist booking state in `bookings.status` using the `booking_status` enum (`pending | confirmed | cancelled | completed | no_show`). The `validate_booking_status` PostgreSQL trigger is authoritative for allowed transitions.
- **FR-002**: Only the assigned teacher (or admin) MUST be able to transition a booking from `pending` to `confirmed`. Students cannot self-confirm.
- **FR-003**: Confirmation MUST atomically create the corresponding `sessions` row and the Daily.co room. If room creation fails, the booking remains `pending`. (See PB-01.)
- **FR-004**: System MUST detect and reject overlapping bookings at confirmation time, regardless of whether the overlap is with a `pending` or `confirmed` row. (See PB-06.)
- **FR-005**: Cancellation MUST record `cancelled_by` (`student | teacher | admin | system`), `cancel_reason`, and `cancelled_at`. Silent cancellation is forbidden.
- **FR-006**: Terminal-state transitions (`completed`, `no_show`) MUST drive downstream effects exactly once: package deduction on `completed`, parent notification on `no_show`, retention signal write on either.
- **FR-007**: `no_show` MUST distinguish `no_show_party` (`student | teacher | both`). Package deduction is **skipped** when `no_show_party ∈ {teacher, both}`. (See PB-02.)
- **FR-008**: Every state-changing server action that writes to `bookings` MUST go through `loudAction` (per CLAUDE.md "No Silent Failures Policy"). [DRIFT — see "Known divergences from production" below.]
- **FR-009**: Booking creation MUST verify the student has remaining sessions in an active `student_packages` row before insert; an exhausted package MUST reject the request with a user-readable message.
- **FR-010**: Bookings MUST be visible in real time to: the student who created it (their `/student/bookings`), the teacher (their `/teacher/dashboard`), and admin (`/admin/bookings`). RLS policies enforce access boundaries; no role beyond these three (per ADR-0003) sees booking rows.

### Key Entities

- **Booking** (`public.bookings`): the canonical request-and-fulfillment record. Holds `student_id`, `teacher_id`, `scheduled_at`, `status`, `cancel_reason`, `cancelled_by`, `cancelled_at`, `no_show_party`, `created_at`. Foreign-keyed by `sessions.booking_id` (nullable as of `20260506053029_make_sessions_booking_id_nullable.sql`).
- **Session** (`public.sessions`): the run-time artifact created on confirmation. Holds `room_url`, `room_expires_at`, `started_at`, `ended_at`, `lesson_plan` (jsonb), and references back via `booking_id`.
- **TeacherAvailability** (`public.teacher_availability` + `availability_exceptions`): determines which slots `createBooking()` is allowed to reference.
- **StudentPackage** (`public.student_packages`): consulted at booking creation to verify remaining sessions; debited at terminal-state `completed` via `deduct_package_session(uuid)`.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: ≥99% of `pending` → `confirmed` transitions complete within 30 seconds of teacher click (Daily.co room creation latency budget).
- **SC-002**: Zero double-bookings reach `confirmed` state per month (PB-06 incidents = 0).
- **SC-003**: 100% of `completed` bookings result in exactly one `deduct_package_session` call (idempotency).
- **SC-004**: 100% of `no_show` rows with `no_show_party ∈ {teacher, both}` have **no** corresponding package deduction.
- **SC-005**: At 50k DAU scale, `bookings` write rate stays under DB connection-pool saturation; no booking action exceeds P95 latency 800ms.

## When this lifecycle fails

- **PB-01 — Daily.co room creation failed**: confirmation succeeded at the booking row but the session has no `room_url`. Resolve via Recreate Room button (`adminCreateRoom`) or rotate `DAILY_API_KEY`.
- **PB-06 — Booking conflict / double booking**: two students booked the same teacher slot. Move the later-booked student to a different slot or different teacher; offer credit session as goodwill.
- **PB-02 — Teacher missed a session** (downstream of `no_show` with `no_show_party='teacher'`): do **not** deduct the student's package, offer priority re-booking, flag teacher profile.

## Known divergences from production (filed as follow-up issues at end of Phase 1)

- **D-001**: `createBooking()` is exempt from `loudAction` per ADR-0002 §4 (redirect-style adapter — `useActionState` + redirect; wrapping would drop the `BookingResult` shape the optimistic UI consumes). `updateBookingStatus()` and `recreateRoom()` are similarly exempt (return `{ roomUrl, warning }` / `{ success, roomUrl }` consumed by caller UI). All three now have best-effort `audit_log` writes (`booking.confirmed`, `booking.cancelled`, `booking.room_recreated`) matching the `endSession` pattern. FR-008 is satisfied via inline hardening rather than `loudAction` wrapping.
- **D-002**: The `cancel_reason` column has no enum constraint — cancellations from different surfaces use freeform strings, making admin reporting noisy. Possible normalization candidate.
- **D-003**: `startInstantSession()` (`src/app/teacher/dashboard/actions.ts:694`) creates a booking + session inline without the package-balance check FR-009 requires. Edge case: instant session against an exhausted package.

## Assumptions

- Authentication and authorization happen at the route adapter via `requireRole(...)` (Constitution Principle IV). Domain functions in `src/lib/domains/booking/` receive already-authenticated structured input; FR-002 and FR-010's role-based access constraints are enforced at the boundary, not inside booking-domain functions.
- The `booking_status` enum is canonical and not extended in this PR.
- The `validate_booking_status` trigger is correct as deployed; this spec does not audit its CASE arms.
- Multi-tenancy is single-tenant (one academy, one Supabase project); RLS policies use role membership, not tenant_id.
- This spec covers `session_mode='private'` (1:1 bookings). Halaqa group bookings are governed by a separate enrollment flow under `src/app/student/halaqas/`; spec for that lives outside Phase 1.
