# Contract: `editHomework()`

**File**: `src/lib/actions/homework.ts:348`
**Caller role**: `teacher` (enforced at route adapter)
**State transition**: none — operates on an `assigned` or `student_ready` follow-up; updates editable fields only
**`loudAction` wrap**: ❌ Not yet (D-001)

## Input

```ts
type EditHomeworkInput = (homeworkId: string, formData: FormData);
// FormData fields: title, description?, due_at?, homework_type?, review_horizon?
```

## Output

```ts
type Result = { ok: true; message: string } | { ok: false; error: string };
```

## Pre-conditions checked

| Check | Where | FR |
|---|---|---|
| Caller is authenticated teacher | Route adapter | FR-002 |
| Homework row exists and `teacher_id = auth.uid()` | SELECT at line 354–357 | FR-002 |
| Status is NOT in any `completed_*` state (immutability) | TS comment guard at `homework.ts:370` | FR-007 |
| No session for this student-teacher pair has `scheduled_at > F.assigned_at` | TS check at line 388 | FR-006 |

## Side effects

- UPDATE `homework_assignments` SET (only the editable fields). Other columns (status, parent_assignment_id, audio_url, assigned_at) are not touched.
- No event emitted; no notify dispatched (edit is invisible to student until they next view).
- Optionally: `audit_log` insert for accountability.

## Failure modes

- Row in `completed_*` state: returns `{ error: "graded follow-ups are immutable" }`. Comment-only enforcement; admin SQL UPDATE could bypass (D-003).
- Edit window closed (next session has started): returns `{ error }`. Edit-window race possible (spec.md edge case 3).

## Drift from target

- **D-001**: not yet wrapped in `loudAction`.
- **D-003**: graded immutability is comment-only at line 370 — no DB constraint backstop.
