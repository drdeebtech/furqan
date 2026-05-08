# Contract: `deleteHomework()`

**File**: `src/lib/actions/homework.ts:482`
**Caller role**: `teacher` (own follow-up) or `admin`
**State transition**: hard-delete — row removed from `homework_assignments`
**`loudAction` wrap**: ❌ Not yet (D-001)

## Input

```ts
type DeleteHomeworkInput = (homeworkId: string);
```

## Output

```ts
type Result = { ok: true; message: string } | { ok: false; error: string };
```

## Pre-conditions checked

| Check | Where | FR |
|---|---|---|
| Caller is authenticated teacher or admin | Route adapter | FR-002 |
| Homework row exists and (teacher owns it OR admin) | SELECT with RLS | FR-002 |
| Status is `assigned` (per spec.md US5 AS 5.2) — guard against deleting `student_ready` rows | TS pre-check (verify presence — may be missing today) | spec.md AS 5.2 |

## Side effects

- DELETE from `homework_assignments`. Hard-delete; no soft-delete column.
- If the row has children (other rows referencing it via `parent_assignment_id`), the FK's implicit `NO ACTION` policy (Decision 6 / D-005) blocks the DELETE with a foreign key violation. The caller sees a generic FK error message — not a friendly "this follow-up has attempts and cannot be deleted" message.
- Best-effort: revoke any pending in-app notification for `homework_assigned` (if implemented; verify).
- Best-effort: `audit_log` insert with `severity='warning'`.

## Failure modes

- FK violation when row has auto-regen children: returns `{ error }` with raw FK message. Acceptance Scenario 5.1 says "row is removed AND any pending notification revoked"; current behaviour is more restrictive.
- Status is `student_ready` and the guard is missing: deletion succeeds and the student's submitted work is silently destroyed. **Verify this guard exists before merge** — if missing, file as a bug (extension of D-001).
- Status is `completed_*`: spec.md doesn't explicitly say teacher can't delete graded rows; current behaviour likely allows it. Phase 2 question — graded follow-ups arguably should not be hard-deletable for audit reasons.

## Drift from target

- **D-001**: not yet wrapped in `loudAction`. Hard-delete with possibly missing status guard is a high-leverage candidate for `loudAction`'s audit + Telegram routing.
- **D-005**: FK ON DELETE policy implicit. User-visible error message would improve once explicitly declared.
