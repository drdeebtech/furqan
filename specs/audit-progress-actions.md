# Audit: Progress-Write Server Actions

**Date:** 2026-06-12
**Scope:** `src/lib/actions/follow-up.ts`, `src/lib/domains/follow-up/actions.ts`,
`src/lib/domains/follow-up/manage.ts`, `src/lib/domains/progress/capture.ts`,
`src/app/teacher/sessions/[id]/actions.ts`

**Method:** Three-lens review (full-stack engineer · Quran teacher · teaching-platform expert)

---

## Findings Checklist

### 🛠 Full-Stack Engineer

- [ ] **[MEDIUM] `recordSessionProgressBase` has no Zod schema**
  `src/app/teacher/sessions/[id]/actions.ts:204` — the `loudAction` config omits a `schema:` key entirely. Every other loudAction boundary declares one. Structured input (`surahFrom`, `ayahFrom`, `progressType`, etc.) passes to the domain with no Zod validation; only the domain and DB trigger stand as guards.

- [ ] **[MEDIUM] `gradeFollowUp` Zod schema accepts any string for `grade`**
  `src/lib/actions/follow-up.ts:251` — `z.string() as unknown as z.ZodType<HomeworkStatus>` passes Zod for any string. `VALID_GRADES.includes()` in the domain is the only enforcement. Replace with `z.enum(["completed_excellent", "completed_good", "completed_needs_work", "completed_not_done"])`.

- [ ] **[MEDIUM] `editFollowUp` domain spreads an unbounded `updates` object directly into the DB write**
  `src/lib/domains/follow-up/manage.ts:99-102` — `{ ...updates, updated_at: ... }` with no field whitelist. The Zod schema (`z.record(z.string(), z.unknown())`) accepts any column name. Fields like `teacher_id`, `student_id`, `status`, `audio_url`, and `parent_assignment_id` can be injected by a caller who bypasses the form.

- [ ] **[LOW] `markStudentReady` DB update has no `.select("id")` return check**
  `src/lib/domains/follow-up/actions.ts:188-193` — an RLS-denied update returns `error: null` + empty data and is silently treated as success. Compare: `savePostSessionNotes` explicitly adds `.select("id")` and checks `data.length === 0` for this exact reason.

- [ ] **[LOW] Double `auth.getUser()` call per `createFollowUp` invocation**
  `src/lib/actions/follow-up.ts:134,136` — `preflight` calls `requireUserId()` then the handler calls `teacherOrAboveActor()`, each independently creating a client and calling `auth.getUser()`.

- [ ] **[LOW] `deleteFollowUp` handler uses `anyAuthedActor()` despite audit prefix labelling it "teacher delete"**
  `src/lib/actions/follow-up.ts:387-389` — any authenticated user (including students) reaches this path; `assertCanManage` in the domain rejects non-teachers, but the unnecessary attack surface and misleading audit label are both wrong.

---

### 📖 Quran Teacher

- [ ] **[HIGH] No surah/ayah range validation for homework assignments on create or edit**
  `src/lib/actions/follow-up.ts:120-123, 321-326` — `surah_number`, `ayah_start`, `ayah_end` accept any integer through Zod. `validateRange()` (used by ḥifẓ capture) is never called here. The `student_progress_ayah_range_guard` DB trigger covers `student_progress` only, not `homework_assignments`.

- [ ] **[MEDIUM] Auto-regen inherits unvalidated ayah data from the parent row**
  `src/lib/domains/follow-up/actions.ts:307-320` — child assignments copy the parent's `surah_number/ayah_start/ayah_end` verbatim. Invalid range data propagates across every regenerated follow-up.

- [ ] **[LOW] Truthy check on `surah_number` in FormData parse is ambiguous**
  `src/lib/actions/follow-up.ts:163` — `formData.get("surah_number") ? Number(...) : null` coerces `"0"` to `null` instead of `0`. Should use an explicit `!= null && value !== ""` check.

---

### 🎓 Teaching-Platform Expert

- [ ] **[HIGH] Tajweed error annotations are silently dropped in `recordSessionProgress`**
  `src/app/teacher/sessions/[id]/actions.ts:189-268` — `RecordProgressInput` carries `errors?: CapturedError[]` for per-ayah tajweed mistakes (makharij, madd, waqf, ghunna, etc.) but `RecordSessionProgressInput` defines no `errors` field and the handler never passes them to `recordProgress()`.

- [ ] **[MEDIUM] Admin routes not revalidated after follow-up mutations**
  `src/lib/actions/follow-up.ts:85-92` — `revalidateFollowUpPaths()` covers `/teacher/**` and `/student/**` only; admin dashboards see stale data after any create, grade, or delete.

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
