# Implementation Plan: Specs Index Generator

**Branch**: `002-specs-index-generator` | **Date**: 2026-05-08 | **Spec**: [spec.md](./spec.md)
**Input**: Feature specification from `/specs/002-specs-index-generator/spec.md` (clarified — 5 Q→A bullets, zero `[NEEDS CLARIFICATION]` markers)
**Constitution**: `.specify/memory/constitution.md` v1.2.0

## Summary

A small TypeScript script (`scripts/generate-specs-index.ts`) that scans `specs/<NNN-slug>/` directories, infers each feature's lifecycle status from artefact presence + GitHub PR state, and emits `specs/INDEX.md` with two sections: **Active specs** (Draft/Clarified/Planned/Tasks-ready/Implementing/Shipped) and **Abandoned (last 90 days)**. Triggered automatically by a husky pre-commit hook on `specs/**/*.md` changes and by an n8n nightly cron (Mac mini, 03:00 UTC) for drift correction. Cron commits authored by `drdeebtech@gmail.com` with `[index-bot]` subject prefix for filterability.

This is the spec-kit tracer-bullet feature: PR B in the gap-closure plan validates the canonical `/speckit.specify → .clarify → .plan → .tasks → .analyze` loop. The generator implementation itself is deferred to a follow-up PR (or `/speckit.implement` against this branch).

## Technical Context

**Language/Version**: TypeScript 5 + Node 24.x (matches FURQAN's `.nvmrc` and Vercel project)
**Primary Dependencies**: `tsx` (run TS without compile), `husky` (pre-commit hook framework), `lint-staged` (run script only on matching staged files), `gh` CLI (PR-state lookup); no new runtime deps
**Storage**: filesystem only — reads `specs/*/`, writes `specs/INDEX.md`. No database touched.
**Testing**: vitest (existing setup); contract tests at `scripts/__tests__/generate-specs-index.test.ts`
**Target Platform**: Node 24.x — runs locally on dev machines (pre-commit) and on the n8n Mac mini (nightly cron). No browser surface.
**Project Type**: Internal tooling script. Single TypeScript file + tests.
**Performance Goals**: Full regen in <5 seconds at 30 specs (the practical upper bound at 50k user scale). PR-state lookup cached per-run.
**Constraints**: NON-NEGOTIABLE 50k-user Scale Target Rule (constitution v1.2.0); NON-NEGOTIABLE Branch Hygiene Rule. Generator must avoid per-row API calls (FR-006 cap) and must run successfully under the existing CRON_SECRET dual-auth pattern on the cron path.
**Scale/Scope**: ≤30 in-flight specs concurrent; INDEX.md ≤200 rows lifetime (Active + 90-day Abandoned window). Pre-commit invocations: every developer commit touching `specs/**/*.md` ≈ 5–20/day. Cron invocations: 1/day.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-checked after Phase 1 design.*

### Principle I — Domain Ownership ✅

Not applicable. This is internal tooling, not a feature that touches any of the seven owner-domains (Booking/Session/Follow-up/Progress/Package/Communication/Automation). No SQL writes; no domain functions added; no orchestrators. The script only reads filesystem and the GitHub API. ✅

### Principle II — Loud Failures ✅

- The pre-commit hook is non-blocking by design (FR-004): regeneration failures log via `console.error` (script context, not server-action context — `loudAction` doesn't apply). Commit still succeeds.
- The cron path emits a row to `automation_logs` on success/failure per existing n8n pattern. Failed cron run = `automation_logs.status='failed'` + Telegram alert via existing self-healing pattern.
- `Malformed` status (FR-007) for missing-spec.md folders writes a warning to `automation_logs` but doesn't crash the run. Loud-but-not-blocking — appropriate for diagnostic UX. ✅

### Principle III — Atomic Critical Paths, Best-Effort Side Effects ✅

- No multi-table critical path (no DB writes at all).
- The "regenerate INDEX.md" operation is atomic at the filesystem level: write to `INDEX.md.tmp`, then `mv` to `INDEX.md`. Either the new content is fully there, or the old content stays — never half-written.
- The post-commit operations (logging, Telegram alert on cron failure) are best-effort: they don't block the regen success path. ✅

### Principle IV — Auth at the Boundary ✅

- Not applicable in the script body — runs as either the developer (pre-commit, with their git identity) or the n8n cron service (with `drdeebtech@gmail.com` per FR-005).
- This PR does NOT expose an HTTP endpoint — n8n SSHes to the Mac mini and runs `npx tsx` directly, then commits + pushes. So no auth boundary needed. ✅

### Principle V — Tracer-Bullet Adoption ✅

- This feature IS the tracer-bullet for spec-kit's canonical workflow. By design, scope is tightly bounded: one script, one INDEX.md format, one pre-commit hook, one cron job.
- No new architectural pattern introduced. Reuses husky (industry-standard), tsx (already in stack), gh CLI (already used by other workflows), filesystem-atomic-write (industry-standard). ✅

### Additional Constraint — 50,000-user Scale Target (NON-NEGOTIABLE) ✅

Checked against the seven CRITICAL flags:

- **No new column updated per page render** — N/A; no DB writes. ✅
- **No admin action with unbounded UPDATE** — N/A; no SQL. ✅
- **No hot-path JOIN added solely for analytics** — N/A; no SQL. ✅
- **No returning-user backlog UX** — `Abandoned (last 90 days)` section is bounded to 90-day window per FR-003 + Q5 clarification. After 90 days rows auto-disappear; INDEX.md stays scannable. ✅
- **Cron sized for 50k × ~200 rows** — Not 50k × 200; this cron is 1× per repo per night. ≤30 in-flight specs × ≤30 PR-state API calls (cached) = bounded ≤30 calls/run. Run time <5 seconds. ✅
- **No sub-daily Vercel cron** — Cron runs on n8n on Mac mini (per CLAUDE.md cron policy), not Vercel. ✅
- **RLS predicates considered against 10M-row table** — N/A; no SQL. ✅

### Additional Constraint — Branch Hygiene (NON-NEGOTIABLE) ✅

- Branch `002-specs-index-generator` was created off fresh `main` via `create-new-feature.sh` (canonical script).
- Branch will become PR (this one) on the same day it was created (2026-05-08).
- No "v2" branch exists for this work.
- WIP is shipped as a draft PR same day, not held locally.
- Pre-work checks: `gh issue view` N/A (no issue); `gh pr list` shows zero in-flight PRs related to specs index; `git log main --grep='specs-index\|INDEX.md'` shows zero prior attempts; `git log main --diff-filter=D --oneline -- specs/INDEX.md` shows zero deliberately-removed prior attempts. ✅

**Result**: Constitution gate PASSES. No violations to track.

## Project Structure

### Documentation (this feature)

```text
specs/002-specs-index-generator/
├── spec.md              # Feature spec (clarified — 5 Q→A bullets)
├── plan.md              # This file
├── research.md          # Phase 0: pre-commit framework choice, idempotency strategy, cron commit pattern
├── data-model.md        # Phase 1: input shape (file scan output), output shape (INDEX.md table rows)
├── quickstart.md        # Phase 1: local dev + cron simulation steps
├── contracts/
│   └── generate-specs-index.md   # Phase 1: script CLI contract + output schema
└── checklists/
    └── requirements.md  # From /speckit.specify
# tasks.md added by /speckit.tasks (Phase 2)
```

### Source Code (repository root)

```text
scripts/
└── generate-specs-index.ts        # The script (deferred to /speckit.implement)
scripts/__tests__/
└── generate-specs-index.test.ts   # vitest tests

.husky/
└── pre-commit                     # Hook installed by `npx husky init` then customised

package.json:
  scripts:
    "prepare": "husky"             # husky-init script
    "specs:index": "tsx scripts/generate-specs-index.ts"
  devDependencies:
    "husky": "^9"
    "lint-staged": "^15"
  lint-staged config:
    "specs/**/*.md": "npm run specs:index && git add specs/INDEX.md"

specs/INDEX.md                     # Generated output — one source-controlled file
```

**Structure Decision**: Single tooling script under `scripts/`, lives next to existing FURQAN scripts (`scripts/new-migration.sh`, etc.). No new top-level directory. Tests under `scripts/__tests__/` follow the project's existing convention. The `.husky/` directory is created by `npx husky init` (one-time setup, committed once); thereafter contributors get the hook automatically on `npm install` because of the `prepare` script.

## Phase 0: Outline & Research

See [research.md](./research.md). Resolves:

- husky 9 setup pattern + the `prepare` script trick.
- lint-staged config for path-glob-based hook gating.
- Filesystem-atomic-write pattern in Node (`fs.writeFile` to `.tmp` → `fs.rename`).
- gh CLI invocation pattern for PR-state-by-branch.
- Idempotency: Markdown formatter normalisation so reruns produce zero diff when state is unchanged.
- n8n cron commit shape: identity = `drdeebtech@gmail.com`, subject prefix `[index-bot]`, push directly to main (no PR — drift-correction is too small to PR-gate).

## Phase 1: Design & Contracts

See:
- [data-model.md](./data-model.md) — input/output shapes (no DB schema; this is a pure-function-shaped tool).
- [quickstart.md](./quickstart.md) — local dev steps + cron simulation.
- [contracts/generate-specs-index.md](./contracts/generate-specs-index.md) — CLI invocation contract + INDEX.md output schema.

### Re-evaluation post-design

Constitution gate re-check passes after Phase 1 design. The data-model adds zero hot-path JOINs (no SQL). The contract is a pure function: filesystem + gh API in → markdown out. No backlog UX, no admin fan-out, no per-render writes. Branch Hygiene Rule still satisfied — same-day PR planned for tracer-bullet validation.

## Complexity Tracking

> **Fill ONLY if Constitution Check has violations that must be justified**

No violations to track.

## Phase 2 (NOT in this plan)

`/speckit.tasks` will produce `tasks.md` ordered by dependency. Expected ordering:

1. Install husky + lint-staged in package.json (devDeps + scripts).
2. Run `npx husky init` and customise `.husky/pre-commit`.
3. Implement `scripts/generate-specs-index.ts` against the contracts spec.
4. Write `scripts/__tests__/generate-specs-index.test.ts` with fixture-based tests.
5. Run the script once to produce the initial `specs/INDEX.md`.
6. Set up the n8n cron workflow (registered in `automation/BLUEPRINT.md`).
7. Update CLAUDE.md "Spec-Kit Workflow" section to reference INDEX.md as the entry point for spec discovery.
8. Smoke test: edit a spec, commit, verify INDEX.md updates.
9. Smoke test: bypass the hook (`--no-verify`), run the cron manually, verify drift detection + correction commit.

## Out of scope (deferred to future PRs)

- The actual implementation of `generate-specs-index.ts` — this PR ships only the spec-kit artefacts (PR B's tracer-bullet purpose).
- Backfilling INDEX.md for the existing `specs/001-murajaah-scheduler/` and `specs/002-specs-index-generator/` directories — comes for free from the first run after implementation lands.
- Cross-repo aggregation (per spec out-of-scope).
- A web UI (per spec out-of-scope).
