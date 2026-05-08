# Contract: `markStudentReady()`

**File**: `src/lib/actions/homework.ts:139`
**Caller role**: `student` (enforced at route adapter)
**State transition**: `assigned → student_ready`
**`loudAction` wrap**: ❌ Not yet (D-001)

## Input

```ts
type MarkStudentReadyInput = (homeworkId: string, audioFile?: File);
```

The function accepts an optional audio file. If present, it is uploaded to Supabase Storage before the status flip.

## Output

```ts
type Result = { ok: true; message: string } | { ok: false; error: string };
```

## Pre-conditions checked

| Check | Where | FR |
|---|---|---|
| Caller is authenticated student | Route adapter `requireRole("student")` | FR-003 |
| Homework row exists and `student_id = auth.uid()` | Server action SELECT | FR-003 |
| Status is currently `assigned` (TS guard at `homework.ts:156`) | TS pre-check returns "حالة المتابعة لا تسمح بهذا الإجراء" if not | FR-001 |

## Side effects (sequential — Principle III concern)

1. **External (if audio)**: upload file to Supabase Storage bucket `homework-audio/<student_id>/<homework_id>.<ext>`. Runs FIRST.
2. **DB**: UPDATE `homework_assignments` SET `status='student_ready'`, `student_ready_at=now()`, `audio_url=<signed URL>`, `audio_duration_seconds=<length>`.
3. **Post-commit (best-effort)**:
   - `notify(teacher_id, 'homework_ready', ...)` (FR-009)
   - `emitEvent('homework.student_ready', ...)` at `homework.ts:214`
   - `audit_log` insert

## Failure modes

- **Storage upload failure**: returns `{ error }`. No DB update. Audio orphan does NOT happen because nothing was uploaded.
- **DB update failure after successful Storage upload**: leaves an orphan file in Storage. Edge case 2 in spec.md. No transactional path between Storage and DB today.
- **TS guard rejection (status != assigned)**: returns `{ error: "حالة المتابعة لا تسمح بهذا الإجراء" }`. No state change.

## Drift from target

- **D-001**: not yet wrapped in `loudAction`.
- Storage upload + status flip is sequential without rollback (spec.md edge case 2). Phase 2 candidate: implement transactional cleanup or move to a single Postgres function that returns a one-shot signed URL pre-flight.
