# Audit: Progress-Write Server Actions

**Date:** 2026-06-12
**Scope:** `src/lib/actions/follow-up.ts`, `src/lib/domains/follow-up/actions.ts`,
`src/lib/domains/follow-up/manage.ts`, `src/lib/domains/progress/capture.ts`,
`src/app/teacher/sessions/[id]/actions.ts`

**Method:** Three-lens review (full-stack engineer · Quran teacher · teaching-platform expert)

---

## Findings Checklist

### 🛠 Full-Stack Engineer

- [x] **[MEDIUM] `recordSessionProgressBase` has no Zod schema** — closed via #458
  `src/app/teacher/sessions/[id]/actions.ts:204` — the `loudAction` config omits a `schema:` key entirely. Every other loudAction boundary declares one. Structured input (`surahFrom`, `ayahFrom`, `progressType`, etc.) passes to the domain with no Zod validation; only the domain and DB trigger stand as guards.
  **Fix:** `recordSessionProgressSchema` (in `src/lib/actions/progress-schemas.ts`) wired into the loudAction config; covers `progressType` enum, integer bounds, `qualityRating` 1-5, `errors[].errorType` enum. Tests in `src/lib/actions/follow-up-zod.test.ts`.

- [x] **[MEDIUM] `gradeFollowUp` Zod schema accepts any string for `grade`** — closed via #458
  `src/lib/actions/follow-up.ts:251` — `z.string() as unknown as z.ZodType<HomeworkStatus>` passes Zod for any string. `VALID_GRADES.includes()` in the domain is the only enforcement. Replace with `z.enum(["completed_excellent", "completed_good", "completed_needs_work", "completed_not_done"])`.
  **Fix:** `gradeFollowUpSchema` in `src/lib/actions/follow-up-schemas.ts` now uses `z.enum([...])`. Test covers `"bogus"` + non-grade status `"assigned"` rejection.

- [x] **[MEDIUM] `editFollowUp` domain spreads an unbounded `updates` object directly into the DB write** — closed via #458
  `src/lib/domains/follow-up/manage.ts:99-102` — `{ ...updates, updated_at: ... }` with no field whitelist. The Zod schema (`z.record(z.string(), z.unknown())`) accepts any column name. Fields like `teacher_id`, `student_id`, `status`, `audio_url`, and `parent_assignment_id` can be injected by a caller who bypasses the form.
  **Fix:** Action Zod (`editFollowUpUpdatesSchema`) is a strict `z.object({...9 fields...}).strip()`; domain (`manage.ts:131-150`) builds `finalUpdates` by explicitly picking `EDITABLE_FIELDS` — no raw spread. Test verifies injected `status`/`teacher_id`/`student_id` are stripped at both layers.

- [ ] **[LOW] `markStudentReady` DB update has no `.select("id")` return check**
  `src/lib/domains/follow-up/actions.ts:188-193` — an RLS-denied update returns `error: null` + empty data and is silently treated as success. Compare: `savePostSessionNotes` explicitly adds `.select("id")` and checks `data.length === 0` for this exact reason.

- [ ] **[LOW] Double `auth.getUser()` call per `createFollowUp` invocation**
  `src/lib/actions/follow-up.ts:134,136` — `preflight` calls `requireUserId()` then the handler calls `teacherOrAboveActor()`, each independently creating a client and calling `auth.getUser()`.

- [ ] **[LOW] `deleteFollowUp` handler uses `anyAuthedActor()` despite audit prefix labelling it "teacher delete"**
  `src/lib/actions/follow-up.ts:387-389` — any authenticated user (including students) reaches this path; `assertCanManage` in the domain rejects non-teachers, but the unnecessary attack surface and misleading audit label are both wrong.

---

### 📖 Quran Teacher

- [x] **[HIGH] No surah/ayah range validation for homework assignments on create or edit** — closed via #458
  `src/lib/actions/follow-up.ts:120-123, 321-326` — `surah_number`, `ayah_start`, `ayah_end` accept any integer through Zod. `validateRange()` (used by ḥifẓ capture) is never called here. The `student_progress_ayah_range_guard` DB trigger covers `student_progress` only, not `homework_assignments`.
  **Fix:** `validateHomeworkRange` called at `follow-up.ts:144` (create path); `validateRange` at `manage.ts:84` (edit path). Invalid ranges rejected with Arabic user-facing error.

- [x] **[MEDIUM] Auto-regen inherits unvalidated ayah data from the parent row** — closed via #458
  `src/lib/domains/follow-up/actions.ts:307-320` — child assignments copy the parent's `surah_number/ayah_start/ayah_end` verbatim. Invalid range data propagates across every regenerated follow-up.
  **Fix:** Regen path now runs `validateRange` on the inherited range; invalid → range set to null + `logError("auto-regen dropped invalid inherited range")`, regen still succeeds.

- [ ] **[LOW] Truthy check on `surah_number` in FormData parse is ambiguous**
  `src/lib/actions/follow-up.ts:163` — `formData.get("surah_number") ? Number(...) : null` coerces `"0"` to `null` instead of `0`. Should use an explicit `!= null && value !== ""` check.

---

### 🎓 Teaching-Platform Expert

- [x] **[HIGH] Tajweed error annotations are silently dropped in `recordSessionProgress`** — closed via #458
  `src/app/teacher/sessions/[id]/actions.ts:189-268` — `RecordProgressInput` carries `errors?: CapturedError[]` for per-ayah tajweed mistakes (makharij, madd, waqf, ghunna, etc.) but `RecordSessionProgressInput` defines no `errors` field and the handler never passes them to `recordProgress()`.
  **Fix:** `recordSessionProgressSchema` now declares `errors` (with `errorType` enum, `.max(500)`); handler persists them. The "no errors observed" sentinel (`__no_errors_observed_sentinel__`) handles the explicit no-errors case.

- [x] **[MEDIUM] Admin routes not revalidated after follow-up mutations** — closed via #458
  `src/lib/actions/follow-up.ts:85-92` — `revalidateFollowUpPaths()` covers `/teacher/**` and `/student/**` only; admin dashboards see stale data after any create, grade, or delete.
  **Fix:** `revalidateFollowUpPaths()` now also calls `revalidatePath` for `/admin/follow-up`, `/admin/follow-up/grade`, and `/admin/dashboard`.

- [ ] **[LOW] `gradeFollowUp` uses `severity: "warning"` for all outcomes including `completed_excellent`**
  `src/lib/actions/follow-up.ts:249` — warning severity is correct for `completed_not_done` but pollutes audit-log filtering for excellent/good grades.

---

## Priority Order

1. `[HIGH]` Surah/ayah validation on homework create/edit (Quran integrity)
2. `[HIGH]` Tajweed error annotations dropped silently (data loss)
3. `[MEDIUM]` `recordSessionProgressBase` missing Zod schema (defense in depth)
4. `[MEDIUM]` `editFollowUp` unbounded `updates` spread (authz gap)
5. `[MEDIUM]` `gradeFollowUp` Zod grade enum (type safety)
6. `[MEDIUM]` Auto-regen propagates bad ayah data (Quran integrity)
7. `[MEDIUM]` Admin paths not revalidated (stale UI)
8. `[LOW]` Remaining lows (double auth, `anyAuthedActor`, `.select()` check, truthy parse, severity)
