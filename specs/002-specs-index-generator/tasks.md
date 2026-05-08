---

description: "Task list for 002-specs-index-generator"
---

# Tasks: Specs Index Generator

**Input**: Design documents from `/specs/002-specs-index-generator/`
**Prerequisites**: spec.md (clarified, 5 Q→A bullets), plan.md (constitution v1.2.0 PASS), research.md, data-model.md, quickstart.md, contracts/generate-specs-index.md

**Tests**: Test tasks ARE included — vitest exists in the FURQAN stack and the contract calls out idempotency + status-precedence as test-required behaviours (FR-008). TDD-friendly ordering: tests written before implementation per Constitution Principle II's loud-failures discipline.

**Organization**: Tasks grouped by user story (P1 → P3) so each story can be implemented + tested + delivered as an MVP slice.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies on incomplete tasks)
- **[Story]**: Which user story this task belongs to (US1, US2, US3); Setup/Foundational/Polish phases have no story label
- Each task description includes the exact file path

## Path Conventions

- Script + tests: `scripts/`, `scripts/__tests__/` (matches existing FURQAN convention)
- Hook config: `.husky/`, `package.json`
- Output: `specs/INDEX.md`
- Cron wrapper: registered in n8n on Mac mini; reference shell snippet lives in `automation/n8n-workflows/specs-index-cron.sh` (committed for n8n to pull)

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Install the pre-commit hook framework and the npm scripts the rest of the tasks depend on.

- [ ] T001 Add `husky@^9` and `lint-staged@^15` to `devDependencies` in `package.json`
- [ ] T002 Add `"prepare": "husky"` to the `scripts` block in `package.json`
- [ ] T003 Add `"specs:index": "tsx scripts/generate-specs-index.ts"` to the `scripts` block in `package.json`
- [ ] T004 Add the lint-staged config block to `package.json`: `{ "specs/**/*.md": ["bash -c 'npm run specs:index && git add specs/INDEX.md'"] }`
- [ ] T005 Run `npm install` and `npx husky init` to create `.husky/pre-commit` (replace its default content with `npx lint-staged`)
- [ ] T006 Verify the husky setup: `ls .husky/pre-commit` returns the hook file; `git config core.hooksPath` returns `.husky`

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Set up the test scaffold + utility imports the script will need. MUST complete before any user-story implementation begins.

- [ ] T007 [P] Create `scripts/__tests__/` directory and add an empty placeholder test file `scripts/__tests__/generate-specs-index.test.ts` containing `import { describe, it, expect } from 'vitest'; describe('generate-specs-index', () => { it.todo('placeholder'); });`
- [ ] T008 [P] Add a `vitest.config.ts` entry (or extend existing) to include `scripts/**/*.test.ts` in the test glob if not already covered
- [ ] T009 [P] Verify `gh` CLI is authenticated against the FURQAN repo: `gh auth status` returns "Logged in" (no code change; documentation in `quickstart.md` covers this)

---

## Phase 3: User Story 1 — Operator finds the right spec in seconds (P1) — MVP

**Purpose**: Ship the core generator. After this phase the script can be run manually (`npm run specs:index`) and produces a working INDEX.md.

**Independent Test**: Run `npm run specs:index` against the current FURQAN repo. Open `specs/INDEX.md`. Verify rows for `001-murajaah-scheduler` (Planned) and `002-specs-index-generator` (Tasks-ready). Verify acceptance scenarios 1, 2, 3 from spec.md User Story 1.

### Implementation tasks for US1

- [ ] T010 [US1] Create `scripts/generate-specs-index.ts` skeleton: shebang, imports (`node:fs/promises`, `node:path`, `node:child_process`), top-level `async function main()`, exit-code 0 wrapper. Implementation per `contracts/generate-specs-index.md`.
- [ ] T011 [US1] Implement the spec-folder scanner in `scripts/generate-specs-index.ts`: read `specs/` directory, filter to entries matching `/^\d{3}-[a-z][a-z0-9-]*$/`, return array of `dirName` per data-model.md `SpecFolderScan`.
- [ ] T012 [US1] Implement artefact existence checks per `SpecFolderScan.artefacts` shape in `scripts/generate-specs-index.ts`: `fs.access` for spec.md / plan.md / research.md / data-model.md / quickstart.md / tasks.md; `fs.access` + `fs.readdir` non-empty for `contracts/`.
- [ ] T013 [US1] Implement `hasClarifications` check in `scripts/generate-specs-index.ts`: read spec.md, regex-match `## Clarifications` heading followed by at least one `^- Q:` bullet within the same section.
- [ ] T014 [US1] Implement branch-name extraction in `scripts/generate-specs-index.ts`: read spec.md top-of-file, regex `\*\*Feature Branch\*\*:\s*\`([^\`]+)\``; return `null` if not found and emit `[warn]` to stderr.
- [ ] T015 [US1] Implement gh PR-state lookup in `scripts/generate-specs-index.ts`: shell out to `gh pr list --head <branch> --state all --json state,url,number,closedAt --limit 1`. Cache results in a `Map<string, PRState>`. Map gh's `state` field to `'open' | 'merged' | 'closed-unmerged' | 'none'` (gh returns `OPEN | CLOSED | MERGED`; map `CLOSED` → `closed-unmerged`).
- [ ] T016 [US1] Implement lifecycle status inference in `scripts/generate-specs-index.ts`: `function inferStatus(scan: SpecFolderScan): Status` per FR-003 precedence (Shipped → Implementing → Abandoned → Tasks-ready → Planned → Clarified → Draft; Malformed if no spec.md).
- [ ] T017 [US1] Implement INDEX.md formatter in `scripts/generate-specs-index.ts`: `function renderIndex(scans: SpecFolderScan[]): string`. Output matches `data-model.md` § "Output shape" — Active section sorted by NNN ascending; Abandoned section (filtered to ≤90 days, sorted by closedAt descending) shows `_None._` if empty.
- [ ] T018 [US1] Implement atomic write in `scripts/generate-specs-index.ts`: write to `specs/INDEX.md.tmp`, then `fs.rename(specs/INDEX.md.tmp, specs/INDEX.md)`. Compare against existing INDEX.md content; if identical, skip the write entirely (cleaner than rename-then-no-diff).
- [ ] T019 [US1] Wire `main()` together: scan → infer status → render → atomic write. Print summary to stdout: `Wrote specs/INDEX.md (N active, M abandoned)` or `specs/INDEX.md unchanged`.
- [ ] T020 [P] [US1] Write `scripts/__tests__/generate-specs-index.test.ts` test 1 — empty `specs/` directory produces "No specs yet" output.
- [ ] T021 [P] [US1] Write `scripts/__tests__/generate-specs-index.test.ts` test 2 — folder with only spec.md → status Draft.
- [ ] T022 [P] [US1] Write `scripts/__tests__/generate-specs-index.test.ts` test 3 — spec.md with `## Clarifications` Q→A bullet → status Clarified.
- [ ] T023 [P] [US1] Write `scripts/__tests__/generate-specs-index.test.ts` test 4 — folder with plan.md → status Planned (mock gh PR lookup to return `none`).
- [ ] T024 [P] [US1] Write `scripts/__tests__/generate-specs-index.test.ts` test 5 — folder with tasks.md, no PR → status Tasks-ready.
- [ ] T025 [P] [US1] Write `scripts/__tests__/generate-specs-index.test.ts` test 6 — gh PR open → status Implementing.
- [ ] T026 [P] [US1] Write `scripts/__tests__/generate-specs-index.test.ts` test 7 — gh PR merged → status Shipped.
- [ ] T027 [P] [US1] Write `scripts/__tests__/generate-specs-index.test.ts` test 8 — folder without spec.md → status Malformed + stderr warning.
- [ ] T028 [P] [US1] Write `scripts/__tests__/generate-specs-index.test.ts` test 9 — idempotency: 2× run with same fixture state produces same output bytes.
- [ ] T028a [P] [US1] Write `scripts/__tests__/generate-specs-index.test.ts` test 10 — SC-003 direct verification: scanner returns all matching folders given a fixture with 5 NNN-prefixed folders + 2 non-conforming folders; INDEX.md output rows MUST equal the 5 conforming folders, no silent omission.
- [ ] T029 [US1] Run the script against the live repo: `npm run specs:index`. Verify `specs/INDEX.md` lists `001-murajaah-scheduler` and `002-specs-index-generator` with the correct statuses.

**Checkpoint after Phase 3**: MVP shipped. Operator can manually run `npm run specs:index` and read `INDEX.md`. SC-001 (10-second find) is achievable.

---

## Phase 4: User Story 2 — INDEX.md stays current without manual updates (P2)

**Purpose**: Wire the husky pre-commit hook so INDEX.md regenerates automatically on commits that touch `specs/**/*.md`.

**Independent Test**: From a clean working tree, edit any `specs/<feature>/spec.md`. Run `git commit -m "test"`. Verify `specs/INDEX.md` was added to the same commit by the pre-commit hook.

### Implementation tasks for US2

- [ ] T030 [US2] Verify lint-staged config in `package.json` activates `npm run specs:index && git add specs/INDEX.md` only when `specs/**/*.md` is in the staged set (already added in T004; this task confirms the wiring).
- [ ] T031 [US2] Implement the "INDEX.md edited alone" short-circuit in `scripts/generate-specs-index.ts` per `contracts/generate-specs-index.md` § "Edge case — INDEX.md edited alone": if the only staged file matching the lint-staged glob is INDEX.md itself, exit 0 without re-rendering. Detect via `git diff --cached --name-only` filtered to `specs/`.
- [ ] T032 [P] [US2] Write `scripts/__tests__/generate-specs-index.test.ts` test 10 — pre-commit hook trigger: stage a spec change, run lint-staged, verify INDEX.md was re-staged.
- [ ] T033 [US2] Manual smoke test from quickstart.md § 2: edit `specs/001-murajaah-scheduler/spec.md` (one comment line), `git add` it, `git commit -m "smoke test"`. Verify hook ran, INDEX.md was added if changed, commit succeeded.

**Checkpoint after Phase 4**: INDEX.md auto-updates on every relevant commit. SC-002 (1-minute drift on commit-path) is achievable.

---

## Phase 5: User Story 3 — Daily cron catches drift (P3)

**Purpose**: Wire the n8n cron on the Mac mini so contributor-bypassed-hook commits get caught.

**Independent Test**: `git commit -m "deliberate bypass" --no-verify` after editing a spec. Run the cron wrapper command from quickstart.md § 3. Verify `[index-bot]` commit appears.

### Implementation tasks for US3

- [ ] T034 [US3] Create `automation/n8n-workflows/specs-index-cron.sh` containing the cron wrapper from `contracts/generate-specs-index.md` § "n8n cron wrapper contract". File checked into the repo so n8n can pull it from the Mac mini's clone.
- [ ] T035 [US3] Add a row to `automation/BLUEPRINT.md` under "Platform Health" (or new "Spec-kit ops" section) registering the cron: name `specs-index-nightly`, trigger `0 3 * * *` UTC, action SSH-and-run `automation/n8n-workflows/specs-index-cron.sh`, on-failure Telegram alert per existing self-healing pattern.
- [ ] T036 [US3] In n8n.drdeeb.tech (out-of-repo configuration; document the n8n workflow JSON shape in `automation/n8n-workflows/specs-index-cron.workflow.json` as a reference): create a Cron workflow that SSHes to the Mac mini and runs `/path/to/furqan/automation/n8n-workflows/specs-index-cron.sh`. Activate.
- [ ] T037 [US3] Manual smoke test from quickstart.md § 3: `git commit -m "deliberate bypass" --no-verify` after editing a spec on a test branch. Run the cron wrapper script directly. Verify the `[index-bot]` commit was made and the working tree is clean afterward.

**Checkpoint after Phase 5**: drift correction works end-to-end. SC-002 (24h drift on cron-only path) is achievable.

---

## Phase 6: Polish & Cross-Cutting Concerns

**Purpose**: Finalising touches that don't fit a specific user story but matter for shipping.

- [ ] T038 Update `CLAUDE.md` "Spec-Kit Workflow" section to reference `specs/INDEX.md` as the canonical entry point for spec discovery (one new bullet under "Workflow" pointing at the index).
- [ ] T039 [P] Confirm `.gitignore` does NOT ignore `specs/INDEX.md` (it's tracked, intentionally). If a .gitignore line ignores `specs/*.md`, exclude INDEX.md explicitly with `!specs/INDEX.md`.
- [ ] T040 [P] Run `npx vitest run scripts/__tests__/generate-specs-index.test.ts` and confirm all tests pass.
- [ ] T041 [P] Run `npx next build` and confirm zero new build errors (the script is in `scripts/`, not `src/`, so it shouldn't affect the Next build — but verify).
- [ ] T042 Final smoke test from quickstart.md § 4 (idempotency check): run the script twice; verify the second run produces zero diff against the first.
- [ ] T043 Update PR description to enumerate the smoke-test results from T029 / T033 / T037 / T042 so reviewers can verify without re-running.

---

## Dependencies — story completion order

```
Setup (T001-T006)
    │
    ▼
Foundational (T007-T009)
    │
    ▼
US1 (T010-T029)  [P1, MVP]
    │
    ├──► US2 (T030-T033)  [P2]
    │
    └──► US3 (T034-T037)  [P3]
            │
            ▼
        Polish (T038-T043)
```

US2 and US3 depend on US1 (the script must exist for them to invoke it). US2 and US3 are independent of each other.

## Parallel execution examples

**Within US1 (after T010-T019 implementation tasks):** all the test tasks T020-T028 are mutually independent (`[P]` markers). Run as a parallel batch:

```bash
npx vitest run scripts/__tests__/generate-specs-index.test.ts
```

**Across stories**: US2's T032 (hook test) and US3's T037 (cron smoke) are independent and can be tackled in parallel by two contributors / agents once US1's T029 is green.

## Implementation strategy — MVP first, incremental delivery

1. **MVP (Phase 3 only)**: ship US1 alone. Operators can manually run `npm run specs:index` and read INDEX.md. SC-001 passes. SC-002/SC-003/SC-004 don't apply yet.
2. **Increment 1 (add US2)**: ship hooks. SC-002's commit-path 1-minute drift becomes achievable.
3. **Increment 2 (add US3)**: ship cron. SC-002's 24h cron-only drift achievable; SC-004's "zero stale rows after merge ≤24h" achievable.

Each increment is independently mergeable; if the team needs to pause mid-feature, MVP-only is a complete shippable state.

## Implementation note — this PR's scope

This PR (PR B) ships **only spec-kit artefacts** (spec/plan/tasks/research/data-model/quickstart/contracts). The actual implementation (T001-T043) lands in a follow-up PR via `/speckit.implement` or hand-coded against this tasks.md.
