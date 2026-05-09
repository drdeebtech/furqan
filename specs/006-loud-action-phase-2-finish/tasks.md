# Tasks: Phase 2 No-Silent-Failures Finish

**Feature**: `specs/006-loud-action-phase-2-finish/`
**Branch**: `006-loud-action-phase-2-finish`
**Generated**: 2026-05-09 by `/speckit-tasks`

> Tasks organized by user story per the spec. The branch already exists; foundational work (tripwire) is sequenced before story phases per plan.md §"Sequencing Notes". Story dependencies: US1 + US2 deliver jointly via the wraps; US3 (form feedback) depends on wraps establishing the LoudResult shape; US5 (audit-doc accuracy) is the last sweep that closes the loop.

---

## Phase 1 — Setup

- [X] T001 Verify branch state on `006-loud-action-phase-2-finish` and main is up-to-date: `git fetch origin && git log --oneline main..HEAD` should show only the spec commit ✅ 3 commits ahead (spec, design artefacts, prior wrap work c402372 not yet on local main)
- [X] T002 Verify `loud.ts` post-PR-20 baseline (cause-aware + `notFoundOrInfra` exported): `grep -n "export function notFoundOrInfra\|userError === true" src/lib/actions/loud.ts` returns both ✅ found at L99 + L234
- [X] T003 Verify the existing silent-fail tripwire script location: `find . -name "pre-commit" -path "*husky*" 2>/dev/null` and inspect `.husky/pre-commit` to find the grep helper ✅ `.husky/pre-commit` exists (inspect deferred to T004)
- [X] T003a Push branch and open **draft PR** with title `chore: Phase 2 No-Silent-Failures finish (per spec 006)` and body containing `Closes #269`. Subsequent commits land on this draft PR. Rationale: Constitution § "Branch hygiene" CRITICAL flag #2 — draft PR opens as the 1st-or-2nd Phase-1 task. ✅ PR #270 opened: https://github.com/drdeebtech/furqan/pull/270 (closes #269)

---

## Phase 2 — Foundational (BLOCKING — must complete before story phases)

**Purpose**: Extend the silent-fail tripwire to catch the `.single()` error-drop pattern. Doing this BEFORE the wrap phase means every subsequent commit gets validated against the new rule (catches drift before merge).

- [X] T004 [US4] Read existing tripwire — found at `scripts/check-silent-fail.sh` (invoked from `.github/workflows/silent-fail-check.yml`, not from `.husky/pre-commit`; pre-commit only runs lint-staged for INDEX regen). Spec wording adjusted in tasks.md notes.
- [X] T005 [US4] Added new grep `\{\s*data:\s*\w+\s*\}\s*=\s*await\s+.+\.(single|maybeSingle)\(\)` against `src/**/*.ts` + `src/**/*.tsx` with parallel baseline file `scripts/.single-error-drop-baseline.txt` (matches existing baseline-count convention)
- [X] T006 [US4] Block message per `contracts/tripwire-contract.md` — names file:line, the dropped-error pattern, the `notFoundOrInfra` fix, and links the spec dir
- [X] T007 [US4] Self-test passed: synthetic offender in `src/__tripwire_self_test__.ts` → count went 1→2 → exit 1 with correct error message → file removed → count back to 1 → exit 0
- [X] T008 [US4] Zero false positives in any `*actions.ts` files (wrapped server actions). Sole offender (count=1) is `src/app/admin/users/[id]/page.tsx:44` — `_authUser` underscore-prefix existence check in a page component, not a server action; grandfathered into baseline
- [X] T009 [US4] Commit foundational changes: `chore: extend silent-fail tripwire to catch .single() error-drop (per spec 006 FR-007)`

**Checkpoint**: Tripwire enforces during all subsequent wrap commits.

---

## Phase 3 — User Story 1 + 2 (Sentry observability + audit trail, P1)

**Goal**: Wrap every P0/P1 mutating action in `loudAction` (or defer with rationale + manual audit row). This phase delivers BOTH user stories simultaneously: every wrapped action emits Sentry events on infra failure (US1) and writes an audit_log envelope row (US2).

**Independent Test**: After this phase merges, force a Supabase RLS denial on any wrapped action in a preview env. Confirm: (a) user sees friendly Arabic error, (b) Sentry receives the event with `cause` attached within 30 s, (c) `audit_log` has a FAILED row.

### Routine wraps (severity = `info`)

- [ ] T010 [P] [US1] Wrap `lib/actions/session-lesson-plan.ts` actions (setLessonPlan, toggleCheckpoint, clearLessonPlan — 3× P2, all `info`) per `contracts/wrap-contract.md`
- [ ] T011 [P] [US1] Wrap `app/teacher/recitations/actions.ts` action (requestFreshRecitationAction — P1, `info`) per wrap contract
- [ ] T012 [P] [US1] Wrap `app/student/sessions/actions.ts` action (attestSessionHappened — P1, `info`) per wrap contract
- [ ] T013 [P] [US1] Wrap `app/teacher/students/[studentId]/actions.ts` actions (updateSessionNotes — P1 dual-write `session_notes_history.insert` + `sessions.update`; resolveRecitationError — P2 `recitation_errors.update`) per wrap contract
- [ ] T014 [P] [US1] Wrap `app/teacher/sessions/[id]/actions.ts` actions (savePostSessionNotes — preserves diff audit_log row; markNoErrorsObserved — P1, `info` both) per wrap contract
- [ ] T015 [P] [US1] Wrap `lib/actions/course-enrollments.ts` action enrollFree (P1, `info`); preserve initiateEnrollmentCheckout as deferred (Stripe-deferred per audit) — add only the comment update naming the deferral

### Complex wraps (severity = `info`, multi-side-effect)

- [ ] T016 [US1] Wrap `lib/actions/group-session.ts` action addStudentToSession (P1 complex — 4 `.single()` sites, package-credit deduction RPC, Daily.co room resize, existing audit_log row preserved) per wrap contract; reference PR 18's gradeHomework auto-regen branch as the precedent for multi-side-effect handlers

### Defers (loud-by-hand per `contracts/deferral-contract.md`)

- [ ] T017 [US1] Defer `app/student/sessions/[id]/actions.ts` action generateSessionToken (multi-field `{ token, roomUrl }` return) — add explicit `logError` per error path + manual `audit_log` row + JSDoc citing joinAsObserver (PR 16) precedent
- [ ] T018 [P] [US1] Wrap remaining `app/student/sessions/[id]/actions.ts` actions (submitReview — `course_reviews.insert` P2; trackSessionEvent — `automation_logs.insert` P2 best-effort) per wrap contract

### P0 money path (severity = `critical`)

- [ ] T019 [US1] Wrap `app/(public)/packages/paypal-actions.ts` action createPackageOrder (P0 money, `severity: critical`) — preserve PayPal API call order verbatim per wrap contract
- [ ] T020 [US1] Wrap `app/(public)/packages/paypal-actions.ts` action captureAndGrantPackage (P0 money double-write, `severity: critical`) — preserve fail-soft semantics per Decision 5 in research.md (PayPal capture → student_packages.insert → deduct_package_session RPC); cause-attached UserError on each failure path

### Verification

- [ ] T021 [US1] Run `npx tsc --noEmit --pretty false` — must pass on the entire wrapped surface
- [ ] T022 [US1] Run `git grep "{ data: \w*\s*}\s*=" src/app src/lib/actions` — confirm no Supabase-query sites in wrapped handlers (excluding `auth.getUser()` shape)
- [ ] T023 [US1] Run `grep -rn "throw new UserError(.*[eE]rr" src/app src/lib/actions` — confirm every Supabase-error-following throw includes `{ cause: ... }`

**Checkpoint after Phase 3**: All P0/P1 mutating actions in the 9 target files are wrapped or explicitly deferred. SC-001 + SC-002 + SC-003 satisfied. US1 + US2 independently testable per their acceptance scenarios.

---

## Phase 4 — User Story 3 (Form feedback gap, P2)

**Goal**: Add `<ActionFeedback>` to the 3 highest-impact forms missing it (per research.md Decision 2). The full sweep of 28 callers is deferred to a follow-up PR series.

**Independent Test**: Submit one of the 3 forms with a forced failure path; confirm the user sees the Arabic error message inline within 200 ms of the response.

- [ ] T024 [P] [US3] Add `<ActionFeedback state={state} />` to `src/app/teacher/sessions/[id]/post-session-form.tsx` (backs `savePostSessionNotes` — P1 lifecycle, was silent on failure)
- [ ] T025 [P] [US3] Add `<ActionFeedback>` to `src/app/(public)/packages/paypal-checkout.tsx` (PayPal callback handler — P0 money, was silent on capture failure)
- [ ] T026 [P] [US3] Add `<ActionFeedback>` to `src/app/teacher/students/[studentId]/notes-form.tsx` (backs `updateSessionNotes` — P1 lifecycle, was silent)

**Checkpoint after Phase 4**: SC-007 demonstrable on at least 1 form. US3 acceptance scenarios satisfied.

---

## Phase 5 — User Story 5 (Audit doc accuracy, P3)

**Goal**: Bring `docs/audit/no-silent-failures-2026-Q2.md` and `specs/INDEX.md` in sync with reality.

**Independent Test**: Run a script that scans every `.ts` file under `src/app/admin/` and `src/lib/actions/` for `loudAction` adoption, then diffs against the audit doc's "Wrapped ✅" markers. Confirm zero discrepancies.

- [ ] T027 [US5] Update `docs/audit/no-silent-failures-2026-Q2.md`: mark every action wrapped in T010–T020 with `Wrapped ✅ (PR <N>)` + severity. Mark deferred actions (generateSessionToken, initiateEnrollmentCheckout) as `Deferred (PR <N>)` with rationale
- [ ] T028 [US5] Correct any pre-existing audit-doc inaccuracies discovered during the wrap sweep (drifted column names, surface descriptions, phantom n8n emit)
- [ ] T029 [US5] Regenerate `specs/INDEX.md` via `npm run specs:index` — should mark spec 005 as `Shipped` (not `Tasks-ready`) and add spec 006 row
- [ ] T030 [US5] Verify zero discrepancies: `grep -c "loudAction<" src/app src/lib/actions` count vs audit doc's "Wrapped ✅" count (within ±2 for legitimately deferred items per SC-005)

**Checkpoint after Phase 5**: SC-005 + SC-006 satisfied. US5 acceptance scenarios satisfied.

---

## Phase 6 — Polish & Cross-Cutting Concerns

- [ ] T031 Final typecheck: `npx tsc --noEmit --pretty false` — must pass
- [ ] T032 Run vitest suite: `npm run test` (or equivalent) — must pass
- [ ] T033 Run silent-fail tripwire on the full diff: confirm tripwire passes (no new anti-patterns) AND blocks the synthetic test commit (one-time validation per US4 acceptance scenario 1)
- [ ] T034 Anti-drift checklist (paste in PR body) — confirm all 7 items per `contracts/wrap-contract.md` § "Anti-drift checklist": severity calibrated, `.single()` captures both, `UserError({ cause })` for infra, `audit_log.changed_by` (not `actor_id`), public signatures unchanged, cleanup-on-fail noted, `notFoundOrInfra` imported from loud.ts
- [ ] T035 (deleted — branch push performed in T003a; line retained as a no-op marker so downstream task IDs remain stable)
- [ ] T036 Mark the draft PR (opened in T003a) as ready-for-review; ensure body contains: spec dir reference, anti-drift checklist, constitution-gate PASS verdict from plan.md, the `Closes #<N>` tracking issue link, and the squash-merge intent.
- [ ] T037 Address any reviewer-agent flags in-PR before merge (matches PR 16/17/18 shape — fix-before-merge, no follow-up PRs per Phase 2 finish plan)
- [ ] T038 Merge PR via squash; confirm `main` shows the squashed commit
- [ ] T039 Add (or extend) a unit test under `src/lib/actions/__tests__/` that stubs the Supabase client and the PayPal client to throw, then asserts: (a) `Sentry.captureException` was called with `cause` attached; (b) for the PayPal `severity: critical` path, the Telegram alert helper was called. Defer live preview-env smoke-testing until Supabase Branching is enabled (tracked in CLAUDE.md "Remaining Work — Infrastructure improvements").
- [ ] T040 Update memory: append a session note to the operator's run log capturing what landed (PR number, action count, audit-doc state)

---

## Dependencies & Story Completion Order

```
Phase 1 (Setup) → Phase 2 (Foundational: Tripwire) → Phase 3 (US1+US2: Wraps) → Phase 4 (US3: Form feedback) → Phase 5 (US5: Audit doc) → Phase 6 (Polish)
```

**Parallel groups**:
- **Group A (Phase 3 routine)**: T010, T011, T012, T013, T014, T015 — different files, no inter-dependencies. Run in parallel.
- **Group B (Phase 3 P0)**: T019, T020 must run sequentially (same file `paypal-actions.ts`).
- **Group C (Phase 4 forms)**: T024, T025, T026 — different files, run in parallel.

**Sequential bottlenecks**:
- T016 (group-session.ts) is its own bottleneck — complex single-file wrap with multiple side effects.
- T017–T018 share file `student/sessions/[id]/actions.ts` so must be sequential.
- T019–T020 share file `paypal-actions.ts` so must be sequential.

---

## Implementation Strategy

**MVP scope**: User Story 1 + User Story 2 only (Phase 1 + 2 + 3). Wrapping the 9 files plus the tripwire delivers the primary value of Phase 2 — operator observability + audit trail. Form feedback (US3) and audit-doc accuracy (US5) are valuable polish but not MVP-blocking. SC-001 through SC-005 are achievable from Phase 3 alone.

**Incremental delivery**:
- After Phase 2 (tripwire) lands, the codebase is protected against new drift even if Phase 3 takes multiple sessions.
- After each Phase 3 task lands, `audit_log` coverage and Sentry observability extend incrementally — no big-bang dependency.
- Phase 4 (forms) and Phase 5 (audit doc) can land after Phase 3, even in a follow-up PR if the mega-PR runs out of session budget.

**Rollback strategy**:
- `git revert <merge-commit>` if a wrap regresses production behavior. Each wrap is structurally additive (new `*Base` const + thin public wrapper); reverting restores the original action.
- The tripwire is a CI hook only — disabling it is a one-line revert in `.husky/pre-commit`.

---

## Format validation

All 41 tasks above follow the required checklist format:
- ✅ Every task starts with `- [ ]` checkbox
- ✅ Every task has a sequential ID (T001–T040 plus T003a inserted after Phase 1 verification per Constitution Branch Hygiene flag #2; T035 retained as a no-op marker so downstream IDs stay stable)
- ✅ User-story phase tasks (T010–T030) have a `[US1]`, `[US3]`, or `[US5]` story label
- ✅ Foundational tripwire tasks (T004–T009) carry `[US4]` (US4 is the silent-fail-tripwire user story — coverage trace closed)
- ✅ Setup tasks (T001–T003, T003a) and Polish tasks (T031–T040) have NO story label
- ✅ Parallelizable tasks marked with `[P]`
- ✅ Each task has a clear file path or grep target

---

## Counts

- **Total tasks**: 41 active (T035 retained as a no-op marker after H2 fix; effectively 40 actionable tasks)
- **Phase 1 (Setup)**: 4 tasks (T001–T003 + T003a draft-PR)
- **Phase 2 (Foundational/Tripwire — `[US4]`)**: 6 tasks (T004–T009)
- **Phase 3 (US1 + US2 wraps)**: 14 tasks (T010–T023)
- **Phase 4 (US3 forms)**: 3 tasks (T024–T026, all parallel)
- **Phase 5 (US5 audit doc)**: 4 tasks (T027–T030)
- **Phase 6 (Polish)**: 10 tasks (T031–T040; T035 is a no-op marker)

**Parallel opportunities**: 9 tasks marked `[P]` (across Groups A and C)
**MVP scope**: Phases 1–3 (23 tasks total). Forms + audit doc + polish can land later.

---

**Status**: tasks.md complete. Ready for `/speckit-analyze` (cross-artefact consistency check) or `/speckit-implement` (execute tasks).
