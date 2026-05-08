# Contract — `markReteachComplete` server action

**Caller**: teacher panel "needs reteaching" section.
**Role gate**: `requireRole("teacher")` + teacher-student assignment check.
**Domain function**: `markReteach()` in `src/lib/domains/progress/murajaah.ts`.
**Atomicity**: per-row, via Postgres function `mark_reteach_complete(p_schedule_id)`.

---

## Signature

```ts
// src/app/teacher/students/[studentId]/actions.ts
export const markReteachComplete = loudAction({
  name: "teacher.murajaah.mark-reteach-complete",
  severity: "info",
  audit: {
    table: "student_review_schedule",
    recordId: i => i.scheduleId,
    action: "UPDATE",
  },
  handler: async ({ scheduleId, studentId }: { scheduleId: string; studentId: string }) => {
    const { id: teacherId } = await requireRole("teacher");
    await ensureTeacherAssigned(teacherId, studentId);
    await markReteach({ teacherId, studentId, scheduleId });
    revalidatePath(`/teacher/students/${studentId}`);
    return { message: "تم تسجيل إعادة التعليم" };
  },
});
```

## Input

| Field | Type | Validation |
|---|---|---|
| `scheduleId` | `string` (UUID) | exists; `student_id = studentId` |
| `studentId` | `string` (UUID) | teacher must be assigned to this student via `teacher_student_assignments` |

## Output

`{ ok: true, message: "تم تسجيل إعادة التعليم" } | { ok: false, error: string }`

## Error paths

| Error class | Trigger | Message |
|---|---|---|
| `UnauthenticatedError` | no session | redirect to `/login` |
| `ForbiddenError` | not a teacher OR not assigned to this student | 403 + "ليس لديك صلاحية لهذا الطالب" |
| Postgres "schedule row not found" | row deleted between load and click | "هذه المراجعة لم تعد متاحة" |

## Side effects (best-effort post-commit)

- `notify({ user_id: studentId, type: "murajaah.reteached", title: "تم تسجيل مراجعة جديدة", body: "أعاد معلمك تعليم آية كنت قد نسيتها." })` — student sees this in their bell.
- `emitEvent("murajaah.reteached", { teacher_id, student_id, schedule_id })` — n8n consumes for retention analytics.

Both wrapped in `logError`; never throw to caller.

## Database mutation

The Postgres function applies the lapse penalty atomically:

- `lapse_count = lapse_count + 1`
- `easiness_factor = max(1.3, easiness_factor * sm2_lapse_penalty)` — clamped to lower bound
- `interval_days = 1`
- `next_review_at = now() + interval '1 day'`
- `last_reviewed_at = now()`
- `batch_for_date = NULL`

The row will appear in tomorrow's batch as a fresh review, giving the student a chance to re-establish the memorisation under SM-2's tight initial interval.

## Test plan

- **Unit**: vi.mock domain layer; verify auth check (teacher not assigned → ForbiddenError), audit-log shape.
- **Integration**: real Supabase fixture with teacher_student_assignments seed; verify lapse_count++, EF reduction, interval reset.
- **E2E**: Playwright sign-in as teacher, navigate to assigned student's profile, click "تم إعادة التعليم" on a reteach row, verify row leaves the panel, verify it appears in tomorrow's student batch on next cron tick.
