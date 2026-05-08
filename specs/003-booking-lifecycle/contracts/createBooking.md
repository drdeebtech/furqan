# Contract: `createBooking()`

**File**: `src/app/student/bookings/new/actions.ts:89`
**Caller role**: `student` (enforced at route adapter via `requireRole("student")`)
**State transition**: ∅ → `pending`
**`loudAction` wrap**: ❌ Not yet (D-001 in spec.md; Phase 2 remediation)

## Input

```ts
type CreateBookingInput = {
  teacherId: string         // uuid; must reference profiles where role='teacher'
  scheduledAt: string       // ISO 8601 timestamp in UTC
  durationMin: number       // default 30
  notes?: string            // optional student note to teacher
};
```

## Output

```ts
type BookingResult =
  | { ok: true; bookingId: string; message: string }
  | { ok: false; error: string };  // ad-hoc shape; not loudAction signature yet
```

## Pre-conditions checked

| Check | Where enforced | FR |
|---|---|---|
| Student is authenticated | Route adapter `requireRole("student")` | FR-002 |
| Teacher exists and is active | Server action SELECT | FR-001 |
| `scheduledAt` lies inside a `teacher_availability` slot | Server action JOIN check | FR-001 |
| `scheduledAt` is not blocked by `availability_exceptions` | Server action JOIN check | FR-001 |
| Student has no overlapping `pending`/`confirmed` booking | Server action overlap check | Acceptance Scenario 1.2 |
| Student has remaining sessions in active `student_packages` row | Server action + `sessions_remaining > 0` AND `expires_at > now()` AND `status = 'active'` | FR-009 |

## Side effects

- INSERT into `bookings` with `status='pending'`, `created_via='student_request'`.
- `notify(teacher_id, 'booking_request', ...)` — best-effort; failure logged via `logError`.
- `emitEvent('booking.created', { bookingId, teacherId, studentId })` — best-effort; routes to n8n.
- `audit_log` insert — best-effort.

## Failure modes

- Daily.co is NOT called at this step — room creation happens at confirm time only.
- Notify failure does NOT roll back the booking insert (Principle III: best-effort post-commit).
- Atomic insert is single-table; no SQL function needed (single owner-domain write).

## Drift from target

- **D-001**: not yet wrapped in `loudAction`. Today returns `{ ok, error }` directly. Target shape: `loudAction({ name: "student.create-booking", severity: "info", audit: {...}, handler: ... })`.
