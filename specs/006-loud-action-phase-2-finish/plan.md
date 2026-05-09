# Implementation Plan: Phase 2 No-Silent-Failures Finish

**Branch**: `006-loud-action-phase-2-finish` | **Date**: 2026-05-09 | **Spec**: [spec.md](./spec.md)
**Input**: Feature specification from `/specs/006-loud-action-phase-2-finish/spec.md`

## Summary

Wrap every remaining P0/P1 mutating server action in `loudAction` (or explicitly defer with rationale + manual audit row), extend the silent-fail tripwire to catch the `.single()` error-drop anti-pattern at commit time, add `<ActionFeedback>` to the highest-impact forms, and bring the audit doc back in sync with reality. The work directly implements Constitution Principle II (Loud Failures NON-NEGOTIABLE) — no new owner-domain, no new framework primitives, just consistent application of existing primitives across the 9 unwrapped server-action files.

## Technical Context

**Language/Version**: TypeScript 5 / Next.js 16.2.2 (App Router) / React 19
**Primary Dependencies**: `@supabase/ssr`, `@sentry/nextjs`, `zod`, `@vercel/functions` (`after()`), Husky (pre-commit hook)
**Storage**: Supabase PostgreSQL 17 — `audit_log` (envelope rows + diff rows), `student_packages`, `bookings`, `sessions`, `homework_assignments`, `teacher_profiles`, `recitation_errors`, `session_notes_history`, `course_enrollments`, `availability_exceptions`. No new tables.
**Testing**: `vitest run` (unit + component), Playwright (E2E), `silent-fail tripwire` grep (CI), `npx tsc --noEmit` (type check)
**Target Platform**: Vercel (Production + Preview deployments) — Node 24.x runtime
**Project Type**: Web application (Next.js full-stack on Vercel; one repo)
**Performance Goals**: Sentry event surface within 30 s of failure (SC-007); form-feedback render within 200 ms of action response (US3)
**Constraints**: 50k-DAU scale target — every wrap adds at most one `audit_log` insert per call (already best-effort, after-flush); no hot-path JOINs added; no new SQL functions; no migrations
**Scale/Scope**: ~14 actions wrapped + 4 deferred (with manual observability) across 9 files; ~3 forms gain `<ActionFeedback>`; 1 grep extension to `silent-fail tripwire`; 1 audit-doc regeneration; ~600–900 lines of changed code total

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

### Pre-Phase-0 evaluation

| Principle | Verdict | Justification |
|---|---|---|
| **I. Domain Ownership (NON-NEGOTIABLE)** | ✅ PASS | No new owner-domain; refactor sweep across existing 7 domains. No new canonical events, no new SQL functions, no `WEBHOOK_ROUTES` changes. |
| **II. Loud Failures (NON-NEGOTIABLE)** | ✅ PASS | This work *is* the principle. Every wrap implements `loudAction` per the existing primitive at `src/lib/actions/loud.ts` (post-PR-17 cause-aware, post-PR-20 exports `notFoundOrInfra`). Form-feedback (FR-008) and tripwire (FR-007) extend the principle's enforcement. |
| **III. Atomic Critical Paths, Best-Effort Side Effects** | ✅ PASS | No new critical paths added. PayPal `captureAndGrantPackage` already uses the existing `deduct_package_session` SQL function for atomicity; the wrap only adds observability around it. `notify` / `emitEvent` post-commit semantics preserved. |
| **IV. Auth at the Boundary** | ✅ PASS | Auth checks remain in route adapters (or `requireAdmin`/preflight helpers). No domain functions read sessions. The wrap's `preflight` parameter is a route-adapter concept, not a domain-internal one. |
| **V. Tracer-Bullet Adoption** | ✅ PASS | Brownfield documentation pattern (same as spec 005). Captures observed reality + remediation; no speculative additions. |
| **50k-user scale target (NON-NEGOTIABLE)** | ✅ PASS | Every wrap adds 1 `audit_log` row per call, flushed via `after()` (post-response). At 50k DAU × 5 admin actions/day = 250k inserts/day on `audit_log` — within Postgres write budget; existing index on `(table_name, record_id, created_at)` handles read queries. No N+1 reads added. |
| **Branch hygiene (NON-NEGOTIABLE)** | ✅ PASS | Single branch `006-loud-action-phase-2-finish` for the entire spec. Commits land sequentially (spec → wraps → tripwire → audit-doc). PR opens with `Closes` linking the merged branches. No `v2` branches. No remote WIP without same-day PR. |
| **Bilingual UX** | ✅ PASS | Every `UserError` carries an Arabic message; English fallbacks not required (per existing audit doc convention). Friendly Arabic messages preserved verbatim from existing actions. |
| **Database migration discipline** | ✅ PASS | No migrations needed — wraps are pure TypeScript; existing `audit_log` + Supabase tables are unchanged. |
| **Secrets and environment variables** | ✅ PASS | No new env vars. Existing PayPal/Sentry/Telegram keys are referenced via the same `process.env.*` paths. |

**Constitution gate verdict: PASS** with no documented violations. No `Complexity Tracking` entries needed.

### Re-check after Phase 1 (post-design)

Re-checked after `data-model.md` and `contracts/` are written. Same verdict expected because the design follows existing PR 7–20 patterns 1:1.

## Project Structure

### Documentation (this feature)

```text
specs/006-loud-action-phase-2-finish/
├── plan.md              # This file
├── research.md          # Phase 0 output — wrap-shape decisions per file
├── data-model.md        # Phase 1 output — audit_log envelope shape, severity tier table
├── quickstart.md        # Phase 1 output — "how to wrap a new action" runbook
├── contracts/
│   ├── wrap-contract.md         # The loudAction wrap shape (one per action category)
│   ├── deferral-contract.md     # The "loud-by-hand" pattern for Output-shape mismatches
│   └── tripwire-contract.md     # The silent-fail grep extension shape
├── checklists/
│   └── requirements.md  # Already created by /speckit-specify (14/14 PASS)
└── tasks.md             # Phase 2 output — emitted by /speckit-tasks (NOT this command)
```

### Source Code (repository root)

```text
src/
├── lib/
│   └── actions/
│       ├── loud.ts                 # READ-ONLY — framework, post-PR-20 baseline
│       ├── group-session.ts        # WRAP — addStudentToSession (P1, complex)
│       ├── course-enrollments.ts   # WRAP — enrollFree (P1); defer initiateEnrollmentCheckout (P0 Stripe)
│       └── session-lesson-plan.ts  # WRAP — setLessonPlan, toggleCheckpoint, clearLessonPlan (3× P2)
├── app/
│   ├── teacher/
│   │   ├── sessions/[id]/actions.ts        # WRAP — savePostSessionNotes, markNoErrorsObserved (2× P1)
│   │   ├── students/[studentId]/actions.ts # WRAP — updateSessionNotes (P1), resolveRecitationError (P2)
│   │   └── recitations/actions.ts          # WRAP — requestFreshRecitationAction (P1)
│   ├── student/
│   │   └── sessions/
│   │       ├── actions.ts                  # WRAP — attestSessionHappened (P1)
│   │       └── [id]/actions.ts             # WRAP — submitReview, trackSessionEvent; DEFER generateSessionToken
│   └── (public)/
│       └── packages/paypal-actions.ts      # WRAP — createPackageOrder, captureAndGrantPackage (2× P0 critical)
├── app/admin/dashboard/actions.ts          # ALREADY DEFERRED (PR pre-spec) — toggleArchiveTeacher
└── app/teacher/cv/actions.ts               # ALREADY WRAPPED (PR pre-spec) — saveCvDraft

docs/audit/no-silent-failures-2026-Q2.md    # UPDATE — mark all wraps + correct prior inaccuracies

specs/INDEX.md                              # REGENERATE via npm run specs:index

.husky/pre-commit                           # EXTEND tripwire grep (or whichever script the hook runs)

src/components/                             # ADD <ActionFeedback> to ~3 highest-impact form callers
```

**Structure Decision**: Single Next.js project (per `Project Type: web-service`). No new directories, no separation of concerns shifts. Wraps stay in their existing files; per-file `UserError` classes remain (duck-typed by framework). The route adapter / domain layer split is preserved per ADR-0002 + ADR-0004.

## Phase 0 — Research

See [research.md](./research.md) — generated next.

Open questions to resolve:
- **Q1**: For each of the 9 files, what's the canonical preflight shape — `requireAdmin()`, `auth.getUser()`, or a domain-specific helper? *(Already answered by reading each file pre-spec; documented in research.md.)*
- **Q2**: Which forms get `<ActionFeedback>` in this PR vs deferred to a follow-up sweep? *(Resolved: top 3 highest-traffic forms per audit doc §6.)*
- **Q3**: What's the exact tripwire grep pattern? *(Resolved: `\{\s*data:\s*\w+\s*\}\s*=\s*await\s+supabase\..+\.single` — minor escapes for shell.)*
- **Q4**: For `generateSessionToken` and `toggleArchiveTeacher`, defer or pack-into-`message`? *(Resolved: defer — pre-existing audit_log added.)*
- **Q5**: PayPal `captureAndGrantPackage` — what's the failure recovery if the SQL `deduct_package_session` RPC fails AFTER the PayPal capture succeeds? *(Existing behaviour preserved: payment is captured, package row remains in `pending_grant` state, admin reconciles via `/admin/credits`. Wrap only adds observability — does not change the recovery flow.)*

All Q1–Q5 resolved by reading the existing files; no `[NEEDS CLARIFICATION]` blockers remain.

## Phase 1 — Design Artefacts

See:
- [data-model.md](./data-model.md) — `audit_log` row shape + `severity` tier table + per-file action manifest
- [contracts/](./contracts/) — wrap contract, deferral contract, tripwire contract
- [quickstart.md](./quickstart.md) — runbook for wrapping a new action

### Agent context update

After Phase 1 artefacts land, update the `<!-- SPECKIT START -->` block in `CLAUDE.md` to point to this plan file. The existing block (if present) gets its plan reference replaced; otherwise insert a new block.

## Complexity Tracking

> Filled ONLY if Constitution Check has violations.

**No constitution violations.** No entries.

## Sequencing Notes

The implementation order matters for the merge:

1. **Push branch + open draft PR first** (T003a) — Constitution § "Branch hygiene" CRITICAL flag #2 requires this as the 1st-or-2nd Phase-1 task. Subsequent commits land on the draft PR; no remote WIP without same-day PR.
2. **Tripwire second** — extend the grep so the rest of the wrap commits can be validated against it as they go. (Without this, no enforcement during the wrap series.)
3. **Wraps in priority order** — P0 money (PayPal) last, after the routine wraps prove the pattern. P1 lifecycle wraps middle. P2 wraps last (lowest impact).
4. **Form-feedback** — after wraps land. Forms can only render `<ActionFeedback>` if the wrapped action returns the canonical `LoudResult` shape. Wraps establish that shape.
5. **Audit-doc regen** — after all wraps + tripwire + form-feedback land, so the doc reflects the final state.
6. **`specs/INDEX.md` regen** — last, single command (`npm run specs:index`).

This sequence runs as a single coherent commit chain on branch `006-loud-action-phase-2-finish`. The PR squash-merges the chain into one commit on `main`.

## Risk register

| Risk | Likelihood | Mitigation |
|---|---|---|
| PayPal wrap regresses double-write semantics | Medium | Wrap preserves the existing call order verbatim; only adds `loudAction` shell + `cause`-attached errors. Test with a PayPal sandbox capture. |
| Reviewer agents flag new bugs (Wave 3) | Medium | Anti-drift checklist applied per wrap; `notFoundOrInfra` already in `loud.ts`; `cause`-aware UserError already convention. Fix in-PR before merge (matches PR 16/17/18 shape). |
| Tripwire false positives on legitimate `.single()` patterns | Low | Existing wrapped code uses `notFoundOrInfra(err, ...)` after the destructure — the grep allowlists this shape. Test by grepping current main; expected zero positives in `loud.ts`-using files. |
| Audit-doc adjacent-row merge conflicts during the sweep | Low | Single branch, single PR — no concurrent audit-doc edits possible. |
| Spec scope creep (full form-feedback sweep) | Medium | FR-008 explicitly bounds to "highest-impact" — top 3 forms only. Full sweep deferred. |

## Constitution re-check (placeholder for post-design)

*Will be filled after Phase 1 artefacts land. Expected verdict: PASS (no design changes that touch the constitution principles).*

---

**Status**: Phase 0 (research) and Phase 1 (design artefacts) ready to be generated next.
