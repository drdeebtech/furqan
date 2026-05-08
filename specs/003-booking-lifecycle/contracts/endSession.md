# Contract: `endSession()`

**File**: `src/app/teacher/dashboard/actions.ts:363`
**Caller role**: `teacher` (own session) or `admin`
**State transition**: `confirmed → completed`
**`loudAction` wrap**: ✅ Already wrapped

## Input

```ts
type EndSessionInput = { sessionId: string };  // uuid
```

## Output

```ts
type Result = { ok: true; message: string } | { ok: false; error: string };
// loudAction signature
```

## Side effects (atomic critical path)

1. UPDATE `sessions` SET `ended_at=now()`.
2. UPDATE `bookings` SET `status='completed'` for the corresponding `booking_id`.
3. CALL `deduct_package_session(p_booking_id)` — Postgres function. Idempotent on `(booking_id, student_package_id)`. SC-003.
4. Post-commit (best-effort):
   - `notify(student_id, 'session_completed', ...)`
   - `emitEvent('session.ended', { sessionId, bookingId })`
   - `audit_log` insert

## Failure modes

- `deduct_package_session()` failure (e.g. package row mutated mid-transaction): SQL function rolls back atomically; bookings stays `confirmed`, session stays unended. Teacher retries.
- Failure of step 2 (booking UPDATE) is caught at the trigger layer if anything other than `confirmed` is the current status.
- `endSession: bookings status=completed update failed` — explicit `logError` at `src/app/teacher/dashboard/actions.ts:427` for the rare case of partial failure.

## Existing instrumentation

- Wrapped via `loudAction({ name: 'teacher.end-session', ... })`.
- Audit hook captured per `audit_log` schema.
- Drift D-001 does NOT apply to this action.
