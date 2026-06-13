# 013 — Plan

Reuse existing types/enums; add boundary Zod + domain whitelist. No new files unless noted.

## M1 — `recordSessionProgressBase` Zod schema

`src/app/teacher/sessions/[id]/actions.ts` — add a `schema:` to the `loudAction` config matching
`RecordSessionProgressInput`. Reuse the domain enums (`ProgressType`, `StudentLevel`, `ErrorType`,
`CapturedError`) from `@/lib/domains/progress/types`:

```ts
schema: z.object({
  sessionId: z.string().uuid(),
  bookingId: z.string().uuid(),
  progressType: z.enum(["new","muraja","correction"]),
  surahFrom: z.number().int().nullable(),
  ayahFrom: z.number().int().nullable(),
  surahTo: z.number().int().nullable(),
  ayahTo: z.number().int().nullable(),
  pagesReviewed: z.number().int().nonnegative().nullable().optional(),
  qualityRating: z.number().int().min(1).max(5).nullable().optional(),
  level: z.enum(["beginner","intermediate","advanced"]).optional(),
  teacherNotes: z.string().nullable().optional(),
  errors: z.array(z.object({
    surahNum: z.number().int(), ayahNum: z.number().int(),
    errorType: z.enum(["makharij","sifat","madd","waqf","ghunna","other"]),
    note: z.string().nullable().optional(),
  })).optional(),
}) as unknown as z.ZodType<RecordSessionProgressInput>
```

Range *correctness* still belongs to the domain `validateRange` + DB trigger; this is shape/bounds DiD.

## M2 — `gradeFollowUp` grade enum

`src/lib/actions/follow-up.ts:254` — replace
`grade: z.string() as unknown as z.ZodType<HomeworkStatus>` with
`grade: z.enum(["completed_excellent","completed_good","completed_needs_work","completed_not_done"])`.
(Mirror the domain `VALID_GRADES` in `domains/follow-up/actions.ts` — keep them in sync; a comment cross-refs.)

## M3 — `editFollowUp` field whitelist (action + domain)

- Action (`follow-up.ts:296`): replace `updates: z.record(z.string(), z.unknown())` with a `z.object({...})`
  of ONLY editable fields (`title, description, homework_type, surah_number, ayah_start, ayah_end,
  pages_count, due_date, teacher_notes`), each optional/nullable as today; `.strip()` unknown keys.
- Domain (`domains/follow-up/manage.ts:99-102`): do NOT spread raw `updates`. Pick the allowed fields
  explicitly into `finalUpdates` (whitelist), then add `updated_at`. So a bypass of the action layer
  still cannot write `teacher_id/student_id/status/audio_url/parent_assignment_id`.

## M4 — auto-regen range validation (DiD)

`domains/follow-up/actions.ts:307-320` — before the regen insert, run `validateRange` (import from
`@/lib/domains/progress/validation`) on the parent `{surah_number, ayah_start, ayah_end}` (single-surah:
`surahFrom=surahTo=surah_number`). If invalid → insert with `surah_number/ayah_start/ayah_end = null`
and `logError(... "auto-regen dropped invalid inherited range")`; regen still succeeds. Valid → unchanged.

## M5 — admin revalidation

`follow-up.ts:85-92` — add to `revalidateFollowUpPaths()`:
`revalidatePath("/admin/follow-up"); revalidatePath("/admin/follow-up/grade"); revalidatePath("/admin/dashboard");`

## LOW — lint warning

`domains/progress/validation.test.ts:4` — remove the unused `surahName` import (or prefix `_`).

## Tests (vitest, colocated)

- M2: `gradeFollowUp` Zod rejects `grade:"bogus"` (action returns error, domain not reached).
- M3: action Zod strips an injected `status`/`teacher_id`; domain `editFollowUp` test asserts the
  UPDATE payload contains only whitelisted keys even when `updates` includes `status`.
- M4: regen with an out-of-range parent range inserts null range + logs; valid range inserts as-is.
- M1: `recordSessionProgress` rejects a non-integer `ayahFrom` / bad `progressType` at the boundary.

## Verify (orchestrator, read-only)

`npx tsc --noEmit` · `npm run test:unit` · lint the changed files only (repo-wide lint is pre-existing-red).
