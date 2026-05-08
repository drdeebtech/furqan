# Contract: `gradeHomework()`

**File**: `src/lib/actions/homework.ts:221`
**Caller role**: `teacher` (enforced at route adapter)
**State transition**: `student_ready → completed_excellent | completed_good | completed_needs_work | completed_not_done`
**Auto-regeneration**: triggers when grade is `completed_needs_work` or `completed_not_done`
**`loudAction` wrap**: ❌ Not yet (D-001)

## Input

```ts
type GradeHomeworkInput = (homeworkId: string, formData: FormData);
// FormData fields: grade ('excellent' | 'good' | 'needs_work' | 'not_done'), feedback?
```

## Output

```ts
type Result = { ok: true; message: string } | { ok: false; error: string };
```

## Pre-conditions checked

| Check | Where | FR |
|---|---|---|
| Caller is authenticated teacher | Route adapter | FR-002 |
| Homework row exists and `teacher_id = auth.uid()` | Server action SELECT | FR-002 |
| Status is currently `student_ready` (TS guard at `homework.ts:252`) | TS pre-check rejects otherwise | FR-001 |
| `grade` is one of the four valid values | TS type | FR-001 |

## Side effects (atomic critical path — Principle III ⚠️)

1. UPDATE `homework_assignments` SET `status='completed_<grade>'`, `graded_at=now()`, `feedback=<provided>`.
2. **Conditional auto-regen** (when `grade IN ('needs_work', 'not_done')`): INSERT new `homework_assignments` row with `status='assigned'`, `parent_assignment_id=<original.id>`, same `student_id` / `teacher_id` / `homework_type` / `review_horizon`.
3. Post-commit (best-effort):
   - `notify(student_id, 'homework_<grade>', ...)` — different template per grade.
   - On `not_done` only: also `notify(parent, 'homework_not_done', ...)` via parent path (PB-04 routing).
   - `emitEvent('homework.graded', ...)` at `homework.ts:341`.
   - `audit_log` insert.

## Atomicity concern (research item)

Steps 1 and 2 above run as separate Supabase JS client calls. Whether they execute in the same DB transaction depends on PostgREST connection behavior — Supabase JS does NOT implicitly wrap multiple `.from()` calls. Per `research.md` Decision 2, this is the open Phase 2 question. **A failure between step 1 and step 2 could leave a `completed_needs_work` row with no auto-regen child.** spec.md SC-002 currently asserts atomicity; verify before merging this PR or add caveat.

Verification path: inject a CHECK-constraint failure on the auto-regen INSERT (e.g., temporary CHECK that always rejects); observe whether step 1's UPDATE rolls back.

## Failure modes

- TS guard rejection (status != student_ready): returns `{ error }`.
- Auto-regen INSERT fails (FK violation, CHECK violation): may or may not roll back step 1 — see atomicity concern.
- Notify or event-emit failure: best-effort; logged via `logError`.

## Drift from target

- **D-001**: not yet wrapped in `loudAction`.
- Atomicity not yet verified (research item).
- No depth cap on `parent_assignment_id` chain (D-004 / spec.md edge case 1).
