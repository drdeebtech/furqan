# Tasks: Ḥifẓ Progress Capture (010)

**Spec**: [spec.md](./spec.md) · **Plan**: [plan.md](./plan.md) · **Data model**: [data-model.md](./data-model.md) · **Contract**: [contracts/record-student-progress.md](./contracts/record-student-progress.md)

## Format: `[ID] [P?] [Story] Description`
- **[P]** = parallelizable (different files, no dependency). **[USn]** = user story.

---

## Phase 1: Setup
- [ ] **T001** Create the Progress domain folder `src/lib/domains/progress/` and `src/lib/quran/ayah-counts.ts` placeholder.

## Phase 2: Foundational (blocking prerequisites — the validation backbone)
- [ ] **T002** Migration: `create_quran_surahs_reference` — `quran_surahs` table + RLS (read-all-auth, write service-role) + **114-row Ḥafṣ/Madanī seed** with a citation comment. (`./scripts/new-migration.sh`)
- [ ] **T003** [P] `src/lib/quran/ayah-counts.ts` — `AYAH_COUNTS` (114 fixed values), derived from the same canonical source as T002.
- [ ] **T004** [P] `src/lib/domains/progress/validation.ts` — pure `validateRange(...)` using `AYAH_COUNTS` (returns first violation: `ayahFrom`/`ayahTo`/`order`).
- [ ] **T005** Migration: `student_progress_ayah_range_guard` — `ayah_*>=1` CHECKs + `validate_student_progress_range()` BEFORE INSERT/UPDATE trigger (reads `quran_surahs`). Depends on T002.
- [ ] **T006** Migration: `recitation_errors_require_surah` — CHECK `surah_num NOT NULL OR note = sentinel`.
- [ ] **T007** Migration: `record_student_progress_fn` — atomic upsert(progress) + replace(errors) function (`security definer`, fixed `search_path`). Depends on T005/T006. Add its signature to `src/types/database.ts` Functions.
- [ ] **T008** Add `"progress.recorded"` key to `WEBHOOK_ROUTES` in `src/lib/automation/emit.ts` (`FurqanEvent` extends automatically).

**Checkpoint**: schema + validation backbone exist; impossible ranges are already DB-unrepresentable (verifiable independently of any UI).

## Phase 3: User Story 1 — Teacher captures (P1) 🎯 MVP
### Tests (write first / alongside)
- [ ] **T009** [P] [US1] `validation.test.ts` — valid ranges, Al-Fātiḥah-300, ayah 0, surah 115, cross-sūrah, single-āyah; + `AYAH_COUNTS` ↔ seed parity test.
- [ ] **T010** [US1] Local-PG harness test (brew-PG, the #346/#365/#366 method): trigger rejects impossible range from raw SQL; `record_student_progress` is atomic (forced error → no progress row) and idempotent (two calls → one row).
### Implementation
- [ ] **T011** [P] [US1] `src/lib/domains/progress/types.ts` — `RecordProgressInput/Outcome` + error mapping.
- [ ] **T012** [US1] `src/lib/domains/progress/capture.ts` — `recordProgress(admin, input)`: action-layer `validateRange` (Arabic msg) → `rpc("record_student_progress")` → map `23514`/`P0001` to outcomes. Depends on T004, T007, T011.
- [ ] **T013** [P] [US1] `capture.test.ts` — outcome mapping (ok / invalid_range / not_found / error) via mocked admin client.
- [ ] **T014** [US1] Route adapter `recordSessionProgress` in `src/app/teacher/sessions/[id]/actions.ts` — `loudAction`, getUser + owns-booking check (Principle IV), FormData→input, call `recordProgress`, `revalidatePath`, best-effort `emitEvent("progress.recorded")`. Depends on T012, T008.
- [ ] **T015** [US1] Extend `src/app/teacher/sessions/[id]/post-session-form.tsx` — progress-type select, Arabic sūrah dropdowns (`SURAHS`), āyah inputs bounded by `AYAH_COUNTS[surah]`, optional pages/quality, recitation-errors mini-list; render `<ActionFeedback state={…} />`. Depends on T014.

**Checkpoint (MVP)**: a teacher records a validated range end-to-end; impossible ranges blocked with an Arabic message; `001` now has a data source.

## Phase 4: User Story 2 — Student sees real progress (P2)
- [ ] **T016** [US2] `src/app/student/progress/` — render real captured rows with Arabic sūrah names (`SURAHS`); calm empty-state ("لم تُسجَّل مراجعات بعد"). Mostly read-side; verify it reflects T014 writes.
- [ ] **T017** [P] [US2] `src/app/teacher/sessions/[id]/page.tsx` — confirm the existing range display renders the newly-captured row.

## Phase 5: User Story 3 — Integrity guarantee (P3)
- [ ] **T018** [US3] Local-PG test: raw SQL insert of An-Nās 1→50 → trigger raises; recitation_error with null surah (non-sentinel) → CHECK raises. (Largely covered by T010; this is the explicit US3 assertion.)
- [ ] **T019** [P] [US3] Audit query in `docs/` or a test asserting SC-004 (`0` impossible rows) — a reusable invariant check.

## Phase 6: Polish & cross-cutting
- [ ] **T020** [P] CONTEXT.md — add a "Progress capture" note (the new domain fn + `quran_surahs` + `progress.recorded` event).
- [ ] **T021** [P] Confirm `tsc` + `eslint` clean; `vitest` green; local-PG suite green; `supabase db push` green on the PR.
- [ ] **T022** Draft PR same day; body cites spec/plan; verification table (the #346/#365/#366 evidence format). Do **not** auto-merge (operator review).

---

## Dependencies / parallelism
- **Foundational (T002–T008) blocks everything.** Within it: T003/T004 parallel; T005 needs T002; T007 needs T005/T006.
- **US1 (T009–T015)** is the MVP; T011/T013 parallel; T012 needs T004+T007; T014 needs T012+T008; T015 needs T014.
- **US2/US3** depend only on US1's write path existing → can proceed once T014 lands.
- Independent test story: each phase has its own checkpoint (Principle V tracer-bullet).

## Scale / constitution reminders baked into tasks
- T002 seed accuracy = lens-2 NON-NEGOTIABLE (wrong count = Islamic defect).
- T012/T014 = Principles I/II/IV; T007 = Principle III (atomic).
- No per-render writes, no fan-out (50k rule) — capture is one write/session.
