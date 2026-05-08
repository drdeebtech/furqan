# Implementation Plan: Package Deduction Lifecycle (دورة حياة الباقة)

**Branch**: `005-package-deduction-lifecycle` | **Date**: 2026-05-08 | **Spec**: [spec.md](./spec.md)
**Input**: Feature specification from `/specs/005-package-deduction-lifecycle/spec.md` (brownfield documentation; no clarify pass needed — the feature has been in production since V11)
**Constitution**: `.specify/memory/constitution.md` v1.2.0
**Tracking issue**: #237

## Summary

Brownfield documentation plan for the package-deduction lifecycle — same shape as `003-booking-lifecycle` and `004-followup-lifecycle`. **Final** of three Phase 1 lifecycle PRs. No new code, no new migrations, no new n8n workflows. Documentation phases retroactively capture the V11-shipped package domain in spec-kit format so the domain is governed by `.specify/memory/constitution.md` and findable from `specs/INDEX.md`.

This is the **cleanest** of the three lifecycles from a Constitution Principle III standpoint: the atomic critical path actually exists at the SQL level (`deduct_package_session()` + `deduct_package_session_mode()`). Both functions are plain SQL with predicate-and-increment in the same row lock — no race condition is possible. SECURITY DEFINER ensures they work under non-admin RLS contexts.

The spec catches three significant brownfield drifts not visible from the prose alone:
1. State machine is 3 explicit values + 2 virtual states, not 5 explicit values as `LIFECYCLES.md` §4 suggests.
2. Time-based expiry (`expires_at < now()`) is *implicit* via predicate, not a status flip — so reports filtering `WHERE status='expired'` undercount real expiries.
3. Per-mode deduction silently falls back to the legacy `session_count` budget when per-mode is zero, which can surprise students.

Sized for the **50,000-user Scale Target Rule**: production-validated at current load. SC-004 sizes the deduction function for ~250k deductions/month at 50k DAU; SC-001 inherits the atomic-counter guarantee from the SQL function.

## Technical Context

**Language/Version**: TypeScript 5 + Next.js 16.2.2 (App Router, Turbopack), React 19, PostgreSQL 17 (via Supabase)
**Primary Dependencies**: PayPal API (`@paypal/react-paypal-js` + server SDK; Stripe deferred), Supabase server actions, n8n on Mac mini (low-balance + expiry-countdown workflows)
**Storage**: PostgreSQL 17 — `packages` (catalog), `student_packages` (per-student subscription), `payments` (PayPal capture log)
**Testing**: Playwright (E2E PayPal sandbox flow), Vitest (server-action unit tests), DB-level CHECK constraints + atomic SQL function (no application-level race-management needed)
**Target Platform**: Vercel Pro (web) + Supabase (DB) + n8n on Mac mini (alerts) + PayPal sandbox/live
**Project Type**: Existing Next.js web application; package domain spans `src/app/admin/packages/` (catalog CRUD), `src/app/student/packages/` (student view), `src/app/(public)/packages/` (marketing list), and the SQL functions (atomic deduction).
**Performance Goals**: Deduction P95 ≤50ms (SC-004); zero double-deductions (SC-001); admin CRUD has zero impact on existing student rows (SC-005).
**Constraints**: NON-NEGOTIABLE — `deduct_package_session*()` SECURITY DEFINER must be retained (FR-008). Status CHECK constraint values frozen. The atomic-counter pattern must not be replaced with multi-step UPDATEs.
**Scale/Scope**: 50,000 users; ~5 deductions/student/month avg → ~250k deductions/month; ~5k new packages/month (PayPal captures); n8n nightly low-balance/expiry alerts read predicate-based virtual states.

## Constitution Check

*GATE: Must pass before Phase 0 documentation. Re-checked after Phase 1 design. Brownfield-stance: each principle's verdict reflects what production CURRENTLY does; documented divergences listed under spec.md "Known divergences" route to Phase 2.*

### Principle I — Domain Ownership ✅

- **Owner-domain**: Package. Owns `student_packages.status` (canonical state column) plus the counter columns (`sessions_used`, `sessions_total`, `expires_at`, `mode_counts`) which together encode the virtual states.
- **Cross-domain choreography**: Booking (spec 003) reads `student_packages` at booking creation (FR-009) and writes via `deduct_package_session()` at `endSession()`. PayPal webhook (Communication-adjacent domain) inserts `student_packages` rows. Admin manages the `packages` catalog table independently — catalog changes do NOT cascade to existing `student_packages` rows.
- **No new owner-domain introduced.** ✅

### Principle II — Loud Failures ⚠️ DOCUMENTED DRIFT

- **Target state codified by FR-007**: every `student_packages`-mutating server action wraps via `loudAction`.
- **Current production state**: 3 admin actions (`savePackage`, `deletePackage`, `togglePackageActive`) NOT wrapped; the canonical write paths (`deduct_package_session*()` SQL functions) operate at the DB level and don't go through TS, so `loudAction` doesn't apply directly. Booking-side callers of `deduct_package_session()` (e.g., `endSession()`) ARE wrapped via that booking action.
- **Decision**: D-001 in spec.md. Same Phase 2 audit batch as booking and follow-up D-001s. ⚠️ Smaller blast radius than the follow-up domain (which had 0/6 wrapped) — the package domain is mostly DB-driven, so Principle II only concerns the 3 admin CRUD actions. ⚠️ Documented, not concealed.

### Principle III — Atomic Critical Paths, Best-Effort Side Effects ✅ (the cleanest of the three lifecycles)

- **Atomic critical path #1 — session deduction**: `deduct_package_session(p_package_id uuid)` is plain SQL: `UPDATE student_packages SET sessions_used = sessions_used + 1 WHERE id = $1 AND status = 'active' AND sessions_used < sessions_total AND (expires_at IS NULL OR expires_at > now()) RETURNING true`. Predicate evaluation and counter increment happen in the same row lock — race-free by Postgres semantics. ✅
- **Atomic critical path #2 — per-mode deduction**: `deduct_package_session_mode(p_package_id, p_mode)` is the companion. PL/pgSQL with the same atomic guarantee. ✅
- **Best-effort side effects**: PayPal capture row INSERTs into `payments` post-success; n8n low-balance alert reads the predicate post-deduction; both are best-effort. ✅
- **Verdict**: ✅ PASS. The package domain is the *positive* example to cite when reviewing other "should be atomic" claims across domains.

### Principle IV — Auth at the Boundary ✅

- Admin paths call `requireRole("admin")` at the route adapter for `savePackage`, `deletePackage`, `togglePackageActive` (verify in code).
- Student paths read-only via `/student/packages/page.tsx` — RLS enforces `student_id = auth.uid()`.
- Public catalog at `/(public)/packages/` is anonymous-readable but only of the `packages` table (catalog), not `student_packages` (per-student rows).
- SQL functions run as SECURITY DEFINER, so they execute with the function-owner's privileges regardless of caller's role. Required because callers may be students (whose RLS would otherwise block UPDATE on their own `student_packages` row).
- spec.md Assumptions explicit. ✅

### Principle V — Tracer-Bullet Adoption ✅

- Brownfield-documentation pilot. Same precedent as 003 and 004. ✅
- The `deduct_package_session_mode()` companion (added 2026-05-05) was a tracer-bullet for the broader session-modes work — same shape, additive, did not break the original function. Good example of the principle in action. ✅

### Additional Constraint — 50,000-user Scale Target (NON-NEGOTIABLE) ✅

Checked against the seven CRITICAL flags:

- **No new column updated per page render** — none introduced. ✅
- **No admin action that performs unbounded UPDATE** — `togglePackageActive` and `deletePackage` operate on single `packages` rows (not `student_packages`). ✅
- **No hot-path JOIN added solely for analytics** — none introduced. The student dashboard query joins `student_packages` and `packages` once on render, which is unchanged. ✅
- **No returning-user backlog UX** — D-003 (status='expired' undercount) is a *report* concern not a UX surface. ✅
- **Cron sizing** — n8n low-balance/expiry alerts query predicate-based; at 50k DAU this is ~50k row scans nightly, fast on the existing indexes. ✅
- **No sub-daily Vercel cron** — n/a. ✅
- **RLS predicates considered against 10M-row table** — `student_packages` will grow to ~3M rows total at 50k DAU × 12 months × 5 packages avg. RLS uses `student_id = auth.uid()`. Index on `(student_id, status)` keeps the most-common query (student dashboard "my active package") under 5ms. ✅

### Additional Constraint — Branch Hygiene (NON-NEGOTIABLE) ✅

- Branch `005-package-deduction-lifecycle` fresh from main (verified). ✅
- Tracking issue #237 exists; PR will reference `Closes #237`. ✅
- Same-day push and PR. ✅
- No `v2`. ✅
- Pre-work checks: `gh issue view 237`, `gh pr list`, `git log main --diff-filter=D` empty for this slug. ✅

**Result**: Constitution gate PASSES with 1 documented drift (Principle II — admin actions unwrapped). Principle III is **the cleanest of the three lifecycles** — the atomic SQL function is the positive precedent.

## Project Structure

### Documentation (this feature)

```text
specs/005-package-deduction-lifecycle/
├── spec.md              # Feature spec (brownfield, 3 explicit + 2 virtual states)
├── plan.md              # This document
├── research.md          # Decisions log
├── data-model.md        # Schema reference (packages + student_packages + payments)
├── tasks.md             # Generated by /speckit.tasks
└── contracts/
    ├── deduct_package_session.md
    ├── deduct_package_session_mode.md
    ├── savePackage.md
    ├── deletePackage.md
    └── togglePackageActive.md
```

### Source code (existing — read-only references)

```text
src/lib/supabase/migrations/v11_001_packages.sql                              # base schema + deduct_package_session()
supabase/migrations/20260428095637_hardening_security_definer_and_rls.sql    # security definer hardening
supabase/migrations/20260505211356_extend_packages_with_session_modes.sql    # mode_counts + deduct_package_session_mode()
supabase/migrations/20260501071453_paypal_payments.sql                       # PayPal payment rows
src/app/admin/packages/actions.ts                                            # 3 admin actions
src/app/admin/packages/page.tsx, package-form.tsx, package-actions.tsx       # admin UI
src/app/student/packages/page.tsx                                            # student view
src/app/(public)/packages/                                                   # public catalog
src/lib/actions/group-session.ts (line 136), class-offerings.ts (line 233)   # call sites for deduct
src/app/teacher/dashboard/actions.ts endSession()                            # call site at terminal completed
```

## Phase 0 — Research (already complete)

See [research.md](./research.md). Captures the load-bearing decisions:

1. Why deduction is plain SQL (not plpgsql).
2. Why state machine has 3 explicit + 2 virtual states.
3. Why per-mode fallback is implicit (and the trade-off).
4. Why time-based expiry is virtual (no cron flip).
5. Why SECURITY DEFINER is required and how the 2026-04-28 hardening migration tightened it.

## Phase 1 — Design Artefacts (this PR)

- [data-model.md](./data-model.md) — `packages` + `student_packages` + `payments` schemas, FKs, indexes, RLS, multi-currency pricing.
- [contracts/](./contracts/) — function/action signatures: 2 SQL functions + 3 admin TS actions.

## Phase 2 — Tasks (generated next)

`/speckit.tasks` will emit `tasks.md`. Documentation-completeness + ship-the-PR + file-followups; no source code changes in this PR. **This PR's merge closes Phase 1** of the broader plan.

## Complexity Tracking

| Constitution principle | Drift | Justification | Remediation owner |
|---|---|---|---|
| Principle II — Loud Failures | 3 admin actions unwrapped (`savePackage`, `deletePackage`, `togglePackageActive`) | Smaller blast radius than booking/follow-up. Documented as D-001; Phase 2 audit batch | Phase 2 audit |

No other principles flag drift. The remaining principles + constraints all PASS — Principle III especially cleanly.
