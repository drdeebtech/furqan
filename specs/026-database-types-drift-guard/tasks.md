# Tasks: Database Types Drift Guard

**Input**: `specs/026-database-types-drift-guard/` (spec.md, plan.md, research.md, data-model.md, quickstart.md)
**Branch**: `026-database-types-drift-guard`
**Status**: Tasks-ready

**Tests**: This feature requires typecheck and unit-test verification because the risk is type drift across 96 importers.

---

## Phase 1: Setup (Branch Hygiene)

**Purpose**: Satisfy speckit branch hygiene before implementation.

- [ ] T001 Create or link the tracking GitHub issue for spec 026 and record it in `specs/026-database-types-drift-guard/plan.md`
- [ ] T002 Open a draft PR for branch `026-database-types-drift-guard` and record it in `specs/026-database-types-drift-guard/plan.md`
- [ ] T003 [P] Confirm pre-work checks in `specs/026-database-types-drift-guard/plan.md`: `gh issue view`, `gh pr list`, `git log --grep`, and `git log --diff-filter=D`

---

## Phase 2: Foundational (Correction Inventory)

**Purpose**: Make intentional generated-type deviations explicit before adding any guard.

- [ ] T004 Add a correction inventory comment to `src/types/database.ts` covering nullable RPC args, `Course` overrides, ijazah/mentorship unions, and TEXT-CHECK enum unions
- [ ] T005 [P] Add `scripts/regen-database-types.md` documenting the regenerate-and-repatch workflow from `specs/026-database-types-drift-guard/quickstart.md`
- [ ] T006 [P] Cross-link `specs/026-database-types-drift-guard/spec.md` and `scripts/regen-database-types.md` so future schema authors can find the workflow

**Checkpoint**: A developer can understand why `database.ts` intentionally differs from `supabase.generated.ts` before running any command.

---

## Phase 3: User Story 1 - Safe Regeneration Workflow (Priority: P1)

**Goal**: A maintainer can regenerate raw types and preserve known corrections without collapsing the corrected layer.

**Independent Test**: Follow `scripts/regen-database-types.md`; no step instructs direct re-export collapse, blind regeneration of `database.ts`, or use of `any`.

- [ ] T007 [US1] Document the exact `npm run db:types` starting point in `scripts/regen-database-types.md`
- [ ] T008 [US1] Document the manual repatch checklist in `scripts/regen-database-types.md` using the correction inventory from `src/types/database.ts`
- [ ] T009 [US1] Document the failure triage rule in `scripts/regen-database-types.md`: inspect lost corrections before changing application code

**Checkpoint**: US1 is complete when the runbook can guide a safe manual regen and correction review.

---

## Phase 4: User Story 2 - Migration Drift Reminder (Priority: P2)

**Goal**: Schema authors get a reminder to review `database.ts` when migrations change generated types.

**Independent Test**: A migration-only diff has a documented review path that points at `database.ts` and the regen runbook.

- [ ] T010 [US2] Record MVP decision in `specs/026-database-types-drift-guard/plan.md`: documentation-only reminder ships now; automated guard is optional follow-up
- [ ] T011 [US2] Add the docs-only reminder to the relevant migration/type workflow docs without changing runtime code
- [ ] T012 [P] [US2] Optional follow-up only: if automation is approved later, add a narrowly scoped warning guard that avoids a hard raw-codegen diff

**Checkpoint**: US2 is complete when schema changes cannot silently skip the corrected type review path.

---

## Phase 5: Verification & Close-Out

**Purpose**: Prove the corrected layer remains valid and speckit artifacts stay consistent.

- [ ] T013 Follow `scripts/regen-database-types.md` as a dry-run review and record any correction inventory gaps
- [ ] T014 Run `npx tsc --noEmit`
- [ ] T015 Run `npm run test:unit`
- [ ] T016 Run `npm run specs:index`
- [ ] T017 Run `/speckit-analyze` prerequisites: `.specify/scripts/bash/check-prerequisites.sh --json --require-tasks --include-tasks`
- [ ] T018 Record final verification results in `specs/026-database-types-drift-guard/tasks.md`

---

## Dependencies & Execution Order

- Phase 1 blocks implementation because branch hygiene is non-negotiable.
- Phase 2 blocks US1 and US2 because the correction inventory is the source for the runbook and reminder.
- US1 can ship independently after Phase 2.
- US2 depends on the US1 runbook path.
- Phase 5 depends on chosen scope from US1/US2.

## Parallel Opportunities

- T003, T005, and T006 can run in parallel after T001/T002.
- T011 and T012 are mutually exclusive depending on T010; do not run both.

## MVP Scope

MVP is Phase 1 + Phase 2 + Phase 3 + Phase 5. It delivers the safe documented workflow without introducing a CI guard.
