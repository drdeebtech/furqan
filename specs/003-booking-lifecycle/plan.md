# Implementation Plan: Booking Lifecycle (دورة حياة الحجز)

**Branch**: `003-booking-lifecycle` | **Date**: 2026-05-08 | **Spec**: [spec.md](./spec.md)
**Input**: Feature specification from `/specs/003-booking-lifecycle/spec.md` (brownfield documentation; no clarify pass needed — the feature has been in production since V1)
**Constitution**: `.specify/memory/constitution.md` v1.2.0
**Tracking issue**: #225

## Summary

This is a **brownfield documentation plan**. The booking lifecycle has been in production since FURQAN's V1 build. Phase 0–2 of this plan are documentation phases, not build phases — they retroactively capture the already-shipped architecture in spec-kit format so the booking domain is governed by `.specify/memory/constitution.md` and findable from `specs/INDEX.md`. No new code, no new migrations, no new n8n workflows.

The plan exists in this folder because the operator chose option (a) on the brownfield→spec-kit structural question: produce the full artefact set (`plan.md`, `tasks.md`, `research.md`, `data-model.md`, `contracts/`) per lifecycle so `/speckit.analyze` can run cross-artefact and so future feature work that depends on the booking domain has the same shape of reference as a greenfield spec.

Sized for the **50,000-user Scale Target Rule**: the existing booking implementation already runs at production load and the FRs in `spec.md` formalise its behaviour at 50k DAU (SC-005). No retrofit work is in scope here — known scale gaps are filed as separate Phase-2-audit and Phase-3-modes issues.

## Technical Context

**Language/Version**: TypeScript 5 + Next.js 16.2.2 (App Router, Turbopack), React 19, PostgreSQL 17 (via Supabase)
**Primary Dependencies**: `@supabase/ssr` (server actions), Daily.co API (room creation), n8n on Mac mini (no-show + reminder workflows), `notify()` / `dispatchNotification()` (in-app + email channels)
**Storage**: PostgreSQL 17 — `bookings` table (canonical state), `sessions` (run-time artifact), `teacher_availability` + `availability_exceptions` (slot source), `student_packages` (balance source), `audit_log` (mutation trail)
**Testing**: Playwright (E2E booking flow), Vitest (server-action unit tests), `validate_booking_status` SQL trigger (DB-level enforcement that catches anything bypassing TS pre-checks)
**Target Platform**: Vercel Pro (web) + Supabase (DB) + n8n on Mac mini (no-show detection, reminders) + Daily.co (video rooms)
**Project Type**: Existing Next.js web application; the booking domain spans `src/app/student/bookings/`, `src/app/teacher/dashboard/`, `src/app/admin/bookings/`, with future consolidation into `src/lib/domains/booking/` per ADR-0002.
**Performance Goals**: P95 booking-action latency ≤800ms at 50k DAU (SC-005); confirm path ≤30s including Daily.co round-trip (SC-001); zero double-bookings reaching `confirmed` (SC-002).
**Constraints**: NON-NEGOTIABLE — `validate_booking_status` trigger is the source of truth for allowed transitions; atomic confirm path (booking + sessions + Daily.co room) cannot regress; package-deduction idempotency must hold at terminal `completed` (SC-003).
**Scale/Scope**: 50,000 users; ~5 booking rows/student/month avg → ~250k bookings/month; ~5 hot-path reads per dashboard render × 5 hits/day × 50k DAU = ~1.25M reads/day; nightly no-show detector evaluates yesterday's confirmed bookings (~8k/night).

## Constitution Check

*GATE: Must pass before Phase 0 documentation. Re-checked after Phase 1 design. Brownfield-stance check: each principle's verdict reflects what production CURRENTLY does; documented divergences are listed under spec.md "Known divergences" and remediated in later phases (Phase 2 audit), not in this PR.*

### Principle I — Domain Ownership ✅

- **Owner-domain**: Booking. Owns `bookings.status` (source of truth), the `validate_booking_status` trigger, and the canonical `booking.created` / `booking.confirmed` / `booking.cancelled` / `booking.no_show` events.
- **Cross-domain choreography**: confirm path fans out to Session (creates `sessions` row), Communication (notify teacher), Automation (`booking.confirmed` event → n8n). Per ADR-0004, this lives in `src/lib/domains/booking/orchestrate.ts` (target state); current code inlines the choreography in route adapters (D-001-adjacent drift, not blocking this documentation PR).
- **No new owner-domain introduced.** ✅

### Principle II — Loud Failures ⚠️ (DOCUMENTED DRIFT)

- **Target state codified by FR-008**: every `bookings`-mutating server action wraps via `loudAction`.
- **Current production state**: `markNoShow` ✓, `endSession` ✓, `extendSessionRoom` ✓, `saveQuickNotes` ✓ — these are already wrapped (verified in `src/app/teacher/dashboard/actions.ts`).
- `createBooking` ✗, `updateBookingStatus` ✗, `recreateRoom` ✗ — NOT wrapped (D-001 in spec.md).
- **Decision**: this PR documents the target state in FR-008 and the production gap in D-001. Remediation is Phase 2 (audit) of the broader plan, not this PR. Per the descriptive-stance choice, the spec captures intent; remediation is a separate concern. ⚠️ Documented, not concealed.

### Principle III — Atomic Critical Paths, Best-Effort Side Effects ✅

- **Atomic critical path**: booking-confirm = `bookings.update(status='confirmed')` + `sessions.upsert(room_url, ...)` + Daily.co `createRoom()`. Constitution Principle III names `confirm_booking_with_session(...)` as a target SQL function (status: see research.md §"Confirm path atomicity" for current state — Postgres function exists in some migrations but not all confirm code paths route through it).
- **Best-effort side effects**: `notify(...)` (teacher), `emitEvent("booking.confirmed")` (n8n), `audit_log` insert. All run post-commit; failures piped through `logError` per Principle II.
- Daily.co `createRoom` runs **before** the SQL function so a Daily.co outage leaves zero DB writes. ✅

### Principle IV — Auth at the Boundary ✅

- Route adapters call `requireRole(...)` — `requireRole("student")` for `createBooking`, `requireRole("teacher")` for confirm/no-show/endSession, `requireRole("admin")` for cancel-confirmed and `recreateRoom`.
- `UnauthenticatedError` / `ForbiddenError` are distinct error classes per `src/lib/auth/require-admin.ts`.
- Domain functions in `src/app/{student,teacher,admin}/...` action files receive already-authenticated input. ✅
- spec.md Assumptions explicitly states this. ✅

### Principle V — Tracer-Bullet Adoption ✅

- This is a brownfield-documentation pilot, not an architectural shift. Per Principle V, retrofitting an already-shipped feature into spec-kit format is permissible documentation work; the `001-murajaah-scheduler/spec.md` v0→v1 framing was the closest precedent (different in shape — it documented a partial v0 then designed v1).
- Three lifecycles in Phase 1 (booking, follow-up, package); booking is first to set the brownfield-spec template. ✅

### Additional Constraint — 50,000-user Scale Target (NON-NEGOTIABLE) ✅

Checked against the seven CRITICAL flags in constitution v1.2.0:

- **No new column updated per page render** — none introduced. ✅
- **No admin action that performs unbounded UPDATE** — none introduced; existing admin booking actions operate on single rows by `id`. ✅
- **No hot-path JOIN added solely for analytics** — none introduced. The teacher-dashboard hot-path query (`bookings + sessions + students + teacher_availability`) is unchanged by this PR. ✅
- **No returning-user backlog UX** — none introduced. ✅
- **Cron sizing** — no new cron. Existing `no-show-detector` edge function evaluates yesterday's confirmed bookings (~8k/night at 50k DAU); already production-validated. ✅
- **No sub-daily Vercel cron** — n/a; existing no-show detector runs as Supabase edge function on a Daily.co webhook trigger, not Vercel cron. ✅
- **RLS predicates considered against 10M-row table** — `bookings` is partitioned-by-time, so RLS predicates against `student_id` / `teacher_id` / `is_admin()` retain index selectivity. `200506054344_sessions_rls_via_participants_v2.sql` is the latest revision; no change in this PR. ✅

### Additional Constraint — Branch Hygiene (NON-NEGOTIABLE) ✅

- Branch `003-booking-lifecycle` is fresh from main (verified at `git checkout main && git pull --ff-only && git checkout -b 003-booking-lifecycle`). ✅
- Tracking issue #225 exists; PR will reference `Closes #225`. ✅
- Same-day push and PR (per the plan in `/Users/drdeeb/.claude/plans/act-as-a-senior-starry-lerdorf.md`). ✅
- No `v2` of an existing stale branch. ✅
- Pre-work checks performed: `gh issue view`, `gh pr list`, repo state confirmed clean of prior booking-lifecycle work. ✅

**Result**: Constitution gate PASSES with one DOCUMENTED DRIFT (Principle II / FR-008 / D-001), explicitly captured and routed to Phase 2.

## Project Structure

### Documentation (this feature)

```text
specs/003-booking-lifecycle/
├── spec.md              # Feature spec (brownfield)
├── plan.md              # This document
├── research.md          # Design-decision log (already-made decisions)
├── data-model.md        # Schema reference
├── tasks.md             # Generated by /speckit.tasks (no implementation tasks; documentation tasks only)
└── contracts/
    ├── createBooking.md
    ├── updateBookingStatus.md
    ├── endSession.md
    ├── markNoShow.md
    └── recreateRoom.md
```

### Source code (existing — read-only references for this PR)

```text
src/app/student/bookings/new/actions.ts        # createBooking()
src/app/teacher/dashboard/actions.ts           # updateBookingStatus, markNoShow, endSession, recreateRoom, startInstantSession
src/app/admin/bookings/                        # admin booking management
supabase/migrations/                           # validate_booking_status trigger, RLS policies
supabase/functions/no-show-detector/index.ts   # automation path → no_show
src/lib/automation/emit.ts                     # emitEvent() for booking.* events
src/lib/notifications/dispatcher.ts            # notify() for teacher/student/parent
```

## Phase 0 — Research (already complete)

See [research.md](./research.md). Captures the four load-bearing decisions that produced the current shipped state:

1. Why `validate_booking_status` is a DB trigger and not just TS pre-checks.
2. Why no-show detection is an edge function (not a Vercel cron).
3. Why Daily.co room creation runs *before* the SQL function (not after).
4. Why `cancel_reason` is freeform and not enum-constrained (D-002).

## Phase 1 — Design Artefacts (this PR)

- [data-model.md](./data-model.md) — `bookings` schema, related tables, RLS policies, indexes.
- [contracts/](./contracts/) — server-action signatures: `createBooking`, `updateBookingStatus`, `endSession`, `markNoShow`, `recreateRoom`. Each contract documents input shape, output shape, side effects (notify, emit, audit), and which `loudAction` wrap state it's currently in.

## Phase 2 — Tasks (generated next)

`/speckit.tasks` will emit `tasks.md`. For a brownfield documentation spec, the tasks are documentation-completeness tasks (verify each FR maps to an existing code path; verify each contract matches actual function signature; verify cross-references to PB-XX are accurate), not implementation tasks. No code changes are produced by this Phase 1 PR.

## Complexity Tracking

| Constitution principle | Drift | Justification | Remediation owner |
|---|---|---|---|
| Principle II — Loud Failures | `createBooking`, `updateBookingStatus`, `recreateRoom` not yet `loudAction`-wrapped | Documented as D-001 in spec.md and FR-008 codifies target state. Spec is descriptive of production; remediation routes to Phase 2 (audit). | Phase 2 audit PR series |

No other principles flag drift. The remaining principles + constraints all PASS.
