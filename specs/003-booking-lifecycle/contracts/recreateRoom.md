# Contract: `recreateRoom()`

**File**: `src/app/teacher/dashboard/actions.ts:550`
**Caller role**: `teacher` (own session) or `admin`
**State transition**: none — operates on a `confirmed` booking; updates `sessions.room_url` only
**`loudAction` wrap**: ❌ Not yet (D-001; Phase 2)

## Input

```ts
type RecreateRoomInput = { bookingId: string };  // uuid
```

## Output

```ts
type Result = { ok: true; roomUrl: string; message: string } | { ok: false; error: string };
```

## Why this exists

PB-01 routing: when Daily.co room creation failed mid-confirm, or the room TTL has expired before the session window (edge case 3), the teacher (or admin) needs an idempotent way to mint a fresh room URL without changing the booking state.

## Side effects

1. **External**: Daily.co `createRoom(...)`. Runs first.
2. UPDATE `sessions` SET `room_url=..., room_expires_at=...`. No `bookings` UPDATE.
3. Post-commit: `notify(student_id, 'session_room_updated', ...)` so the student refetches the join link; `audit_log`.

## Pre-conditions

- Booking is `confirmed` (not `pending`, not terminal).
- Caller is the teacher or admin.
- No active room session (Daily.co reports no active participants for the existing room).

## Failure modes

- Daily.co outage: returns `{ error }`. No DB write.
- Race with auto-recreate (n8n self-healing workflow): Daily.co createRoom is idempotent on the FURQAN side; second create just overwrites `room_url`. Acceptable.

## Drift from target

- **D-001**: not yet `loudAction`-wrapped. This action is most-often called during operational incident response (PB-01); the lack of `<ActionFeedback>` rendering means a teacher recovering from a Daily.co outage gets minimal feedback. High-leverage candidate for the Phase 2 wrap pass.
