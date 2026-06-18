# 013 — Tasks (execute in order; one commit at the end, do NOT push)

**Status:** All tasks complete; implementation landed in #458. This file is the close-out record.

Builder = OpenCode (zai-coding-plan/glm-5.1). Guardrails: edit only the files named below; do NOT
touch `supabase/migrations/20260428000000_remote_baseline.sql` or `supabase/migrations_archive/**`;
no schema/migration changes (app-layer only); no `db push`.

- [x] **T1 (M2)** `src/lib/actions/follow-up.ts:254` — replace the grade Zod with
  `z.enum(["completed_excellent","completed_good","completed_needs_work","completed_not_done"])`.
  Add a colocated test: `gradeFollowUp` with `grade:"bogus"` returns `{error}` and never calls the domain.
  **Done:** `gradeFollowUpSchema` in `src/lib/actions/follow-up-schemas.ts`; tests in `follow-up-zod.test.ts`.

- [x] **T2 (M3)** Field-whitelist `editFollowUp`:
  - `follow-up.ts:296` — `updates` Zod → `z.object({title,description,homework_type,surah_number,
    ayah_start,ayah_end,pages_count,due_date,teacher_notes})` (optional/nullable as today), `.strip()`.
  - `domains/follow-up/manage.ts:99-102` — build `finalUpdates` by explicitly picking the allowed
    fields from `updates` (no raw spread) + `updated_at`.
  - Test (`manage.test.ts`): calling `editFollowUp` with `updates` containing `status`/`teacher_id`
    writes an UPDATE payload with only whitelisted keys.
  **Done:** Action schema in `follow-up-schemas.ts`; domain `EDITABLE_FIELDS` pick at `manage.ts:131-150`; tests in `follow-up-zod.test.ts` (strip) + `manage.test.ts`.

- [x] **T3 (M1)** `src/app/teacher/sessions/[id]/actions.ts:205` — add the `schema:` from plan §M1
  (reuse `ProgressType`/`ErrorType` enums). Test: a non-integer `ayahFrom` and a bad `progressType`
  are rejected at the boundary (domain not reached).
  **Done:** `recordSessionProgressSchema` in `src/lib/actions/progress-schemas.ts`; tests in `follow-up-zod.test.ts`.

- [x] **T4 (M4)** `domains/follow-up/actions.ts:307-320` — validate the inherited range via
  `validateRange` before the regen insert; invalid → null range + `logError`; regen still succeeds.
  Test: out-of-range parent → child inserted with null range; valid parent → range preserved.
  **Done:** `validateRange` call + null-on-invalid + `logError("auto-regen dropped invalid inherited range")`.

- [x] **T5 (M5)** `follow-up.ts:85-92` — add `/admin/follow-up`, `/admin/follow-up/grade`,
  `/admin/dashboard` to `revalidateFollowUpPaths()`.
  **Done:** All three admin paths added to `revalidateFollowUpPaths`.

- [x] **T6 (LOW)** `domains/progress/validation.test.ts:4` — drop the unused `surahName` import.
  **Done:** Imports are now `validateRange, violationMessageAr, validateHomeworkRange` + `ayahCount, AYAH_COUNTS` only.

- [x] **T7 (gate)** `npx tsc --noEmit` clean; `npm run test:unit` green; lint the changed files clean.
  **Done (verified 2026-06-18 on `013-progress-action-hardening` branch):** tsc 0 errors; 49/49 follow-up + zod tests pass; full suite 645/645.

**Stop-and-report triggers:** any task needs a schema/migration change; any existing test breaks in a
way that implies a real behavior change (not just a new assertion); the whitelist breaks a legit edit field.
**None triggered.**
