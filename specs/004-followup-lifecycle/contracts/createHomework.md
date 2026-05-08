# Contract: `createHomework()`

**File**: `src/lib/actions/homework.ts:44`
**Caller role**: `teacher` (enforced at route adapter via `requireRole("teacher")`)
**State transition**: ∅ → `assigned`
**`loudAction` wrap**: ❌ Not yet (D-001)

## Input

```ts
type CreateHomeworkInput = FormData; // multipart form
// Fields: booking_id, student_id, homework_type, title, description?, due_at?, review_horizon?
```

Note: this action takes raw `FormData`, not a typed object (a Phase 2 ergonomic improvement candidate).

## Output

```ts
type Result =
  | { ok: true; homeworkId: string; message: string }
  | { ok: false; error: string };
```

## Pre-conditions checked

| Check | Where | FR |
|---|---|---|
| Caller is authenticated teacher | Route adapter `requireRole("teacher")` | FR-002 |
| `booking_id` belongs to caller (teacher_id matches) | Server action SELECT join | FR-002 |
| `student_id` was a participant in the booking | Server action SELECT join | FR-002 |
| `homework_type` is a valid enum value | TS type | FR-001 |

## Side effects

- INSERT into `homework_assignments` with `status='assigned'`, `assigned_at=now()`, `review_horizon` defaulting to `none` if not provided.
- `notify(student_id, 'homework_assigned', ...)` — best-effort; piped through `logError` per Constitution Principle II.
- `emitEvent('homework.assigned', ...)` — best-effort; routes to n8n at `homework.ts:124`.
- `audit_log` insert — best-effort.

## Failure modes

- Booking does not belong to caller: returns `{ error }`. No insert.
- INSERT fails (e.g., FK violation on `booking_id`): returns `{ error }`. No event emitted.
- Notify failure does NOT roll back the insert (Principle III: best-effort post-commit).

## Drift from target

- **D-001**: not yet wrapped in `loudAction`. Target shape: `loudAction({ name: "teacher.create-followup", severity: "info", audit: {...}, handler: ... })`.
