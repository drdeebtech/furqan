# Implementation Plan: n8n Re-establish & Harden — Full Automation Coverage

**Branch**: `009-n8n-cron-all-routes` | **Date**: 2026-05-13 | **Spec**: [./spec.md](./spec.md)
**Input**: Feature specification from `/specs/009-n8n-cron-all-routes/spec.md`

## Summary

Close the operational gap between documented n8n state and reality. **Primary requirements:**

1. Wire **5 missing cron routes** (`auto-complete-sessions`, `cache-clear`, `handoff-cleanup`, `murajaah-due`, `n8n-healthcheck`) through n8n with the canonical dual-auth + `Log Run` parallel pattern.
2. Add `withCronMonitor` wrappers to `cache-clear` (`0 4 * * *`) and `n8n-healthcheck` (`*/15 * * * *`).
3. Run `scripts/n8n-harden/run.mjs` against all ~20 unhardened TARGETS workflows (idempotent).
4. Backfill `AUTOMATION_REGISTRY.md` so every TARGETS pair has a complete row; partition non-TARGETS rows into a `Phase-N Backlog` subsection.
5. Build `scripts/n8n-audit.mjs` that diffs n8n REST → registry and prints 3 Markdown sections.

**Technical approach**: zero new schema; existing `automation_logs` is authoritative. New n8n workflows are imported via REST direct-PUT through `scripts/n8n-harden/lib.mjs` (MCP regenerates UUIDs and breaks credentials, per runbook). Registry truth-sync is doc work + table parsing in the audit script.

## Technical Context

**Language/Version**: Node.js 24.x (runtime + scripts); TypeScript 5.x (Next.js app); n8n workflow JSON (declarative)
**Primary Dependencies**: Next.js 16.2.x, `@/lib/sentry/cron` (`withCronMonitor`), `@/lib/supabase/admin` (service-role client), `scripts/n8n-harden/lib.mjs` (REST helpers + credential map)
**Storage**: Supabase Postgres — `automation_logs` table (existing, authoritative); n8n internal SQLite for workflow JSON + credentials
**Testing**: Vitest for route handler unit tests; manual smoke-test post-import (verify a row in `automation_logs` after first fire); audit script self-test via mocked REST response
**Target Platform**: Vercel Pro for app routes; n8n on Mac mini (`n8n.drdeeb.tech`) for scheduler
**Project Type**: web-service (Next.js 16 App Router) + supporting Node scripts
**Performance Goals**: cron route P95 < 5s server-side; n8n schedule drift < 60s; audit script run < 10s
**Constraints**:
- All cron payloads must be idempotent (per `automation_logs.idempotency_key`)
- All HTTP-out from n8n must carry both `Authorization: Bearer ${CRON_SECRET}` and `X-N8N-Secret` headers (CLAUDE.md dual-auth pattern)
- 50k DAU sizing: nightly jobs touch ~10M rows/night — keep batch sizes and indexes sized accordingly
- No new tables, no migration in this spec (Clarification Q4 + Q6)
**Scale/Scope**: 10 cron routes; ~22 existing n8n workflows; ~30 stub registry rows to partition; 2 new `withCronMonitor` wrappers; 1 new audit script (~150 LOC)

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Principle | Compliance | Evidence |
|-----------|------------|----------|
| **I — Domain Ownership** | ✅ Pass | All workflows are Automation-domain consumers of canonical events from `WEBHOOK_ROUTES` in `src/lib/automation/emit.ts`. No new owner-domain. |
| **II — Loud Failures** | ✅ Pass | FR-006 + FR-013 enforce `automation_logs` write on every fire; FR-015 escalates critical-tagged failures to Telegram; FR-016 keeps best-effort writes piped through `logError`. |
| **III — Atomic Critical Paths** | ✅ Pass | All n8n workflows run **post-commit** (per ADR-0004 §"Failure semantics"). No workflow is a critical path. They never replace SQL functions for multi-table writes. |
| **IV — Auth at the Boundary** | ✅ Pass | FR-005 keeps `Bearer CRON_SECRET` + `X-N8N-Secret` dual-auth at route adapters; FR-020 keeps `/api/webhooks/n8n` constant-time `X-N8N-Secret` verification untouched. Domain code never reads cookies. |
| **V — Tracer-Bullet Adoption** | ✅ Pass | The 5-cron-wiring is the pilot. Once `automation_logs` shows clean fires for the 10/10 cron routes, Phase-2 backlog (Stripe webhook, parent reports v2) inherits the same pattern. |

**No violations. No Complexity Tracking entries needed.**

## Project Structure

### Documentation (this feature)

```text
specs/009-n8n-cron-all-routes/
├── plan.md              # This file
├── research.md          # Phase 0: cron expression rationale, batch sizing
├── data-model.md        # Phase 1: automation_logs view, registry row shape, audit-script output
├── quickstart.md        # Phase 1: operator runbook for the full rollout
├── contracts/
│   └── n8n-workflow-shape.md  # Required nodes + auth headers for every cron-firing workflow
└── tasks.md             # Phase 2 (NOT created here)
```

### Source Code (repository root — incremental changes only)

```text
src/app/api/cron/
├── audit-cleanup/route.ts          # ✓ existing (canonical pattern; unchanged)
├── auto-complete-sessions/route.ts # ✓ has withCronMonitor (wire n8n only)
├── bunny-stuck-lessons/route.ts    # ✓ wired
├── cache-clear/route.ts            # ✏️ ADD withCronMonitor("cron-cache-clear","0 4 * * *",…)
├── email-health/route.ts           # ✓ wired
├── handoff-cleanup/route.ts        # ✓ has withCronMonitor (wire n8n only)
├── murajaah-due/route.ts           # ✓ has withCronMonitor (wire n8n only)
├── n8n-healthcheck/route.ts        # ✏️ ADD withCronMonitor("cron-n8n-healthcheck","*/15 * * * *",…)
├── reconciliation/route.ts         # ✓ wired
└── retention-score/route.ts        # ✓ wired

scripts/n8n-harden/
├── lib.mjs                          # ✓ existing — extend with `listWorkflows()` REST helper if missing
└── run.mjs                          # ✏️ add new TARGETS rows for 5 newly-wired workflows after import

scripts/
└── n8n-audit.mjs                    # ✏️ NEW — registry/n8n diff, Markdown output

AUTOMATION_REGISTRY.md               # ✏️ backfill 22 complete rows + partition stubs into Phase-N Backlog
docs/n8n-hardening-runbook.md        # ✏️ append: "running audit script" sub-section

# n8n side (not in repo)
n8n workflows imported via REST direct-PUT for the 5 missing cron coverage:
  - furqan-cron-auto-complete-sessions
  - furqan-cron-cache-clear
  - furqan-cron-handoff-cleanup
  - furqan-cron-murajaah-due
  - furqan-cron-n8n-healthcheck
```

**Structure Decision**: This is a *web-service* feature with supporting Node scripts. No new app-tier modules; the changes are surgical edits + new operational tooling. n8n workflow JSON lives only in n8n's storage (Clarification Q5/Q6 + FR-019: workflow JSON committed to repo MUST NOT contain secrets — and since each workflow JSON references credential IDs unique to drdeeb's n8n install, committing them adds no value).

## Complexity Tracking

> Constitution Check passed without violations. Section intentionally empty.

| Violation | Why Needed | Simpler Alternative Rejected Because |
|-----------|------------|-------------------------------------|
| — | — | — |
