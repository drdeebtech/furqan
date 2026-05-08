# Contract — `markReviewComplete` server action

**Caller**: student dashboard (Murajaah card buttons).
**Role gate**: `requireRole("student")`.
**Domain function**: `markComplete()` in `src/lib/domains/progress/murajaah.ts`.
**Atomicity**: per-row, via Postgres function `complete_review(p_schedule_id, p_quality)`.

---

## Signature

```ts
// src/app/student/dashboard/actions.ts
import { loudAction } from "@/lib/actions/loud";
import { requireRole } from "@/lib/auth/require-admin";
import { markComplete } from "@/lib/domains/progress/murajaah";
import { revalidatePath } from "next/cache";

export const markReviewComplete = loudAction({
  name: "student.murajaah.mark-review-complete",
  severity: "info",
  audit: {
    table: "student_review_schedule",
    recordId: i => i.scheduleId,
    action: "UPDATE",
  },
  handler: async ({ scheduleId, quality }: { scheduleId: string; quality: 3 | 4 | 5 }) => {
    const { id: studentId } = await requireRole("student");
    const result = await markComplete({ studentId, scheduleId, quality });
    revalidatePath("/student/dashboard");
    return { message: "تم تسجيل المراجعة" };
  },
});
```

## Input

| Field | Type | Validation |
|---|---|---|
| `scheduleId` | `string` (UUID) | exists in `student_review_schedule`; `student_id = auth.uid()` (RLS-enforced) |
| `quality` | `3 \| 4 \| 5` | mapped from button click; "احتجت مساعدة" → 3, "أنهيت المراجعة" → 4, "أنهيت بسهولة" → 5 (button hidden in v1) |

## Output

```ts
{ ok: true, message: "تم تسجيل المراجعة" }
| { ok: false, error: string }
```

The action returns through `loudAction`'s standard `{ ok, message?, error? }` envelope. The form renders `<ActionFeedback state={...} />` to surface the result.

## Error paths

| Error class | Trigger | User-facing message |
|---|---|---|
| `UnauthenticatedError` | no session | redirect to `/login` |
| `ForbiddenError` | session is not a student role | redirect to no-permission view |
| `BookingValidationError` (reused) | invalid `quality` value | "قيمة غير صالحة" |
| `Error` (Postgres "schedule row not found") | row deleted between dashboard load and click | "هذه المراجعة لم تعد متاحة" |

## Side effects (best-effort post-commit, per Constitution Principle III)

- `notify({ user_id: studentId, type: "murajaah.completed", title: ..., body: ... })` — *optional*; the click already gives feedback; only fired if user has opted into "encouragement messages" in `communication_preferences`.
- `emitEvent("murajaah.completed", { student_id, schedule_id, quality, new_ef })` — fire-and-forget to n8n for analytics.

Both wrapped in `logError` per CLAUDE.md "No Silent Failures Policy". Failures here do NOT roll back the DB write — the student saw their review marked complete, that is truth.

## Idempotency

The Postgres function `complete_review` runs `select ... for update` then a single UPDATE. Double-clicks within ~1s land back-to-back; the second one operates on the just-updated row, recomputes EF a tiny bit further, but no error. The dashboard removes the row optimistically on first click so the user can't double-submit easily.

## Test plan

- **Unit**: vi.mock the domain layer; verify input validation, audit-log shape, error class mapping.
- **Integration**: real Supabase test fixture; verify `complete_review` updates row + returns new state.
- **E2E**: Playwright sign-in as student, click "أنهيت المراجعة", verify row vanishes, verify next page load doesn't show the row.
