# Implementation Plan: Murajaah Scheduler (مراجعة)

**Branch**: `001-murajaah-scheduler` | **Date**: 2026-05-08 | **Spec**: [spec.md](./spec.md)
**Input**: Feature specification from `/specs/001-murajaah-scheduler/spec.md` (clarified 2026-05-08)
**Constitution**: `.specify/memory/constitution.md` v1.1.0

## Summary

Daily spaced-repetition review prompt for FURQAN students, computed nightly from `student_progress` and surfaced on the student dashboard. SM-2 algorithm with per-row easiness-factor drift; nightly cron pre-computes tomorrow's batch into a new `student_review_schedule` table; dashboard reads cache only (no on-the-fly compute). Items 8+ days overdue route to the teacher's "needs reteaching" panel instead of cluttering the student card. Three new server actions, one new Postgres function, one new SQL migration, one new n8n workflow, three new dashboard widgets.

Sized for the **50,000-user Scale Target Rule** (CLAUDE.md, constitution v1.1.0): zero per-render writes, zero hot-path JOINs added, no admin-tune fan-out, teacher-panel routing for backlog instead of student-side remediation cards.

## Technical Context

**Language/Version**: TypeScript 5 + Next.js 16.2.2 (App Router, Turbopack), React 19, PostgreSQL 17 (via Supabase)
**Primary Dependencies**: `@supabase/ssr` (server actions), `@supabase/supabase-js` (admin), Daily.co (unused for this feature), n8n (nightly cron trigger), Tailwind CSS 4
**Storage**: PostgreSQL 17 — one new table (`student_review_schedule`) with `(student_id, progress_id)` primary key; reads from existing `student_progress`, `platform_settings`, `notifications`, `communication_preferences`
**Testing**: Playwright (E2E), Vitest (unit/integration), Supabase test fixtures
**Target Platform**: Vercel Pro (web) + Supabase (DB) + n8n on Mac mini (cron)
**Project Type**: Existing Next.js web application; this feature is one domain extension under `src/lib/domains/progress/`
**Performance Goals**: Dashboard P95 stays within +50ms of baseline at 50k DAU; nightly cron completes in <30 minutes for 50k students × ~200 progress rows = 10M row evaluations
**Constraints**: NON-NEGOTIABLE 50k-user scale target; no per-render UPDATE on profiles or hot tables; no bulk-fan-out admin actions; no JOINs added to dashboard hot path
**Scale/Scope**: 50,000 users, ~200 `student_progress` rows per student avg, ~5 dashboard hits/day per active student → 250k cache reads/day, 10M row-touches per nightly cron

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-checked after Phase 1 design.*

### Principle I — Domain Ownership ✅

- **Owner-domain**: Progress (primary). Owns `student_review_schedule` table.
- **Cross-domain choreography**: nightly cron is single-domain Postgres function — no cross-domain orchestrator needed for v1. The "mark complete" action stays inside Progress; it does not write to other domains.
- **Communication domain consumed read-only** via `notify(opts)`; no writes.
- **Session domain consumed read-only** by the teacher panel for cross-referencing upcoming sessions; no writes.
- No new owner-domain introduced. ✅

### Principle II — Loud Failures ✅

- `markReviewComplete` server action wrapped in `loudAction` (FR-007).
- Consuming forms render `<ActionFeedback state={...} />`.
- Best-effort calls (`notify(...)`, `emitEvent("murajaah.completed")`) wrapped in `logError` per CLAUDE.md "No Silent Failures Policy".
- Cron's nightly run logs success/failure to `automation_logs` per existing n8n callback pattern. ✅

### Principle III — Atomic Critical Paths, Best-Effort Side Effects ✅

- New Postgres function `compute_murajaah_batch_for_date(p_date)` runs the cron's per-student SM-2 + insert-into-schedule atomically (FR-008). Idempotent within UTC date.
- `markReviewComplete` uses a Postgres function `complete_review(p_schedule_id, p_quality)` so the EF recompute + `next_review_at` update + `last_reviewed_at` set + `lapse_count` adjustment are one transaction.
- Side effects (`notify`, `emitEvent`) are post-commit, never thrown. ✅

### Principle IV — Auth at the Boundary ✅

- All three server actions (`markReviewComplete`, `markReteachComplete`, `tuneSm2Constants`) call `requireRole("student")`, `requireRole("teacher")`, `requireRole("admin")` at the route adapter (FR-009).
- Domain functions in `src/lib/domains/progress/` accept structured input only.
- `UnauthenticatedError` / `ForbiddenError` distinct error classes, mapped at the route adapter. ✅

### Principle V — Tracer-Bullet Adoption ✅

- Single feature pilot. No new architectural pattern introduced. Reuses ADR-0004's "atomic-critical-path-via-Postgres-function + best-effort-post-commit" pattern from booking-confirm.
- One PR per implementation phase (see Phase 2 task breakdown). ✅

### Additional Constraint — 50,000-user Scale Target (NON-NEGOTIABLE) ✅

Checked against the seven CRITICAL flags in constitution v1.1.0:

- **No new column updated per page render** — `last_dashboard_view_at` was rejected during clarify (Q4) in favour of behavioural `last_reviewed_at`. ✅
- **No admin action that performs unbounded UPDATE** — admin EF tune writes one row in `platform_settings`; rejected the "force-reset all rows" alternative during clarify (Q5). ✅
- **No hot-path JOIN added solely for analytics** — `algorithm_version` lives on the row, not in a separate `algorithm_runs` table; rejected during clarify (Q3). ✅
- **No returning-user backlog UX** — items 8+ days overdue route to teacher-panel reteach queue (FR-013); rejected the "all overdue capped at 15" alternative during clarify (Q2). ✅
- **Cron sized at 50k × ~200 rows** — research.md §"Cron sizing" confirms <30 min runtime budget. Function uses index on `(student_id, next_review_at)`. ✅
- **No sub-daily Vercel cron** — n8n on Mac mini handles the 02:00 UTC daily trigger. ✅
- **RLS predicates considered against 10M-row table** — see data-model.md §"RLS at scale". ✅

**Result**: Constitution gate PASSES. No violations to track in Complexity Tracking.

## Project Structure

### Documentation (this feature)

```text
specs/001-murajaah-scheduler/
├── plan.md              # This file
├── spec.md              # Feature spec (clarified)
├── research.md          # Phase 0: SM-2 algorithm + cron sizing + index strategy
├── data-model.md        # Phase 1: tables, columns, indexes, RLS, migrations
├── quickstart.md        # Phase 1: how to run/test locally
└── contracts/           # Phase 1: server action signatures
    ├── markReviewComplete.md
    ├── markReteachComplete.md
    └── tuneSm2Constants.md
# tasks.md added by /speckit.tasks (Phase 2)
```

### Source Code (repository root)

```text
src/
├── app/
│   ├── student/dashboard/page.tsx                    # Add MurajaahCard component
│   ├── student/dashboard/actions.ts                  # markReviewComplete server action
│   ├── teacher/students/[studentId]/page.tsx         # Add NeedsReteachingPanel + UpcomingReviewsPanel
│   ├── teacher/students/[studentId]/actions.ts       # markReteachComplete server action
│   ├── admin/settings/page.tsx                       # Add MurajaahSettingsSection
│   └── admin/settings/actions.ts                     # tuneSm2Constants server action
├── lib/
│   ├── domains/
│   │   └── progress/
│   │       ├── murajaah.ts                           # Domain functions: getDailyBatch, markComplete, etc.
│   │       └── murajaah.test.ts                      # Unit tests with vi.mock
│   └── automation/
│       └── emit.ts                                   # Add 'murajaah.completed', 'murajaah.due' to WEBHOOK_ROUTES
├── components/
│   └── student/
│       └── murajaah-card.tsx                         # Dashboard card (5–15 rows)
└── types/
    └── database.ts                                   # Generated post-migration to include student_review_schedule

supabase/migrations/
└── 20260509000000_murajaah_scheduler.sql            # Table + indexes + RLS + Postgres functions

automation/n8n-workflows/
└── murajaah-nightly-cron.json                       # n8n workflow JSON for 02:00 UTC daily trigger
```

**Structure Decision**: Reuses existing `src/lib/domains/<domain>/` shape per ADR-0002 / ADR-0004. New code lands inside `progress/` (new sibling files to whatever progress already has). No `orchestrate.ts` needed because there is no cross-domain choreography — the critical path stays within Progress, and `notify`/`emitEvent` are best-effort post-commit, not orchestration.

## Phase 0: Outline & Research

See [research.md](./research.md). Resolves:

- **SM-2 algorithm parameters** — initial interval, easiness factor bounds, lapse penalty curve.
- **Cron sizing** — fan-out math at 50k × ~200 rows, index strategy, lock impact.
- **Postgres function shape** — idempotency strategy, batch_for_date partitioning.
- **n8n workflow shape** — trigger, retry policy, healthcheck pairing.
- **Index strategy on `student_review_schedule`** — composite indexes for the three hot queries (today's batch, teacher's 30-day queue, teacher's reteach queue).
- **RLS policies at 10M-row scale** — student-isolation predicate that uses an index seek, not a sequential scan.

## Phase 1: Design & Contracts

See:
- [data-model.md](./data-model.md) — table schema, indexes, RLS policies, migration outline.
- [quickstart.md](./quickstart.md) — local dev steps to run the cron manually and verify the dashboard.
- [contracts/](./contracts/) — three server-action signatures: `markReviewComplete`, `markReteachComplete`, `tuneSm2Constants`.

### Re-evaluation post-design

Constitution gate re-check passes after Phase 1 design. The data model adds zero hot-path JOINs (algorithm_version is on the same row), zero per-render writes (last_reviewed_at is updated on click only), zero bulk-fan-out admin actions (tuneSm2Constants writes one row in `platform_settings`).

## Complexity Tracking

> **Fill ONLY if Constitution Check has violations that must be justified**

No violations to track. The plan complies with all five principles plus the 50k Scale Target Rule.

## Phase 2 (NOT in this plan)

`/speckit.tasks` will produce `tasks.md` ordered by dependency. Expected task ordering at a glance:

1. Migration: create `student_review_schedule` + indexes + RLS + Postgres functions (`compute_murajaah_batch_for_date`, `complete_review`, `mark_reteach_complete`).
2. Domain functions in `src/lib/domains/progress/murajaah.ts` with unit tests.
3. n8n workflow JSON checked into `automation/n8n-workflows/`.
4. Server actions (`markReviewComplete`, `markReteachComplete`, `tuneSm2Constants`).
5. UI components (`MurajaahCard`, `NeedsReteachingPanel`, `UpcomingReviewsPanel`, `MurajaahSettingsSection`).
6. E2E test (Playwright) covering all three role surfaces.
7. Add `murajaah.due` and `murajaah.completed` to `WEBHOOK_ROUTES` in `emit.ts`.
8. Add `EVENT_CATALOG.md` entries for the two new events.
9. Add `LIFECYCLES.md` state diagram for the schedule row's `next_review_at` lifecycle.
10. Update `CONTEXT.md` "Domains" — Progress now owns `student_review_schedule`.
11. Healthcheck: extend `/api/cron/n8n-healthcheck` to flag missed Murajaah runs.
