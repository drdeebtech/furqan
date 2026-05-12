# Implementation Plan: Operational Debt Cleanup — Bad-List Batch

**Branch**: `008-ops-debt-cleanup` | **Date**: 2026-05-12 | **Spec**: [./spec.md](./spec.md)
**Input**: Feature specification from `/specs/008-ops-debt-cleanup/spec.md`

## Summary

Clear seven operational-debt items from the 2026-05-12 audit in one workstream. Code work is one well-scoped slice (US2: ~30 audit-log call sites migrated from fire-and-forget to `.catch(logError)`). Everything else (US1 Daily.co secret distribution; US3 Sentry GitHub App org install; US4 K6 row cleanup; US5 Supabase MCP login) is operator-configuration work executable from already-authored runbooks. FR-012 and FR-013 are documentation of already-shipped state, not new work.

Technical approach: extend the existing `loudAction` and `logError` primitives across the remaining audit-log sites; do not introduce new abstractions. For operator items, the runbook is the executable artifact — implementation = execution.

## Technical Context

**Language/Version**: TypeScript 5.x on Next.js 15 App Router; SQL for already-shipped Postgres functions (`start_session_from_webhook`, `end_session_from_webhook`); Bash for runbook steps.
**Primary Dependencies**: `@supabase/supabase-js`, `@sentry/nextjs`, the in-repo `loudAction` / `logError` / `createAdminClient` primitives. No new packages introduced.
**Storage**: Supabase Postgres (project ref `xyqscjnqfeusgrhmwjts`). No schema changes.
**Testing**: Vitest for unit (`webhook-handler.test.ts`, `webhook-verify.test.ts`, `idempotency.test.ts`); Playwright for E2E (`daily-webhook-reconciliation.spec.ts`, `daily-webhook-idempotency.spec.ts`); manual runbook execution for operator items.
**Target Platform**: Vercel Pro for the app; n8n on Mac mini for downstream side effects; operator's browser for Sentry/Daily/Supabase dashboards.
**Project Type**: web-service (Next.js App Router).
**Performance Goals**: Webhook P95 < 500ms (already met by shipped handler — fire-and-forget event emission). `.catch(logError)` on best-effort writes adds zero hot-path overhead (synchronous attach, async resolution).
**Constraints**: 50k DAU sizing — ~30 admin sites × ~5 admin actions/day each = ~150 audit-log writes/day total (low volume; this fix is not write-amplifying). ±15-min webhook skew window (FR-001). HMAC rotation overlap supported.
**Scale/Scope**: 50,000 users target. Code surface: ~30 call sites across ~12 files in `src/app/admin/**/actions.ts` and `src/app/api/**/route.ts`. Operator surface: 4 runbooks already authored under `docs/runbooks/`.

## Constitution Check

*GATE: Re-check after Phase 1 design.*

| Principle | Status | Notes |
|---|---|---|
| **I. Domain Ownership** | ✅ Pass | US1 (Daily.co webhook) lives in `src/app/api/webhooks/daily/route.ts` delegating to `src/lib/daily/webhook-handler.ts` which calls Session-domain SQL functions. Already constitution-aligned post spec 007. No domain boundary crossed. |
| **II. Loud Failures (NON-NEGOTIABLE)** | ✅ Pass — this spec EXTENDS the principle | US2 directly implements §II: every remaining `audit_log` insert gets `.catch(logError)` per the policy. No regressions; only filling existing gaps. |
| **III. Atomic Critical Paths, Best-Effort Side Effects** | ✅ Pass | `audit_log` writes are best-effort by definition (§III). The migration preserves that: writes remain non-blocking, only the *failure path* changes from silent to logged. Session lifecycle's atomic writes already live in Postgres functions. |
| **IV. Auth at the Boundary** | ✅ Pass | Webhook route enforces HMAC at the boundary; admin actions enforce `requireAdmin` at the route adapter; domain functions stay auth-free. No changes. |
| **V. Tracer-Bullet Adoption** | ✅ Pass | This spec generalizes patterns ALREADY proven (loudAction, logError, webhook handler from spec 007). No new architectural pattern introduced — only completing the rollout. |

| Additional Constraint | Status | Notes |
|---|---|---|
| Bilingual UX | N/A | Operator-facing only; no user-visible Arabic strings affected. |
| DB migration discipline | N/A | No new migrations. |
| Secrets and env vars | ⚠️ Action item | `DAILY_WEBHOOK_SECRET` is the only new env var. Must be added to the env-var table in `docs/agents/CLAUDE-reference.md` in this same PR per the constraint. Also add to Vercel (Production) and GitHub Secrets. |
| 50,000-user scale | ✅ Pass | `.catch(logError)` adds zero write-path amplification. ~150 audit writes/day even at 50k. K6 cleanup is one-shot, not recurring. Daily.co webhook is event-driven, not per-render. |

**No violations require Complexity Tracking entries.**

## Project Structure

### Documentation (this feature)

```text
specs/008-ops-debt-cleanup/
├── spec.md                              # /speckit.specify output (done)
├── plan.md                              # /speckit.plan output (this file)
├── tasks.md                             # /speckit.tasks output (next)
├── checklists/
│   └── requirements.md                  # validation checklist (done)
└── (no research.md — no novel design)
└── (no data-model.md — no schema changes)
└── (no contracts/ — no new API surfaces)
```

### Source Code (affected paths)

```text
src/
├── app/
│   ├── admin/
│   │   ├── settings/actions.ts              # 1 audit_log site
│   │   ├── sessions/actions.ts              # 3 audit_log sites
│   │   ├── users/actions.ts                 # 5 audit_log sites
│   │   ├── packages/actions.ts              # 4 audit_log sites
│   │   ├── credits/actions.ts               # 1 audit_log site
│   │   ├── moderation/actions.ts            # 4 audit_log sites
│   │   ├── follow-up/grade/actions.ts       # 1 audit_log site
│   │   ├── retention/actions.ts             # 1 automation_logs site
│   │   └── automation/replay/actions.ts     # 5 audit_log + automation_logs sites
│   └── api/
│       ├── auth/logout/route.ts             # 1 audit_log site
│       ├── n8n/toggle/route.ts              # 2 audit_log sites
│       ├── n8n/auto-restart/route.ts        # 1 audit_log + 1 automation_logs
│       └── cron/n8n-healthcheck/route.ts    # 1 automation_logs site
└── (no changes outside admin actions and api routes)

docs/
├── agents/CLAUDE-reference.md            # add DAILY_WEBHOOK_SECRET to env-var table
└── runbooks/                             # all already-authored; execution only
    ├── sentry-auto-resolve-fix.md
    ├── k6-test-users-cleanup.md
    └── supabase-mcp-account-switch.md
```

**Structure Decision**: This is a brownfield surgical edit, not a new module. No new directories. Every code change is a one-line addition (`.catch((err) => logError(...))`) chained off an existing `await supabase.from("audit_log" | "automation_logs").insert(...)`. Operator items have no code surface beyond the env-var table entry.

## Phase Outputs

### Phase 0 — Research

Skipped. No unknowns: shipping primitives (`loudAction`, `logError`, webhook handler) already exist and are documented in CLAUDE.md and the spec 007 implementation. Diagnosis runbooks are already authored.

### Phase 1 — Design Artifacts

Skipped. No new entities, no new API contracts, no schema changes. The spec's "Key Entities" section enumerates what's already in the codebase.

### Phase 2 — Tasks (next: `/speckit.tasks`)

Tasks will partition along US1–US5 priority order:

- **US1 (P1)** — 3 tasks (env-var entry, Vercel secret set, Daily.co dashboard URL register).
- **US2 (P1)** — 1 task per file × ~12 files = ~12 mechanical edits. Each is one `.catch(logError)` chain. Reviewable in a single sweep.
- **US3 (P2)** — 1 task: operator executes `docs/runbooks/sentry-auto-resolve-fix.md`. Verification by probe PR.
- **US4 (P2)** — 1 task: operator executes `docs/runbooks/k6-test-users-cleanup.md`. Verification by count query.
- **US5 (P3)** — 1 task: operator executes `docs/runbooks/supabase-mcp-account-switch.md`. Verification by MCP `list_projects`.

Total: ~18 tasks, of which ~12 are mechanical code edits, 4 are operator runbook executions, and 2 are env-var documentation.

## Complexity Tracking

No violations. Empty.
