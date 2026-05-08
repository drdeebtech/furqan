# Implementation Plan: Follow-up Lifecycle (دورة حياة المتابعة)

**Branch**: `004-followup-lifecycle` | **Date**: 2026-05-08 | **Spec**: [spec.md](./spec.md)
**Input**: Feature specification from `/specs/004-followup-lifecycle/spec.md` (brownfield documentation; no clarify pass needed — the feature has been in production since V10)
**Constitution**: `.specify/memory/constitution.md` v1.2.0
**Tracking issue**: #230

## Summary

Brownfield documentation plan for the follow-up (متابعة) lifecycle — same shape as `003-booking-lifecycle`. No new code, no new migrations, no new n8n workflows. Documentation phases retroactively capture the V10-shipped follow-up domain in spec-kit format so the domain is governed by `.specify/memory/constitution.md` and findable from `specs/INDEX.md`.

This is the **second** of three Phase 1 lifecycle PRs (after 003-booking, before 005-package-deduction). The follow-up domain is more complex than booking because of (a) auto-regeneration via `parent_assignment_id` self-reference, (b) audio-submission storage path, and (c) coupling to the murajaah scheduler via `review_horizon`. The spec catches one significant brownfield drift not visible from prose alone: `homework_status` is a 6-value enum, not the 3-value diagram in `LIFECYCLES.md` §3.

Sized for the **50,000-user Scale Target Rule**: production-validated at current load; SC-004 and SC-005 in spec.md formalise the 50k DAU budget. No retrofit work in this PR — known scale gaps (auto-regen depth cap, transactional storage path) catalogued as D-004 / edge-cases routing to Phase 2 audit.

## Technical Context

**Language/Version**: TypeScript 5 + Next.js 16.2.2 (App Router, Turbopack), React 19, PostgreSQL 17 (via Supabase)
**Primary Dependencies**: `@supabase/ssr` (server actions), Supabase Storage (audio files), n8n on Mac mini (parent-report and quality-monitor workflows fed by `homework.*` events)
**Storage**: PostgreSQL 17 — `homework_assignments` table (canonical state, self-referencing via `parent_assignment_id`), Supabase Storage bucket for audio
**Testing**: Playwright (E2E follow-up create→ready→grade→regen flow), Vitest (server-action unit tests), TS-only state-machine enforcement (no DB trigger backstop — D-002)
**Target Platform**: Vercel Pro (web) + Supabase (DB + Storage) + n8n on Mac mini (event consumers)
**Project Type**: Existing Next.js web application; the follow-up domain is colocated in `src/lib/actions/homework.ts` (single file owns all 6 server actions). Future consolidation into `src/lib/domains/followup/` per ADR-0002.
**Performance Goals**: P95 follow-up-action latency ≤1500ms at 50k DAU (audio uploads dominate the tail; SC-004); auto-regen runs in same transaction as grade (SC-002); murajaah nightly query budget <30min (SC-005, shared with spec 001).
**Constraints**: NON-NEGOTIABLE — auto-regeneration MUST be atomic with the grade write (FR-004). Bilingual rule MUST hold: code says `homework`, prose says `follow-up` / `متابعة`. Audio upload MUST precede status flip to `student_ready` (FR-005).
**Scale/Scope**: 50,000 users; ~5 follow-ups/student/month avg → ~250k follow-up rows/month; auto-regen rate <10% (only `needs_work`/`not_done` grades trigger); 0–3 audio uploads per `student_ready`/student.

## Constitution Check

*GATE: Must pass before Phase 0 documentation. Re-checked after Phase 1 design. Brownfield-stance: each principle's verdict reflects what production CURRENTLY does; documented divergences listed under spec.md "Known divergences" route to Phase 2.*

### Principle I — Domain Ownership ✅

- **Owner-domain**: Follow-up. Owns `homework_assignments.status` (source of truth), the `homework_status` ENUM, and canonical `homework.assigned` / `homework.student_ready` / `homework.graded` events.
- **Cross-domain choreography**: `gradeHomework` fans out to Communication (`notify` student + parent), Automation (`emitEvent` to n8n parent-report workflow), Progress (auto-regen creates new follow-up), Murajaah-scheduler (read-only via `review_horizon`). Per ADR-0004, this should consolidate into `src/lib/domains/followup/orchestrate.ts` (target state); current code inlines the choreography in `homework.ts` (D-001-adjacent pattern).
- **No new owner-domain introduced.** ✅

### Principle II — Loud Failures 🔴 CRITICAL DRIFT (DOCUMENTED)

- **Target state codified by FR-008**: every `homework_assignments`-mutating server action wraps via `loudAction`.
- **Current production state**: **0 of 6 server actions are wrapped.** All of `createHomework`, `markStudentReady`, `gradeHomework`, `editHomework`, `getHomeworkAudioUrl`, `deleteHomework` use ad-hoc `{ ok, error }` returns. This is a larger Principle II drift than the booking domain (which had 4/7 wrapped).
- **Decision**: documented as D-001 in spec.md. Per descriptive stance + operator's prior accept-drift-and-proceed decision on lifecycle 1 (PR #226), this PR ships the documentation; Phase 2 audit batch wraps all 6 actions plus the booking-side 3 in one or two PRs targeting `src/lib/actions/homework.ts` and `src/app/teacher/dashboard/actions.ts`. 🔴 Documented, NOT concealed; severity explicitly upgraded to CRITICAL because zero adoption is qualitatively different from partial adoption.

### Principle III — Atomic Critical Paths, Best-Effort Side Effects ⚠️ DRIFT

- **Atomic critical path #1 — grade + auto-regen**: spec.md FR-004 requires the grade UPDATE and the auto-regen INSERT to be in the same transaction. Current code in `homework.ts` does this via two-step Supabase client calls inside the same server-action invocation. Whether they run as one transaction depends on Supabase JS client behavior (which does not implicitly transaction-wrap multiple `.from()` calls). **Verify in research.md / Phase 2**: this may need a Postgres function `grade_homework_with_regen(p_id, p_grade)` to truly satisfy Principle III.
- **Atomic critical path #2 — Storage upload + status flip**: FR-005 requires upload-before-flip. The current code does this sequentially in TS but with no rollback if the second step fails. This is the same shape as Daily.co room creation in booking-confirm (Decision 3 in 003-booking research.md): external first, DB second, no retry on partial. Acceptable but loud-failure-dependent (Principle II), which is currently absent.
- **Best-effort side effects**: `notify(...)` and `emitEvent(...)` are fire-and-forget with `.catch(logError)` per the existing code at `homework.ts:124`, `:214`, `:341`. ✅
- **Verdict**: ⚠️ Cannot fully assert atomic-grade-and-regen until research.md confirms Postgres-function path or documents the two-step risk. Filed as a research item, not blocking this PR.

### Principle IV — Auth at the Boundary ✅

- Route adapters call `requireRole(...)` — `requireRole("teacher")` for create/grade/edit/delete; `requireRole("student")` for `markStudentReady` and `getHomeworkAudioUrl`. Verified by inspection of `homework.ts` action calls.
- `UnauthenticatedError` / `ForbiddenError` distinct error classes per Constitution Principle IV.
- Domain functions in `src/lib/actions/homework.ts` receive already-authenticated input. ✅
- spec.md Assumptions explicitly states this. ✅

### Principle V — Tracer-Bullet Adoption ✅

- Brownfield-documentation pilot, not architectural shift. Same precedent as 003-booking-lifecycle. ✅

### Additional Constraint — 50,000-user Scale Target (NON-NEGOTIABLE) ✅

Checked against the seven CRITICAL flags:

- **No new column updated per page render** — none introduced. ✅
- **No admin action that performs unbounded UPDATE** — none introduced. ✅
- **No hot-path JOIN added solely for analytics** — none introduced. ✅
- **No returning-user backlog UX** — D-004 (no depth cap on regen) is a *related* concern but doesn't manifest as a UX surface; the spec's User Story 3 explicitly notes operator should consider routing past-N-attempts to teacher reteach panel (parallel to murajaah's 8+-day routing). Not introduced by this PR; flagged for Phase 2.
- **Cron sizing** — no new cron. The murajaah scheduler nightly cron consumes `homework_assignments` via the `review_horizon` partial index; SC-005 confirms it sized for 50k. ✅
- **No sub-daily Vercel cron** — n/a. ✅
- **RLS predicates considered against 10M-row table** — `homework_assignments` will grow to ~3M rows/year at 50k DAU. RLS uses `student_id = auth.uid()` (student) / `teacher_id = auth.uid()` (teacher) / `is_admin()`. Index on `(student_id, status)` keeps student dashboard fast. ✅

### Additional Constraint — Branch Hygiene (NON-NEGOTIABLE) ✅

- Branch `004-followup-lifecycle` is fresh from main (verified via `git checkout main && git pull --ff-only && git checkout -b 004-followup-lifecycle`). ✅
- Tracking issue #230 exists; PR will reference `Closes #230`. ✅
- Same-day push and PR. ✅
- No `v2`. ✅
- Pre-work checks: `gh issue view 230` ✓, `gh pr list` ✓, `git log main --diff-filter=D --oneline -- specs/004-*` empty (no retired work). ✅

### Additional Constraint — Bilingual UX (FURQAN-specific) ✅

- spec.md uses "follow-up" / "متابعة" in all user-facing prose.
- Code identifiers (`homework_assignments`, `homework_status`, `createHomework`, etc.) preserved per "rename not worth blast radius" pattern.
- Migration `20260505191211_update_help_center_homework_label_to_followup.sql` is the canonical UI rename precedent. ✅

**Result**: Constitution gate PASSES with **2 documented drifts** (CRITICAL on Principle II; ⚠️ on Principle III pending research). Both routed to Phase 2; not blocking this documentation PR.

## Project Structure

### Documentation (this feature)

```text
specs/004-followup-lifecycle/
├── spec.md              # Feature spec (brownfield, 6-state machine)
├── plan.md              # This document
├── research.md          # Decisions log
├── data-model.md        # Schema reference
├── tasks.md             # Generated by /speckit.tasks
└── contracts/
    ├── createHomework.md
    ├── markStudentReady.md
    ├── gradeHomework.md
    ├── editHomework.md
    ├── getHomeworkAudioUrl.md
    └── deleteHomework.md
```

### Source code (existing — read-only references)

```text
src/lib/actions/homework.ts                                        # all 6 server actions
src/app/teacher/.../follow-up/                                     # teacher UI
src/app/student/follow-up/                                         # student UI
supabase/migrations/20260504210746_add_homework_audio_submission.sql
supabase/migrations/20260505131935_add_review_horizon_to_homework.sql
supabase/migrations/20260505191211_update_help_center_homework_label_to_followup.sql
src/lib/supabase/migrations/v10_002_homework.sql                   # base schema (parent_assignment_id FK)
src/lib/automation/emit.ts                                         # emitEvent for homework.* events
src/lib/notifications/dispatcher.ts                                # notify() / parent path
```

## Phase 0 — Research (already complete)

See [research.md](./research.md). Captures the load-bearing decisions:

1. Why follow-up has TS-only enforcement (no DB trigger like booking).
2. Why auto-regeneration is inline in `gradeHomework()` (not a Postgres function — atomic-path concern).
3. Why audio submission uses Supabase Storage (not Bunny CDN).
4. Why `review_horizon` was added 2026-05-05 (murajaah scheduler bridge).
5. Why immutability of graded rows is comment-only (and the consequences).

## Phase 1 — Design Artefacts (this PR)

- [data-model.md](./data-model.md) — `homework_assignments` schema, FKs, indexes, RLS, audio bucket layout.
- [contracts/](./contracts/) — server-action signatures for all 6 actions.

## Phase 2 — Tasks (generated next)

`/speckit.tasks` will emit `tasks.md`. Documentation-completeness + ship-the-PR + file-followups; no source code changes in this PR.

## Complexity Tracking

| Constitution principle | Drift | Justification | Remediation owner |
|---|---|---|---|
| Principle II — Loud Failures | All 6 follow-up actions unwrapped | Documented as D-001 in spec.md; descriptive stance; Phase 2 audit batch will wrap all 6 + the 3 booking-side actions in one or two PRs | Phase 2 audit |
| Principle III — Atomic Critical Paths | Grade + auto-regen may not be one DB transaction (Supabase JS client behavior) | Filed as research item; verify or migrate to Postgres function `grade_homework_with_regen()` | Phase 2 audit |

D-002 through D-005 are downstream of D-001 (no DB trigger; comment-only immutability; no depth cap; FK ON DELETE undocumented). Each gets its own follow-up issue at end of Phase 1.
