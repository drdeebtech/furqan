# Contract: `updateBookingStatus()`

**File**: `src/app/teacher/dashboard/actions.ts:34`
**Caller role**: `teacher` (own bookings) or `admin` (any booking) — enforced at route adapter
**State transition**: `pending → confirmed | cancelled` (teacher) | `confirmed → cancelled` (admin only)
**`loudAction` wrap**: ❌ Not yet (D-001; Phase 2)

## Input

```ts
type UpdateBookingStatusInput = {
  bookingId: string                                    // uuid
  newStatus: 'confirmed' | 'cancelled'                 // 'completed'/'no_show' have dedicated actions
  cancelReason?: string                                // required if newStatus='cancelled'
};
```

## Output

```ts
type Result = { ok: true; message: string } | { ok: false; error: string };
```

## Pre-conditions checked (TS layer; trigger is authoritative)

| Check | Where | FR |
|---|---|---|
| Caller is the booking's teacher OR admin | Route adapter | FR-002 |
| Booking is in `pending` state (for confirm) | TS pre-check; `validate_booking_status` trigger backstop | FR-001 |
| Teacher has no overlapping `confirmed` booking at `scheduled_at` | TS overlap query | FR-004, SC-002 |
| If cancel: `cancel_reason` non-empty | TS validation | FR-005 |

## Side effects (confirm path)

Atomic critical path (Principle III):

1. **External**: Daily.co `createRoom({ properties: { exp, max_participants: 2 } })` — runs FIRST.
2. **DB**: SQL function `confirm_booking_with_session(p_booking_id, p_room_url, p_room_expires_at)` — flips `bookings.status='confirmed'` and upserts `sessions` row in one transaction.
3. **Post-commit (best-effort)**:
   - `notify(student_id, 'booking_confirmed', ...)` via dispatcher
   - `emitEvent('booking.confirmed', { bookingId, teacherId, studentId })` → n8n room-creation workflow (idempotent if Daily.co already created)
   - `audit_log` insert

## Side effects (cancel path)

1. UPDATE `bookings` SET `status='cancelled', cancelled_by, cancel_reason, cancelled_at=now()`. No SQL function needed; single-row UPDATE.
2. Post-commit: `notify` opposite party; `emitEvent('booking.cancelled')`; `audit_log`.

## Failure modes

- **Daily.co failure**: external call returns 4xx/5xx. SQL function never runs. Booking stays `pending`. Surfaces to teacher via current `{ error }` (target: loudAction). Routes to PB-01.
- **Trigger rejection**: someone tries an invalid transition (e.g. `completed → confirmed`). Trigger raises; TS catches and returns `{ error: 'invalid transition' }`.
- **Overlap race**: two confirms simultaneously. SC-002 says zero double-bookings; the slot-uniqueness invariant is enforced by index on `(teacher_id, scheduled_at) WHERE status IN ('pending', 'confirmed')` (planned; see edge case 5 — current state may not have this UNIQUE constraint).

## Drift from target

- **D-001**: not yet wrapped in `loudAction`. The action references `validate_booking_status` trigger backstop in a comment at line 226 — that comment hints at the brittleness of the current shape (TS pre-check duplicating the trigger).
