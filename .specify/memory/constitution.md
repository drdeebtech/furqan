# FURQAN Constitution

This constitution captures the rules that govern how FURQAN code is written, reviewed, and shipped. It is *not* a wish list — every principle below already exists as an enforced rule somewhere in the repo (CLAUDE.md, CONTEXT.md, or one of the ADRs in `docs/adr/`). The constitution makes these rules cite-able from `/speckit.plan` and `/speckit.analyze` runs and from PR reviews.

When `/speckit.plan` checks a feature plan, it checks against the five principles below. Violations block `tasks.md` generation until the plan justifies the deviation in writing or removes it.

---

## Core Principles

### I. Domain Ownership (NON-NEGOTIABLE)

The platform has seven owner-domains: **Booking, Session, Follow-up, Progress, Package, Communication, Automation**. Each owns specific source-of-truth tables and emits a fixed set of canonical events (the keys of `WEBHOOK_ROUTES` in `src/lib/automation/emit.ts`, exported as the type `FurqanEvent`).

- Domain writes consolidate into `src/lib/domains/<domain>/`. Reads may stay where they are during pilots (per ADR-0002).
- Cross-domain choreography (e.g. booking-confirm fanning out to a Daily room, atomic `bookings`+`sessions` write, parent notify, n8n event) lives in **use-case orchestrators** at `src/lib/domains/<originating-domain>/orchestrate.ts`. Route adapters call the orchestrator; they never inline the choreography (per ADR-0004).
- A new owner-domain is a constitutional event: it requires a `specs/<feature>/spec.md`, an ADR amending this section, and an update to `CONTEXT.md`'s "Domains" list.

**Sources:** `CONTEXT.md` "Domains", `CLAUDE.md` "Domain Ownership Model", ADR-0002, ADR-0004.

### II. Loud Failures (NON-NEGOTIABLE)

Every server action that mutates the database or has side effects must be loud: the user sees the outcome, the operator sees the error, and the audit trail records the attempt.

- All such actions wrap their handler in `loudAction` from `src/lib/actions/loud.ts`. Forms consuming those actions render `<ActionFeedback state={...} />` from `src/components/shared/action-feedback.tsx`.
- Discarded errors, empty `catch {}`, and `?? []` / `?? null` immediately after a Supabase call are PR-blocking. The silent-fail tripwire grep is in CI.
- Best-effort writes (`audit_log`, `automation_logs`, post-commit `notify`/`emitEvent`) are non-blocking but must pipe failures through `logError`. They are visible in Sentry; they never `console.error` and stop.

**Source:** `CLAUDE.md` "No Silent Failures Policy".

### III. Atomic Critical Paths, Best-Effort Side Effects

A critical path is a set of writes that the platform must commit together or not at all. A side effect is everything else (notify, emit, log).

- Multi-table critical paths use Postgres functions with `BEGIN`/`COMMIT` semantics: `deduct_package_session(uuid)`, `confirm_booking_with_session(...)`. Adding a new critical path means adding a new SQL function in `supabase/migrations/<timestamp>_*.sql`, not chaining Supabase client calls in a server action.
- External calls that must succeed before any DB write (e.g. Daily.co `createRoom`) run before the SQL function. A failed external call leaves zero DB writes.
- `notify(...)` and `emitEvent(...)` run **post-commit** and never throw to the caller. An n8n outage does not roll back domain truth; an email-provider outage does not invalidate a confirmed booking.

**Source:** ADR-0004 §"Failure semantics", `CLAUDE.md` "SQL Functions".

### IV. Auth at the Boundary

Authentication and authorization happen at the route adapter, not inside domain functions.

- Route adapters call `requireRole(...)` (or its sugar wrappers `requireAdmin`, `requireRole([role1, role2])`) and parse FormData. Domain functions receive already-authenticated structured input.
- `UnauthenticatedError` (no/invalid session → 401 or `/login` redirect) and `ForbiddenError` (valid session, wrong role → 403 or no-permission view) are distinct error classes. Server actions and API handlers branch on the class, not on message text.
- Domain functions never read sessions or cookies. They never perform their own auth check beyond what they receive in their input.

**Sources:** `CONTEXT.md` "Authentication vs Authorization", `src/lib/auth/require-admin.ts`.

### V. Tracer-Bullet Adoption

Architectural shifts ship as one feature pilot first, then generalize.

- Every existing ADR is a single-pilot decision: ADR-0001 (`requireRole` wrap pattern, one helper), ADR-0002 (Booking writes pilot, one domain), ADR-0003 (drop moderator role, one role removal), ADR-0004 (booking-confirm orchestrator, one transition). The pilot proves the pattern before it spreads.
- **Net-new features** — new owner-domain, new role surface, multi-PR scope, P0/P1 ROADMAP items, or any feature whose ambiguity needs flushing — go through spec-kit: `specs/<feature>/spec.md` → `plan.md` → `tasks.md` → implement.
- **Emergent decisions** — refactors of existing code, mid-implementation pivots, hotfixes, single-PR fixes — do not require a spec. They get an ADR if the decision generalizes.
- A `spec.md` may cite ADRs it depends on; an ADR may cite the spec it implements. Both can coexist for one feature without duplication.

**Sources:** this constitution, `docs/adr/`, CLAUDE.md "Spec-Kit Workflow".

---

## Additional Constraints

### Bilingual UX (FURQAN domain rule)

All user-facing text is Arabic. The follow-up domain is named "follow-up" / "متابعة" in every interface, never "homework" / "واجب" — even though the underlying database column is `homework_assignments` for historical reasons (the column rename is not worth the blast radius; see ADR-0001 reasoning style).

### Database migration discipline

The Supabase Branching GitHub integration silently skips applies more than once a month. The `.github/workflows/supabase-migrate.yml` workflow is the source of truth for production schema. New migrations use `./scripts/new-migration.sh <name>` and land at `supabase/migrations/<UTC timestamp>_*.sql`. The legacy `src/lib/supabase/migrations/v*.sql` files stay where they are; they are already applied to production via the project's own `public.schema_migrations` tracker.

### Secrets and environment variables

`process.env.X` references and the `CLAUDE.md` env-var table are paired. A PR that adds a new `process.env.X` must add `X` to the table in the same PR. Vercel marketplace integrations can override env vars at build time without showing in `vercel env ls` — when an env var disappears from runtime, suspect a marketplace integration first.

---

## Development Workflow

### Pre-implementation

1. Read the relevant ADRs and `CONTEXT.md` glossary.
2. If the work is net-new (Principle V), run `/speckit.specify` → `/speckit.clarify` → `/speckit.plan` → `/speckit.tasks` before any production code edit.
3. If the work is emergent or a refactor, write the ADR draft alongside the code change, in the same PR.
4. Run `gitnexus_impact({target: "<symbol>"})` before editing any non-trivial function (per `AGENTS.md`).

### Implementation

1. Tests first (red-green-refactor). 80% coverage minimum on new code.
2. Domain logic in `src/lib/domains/<domain>/`; route adapters in `src/app/{role}/{feature}/actions.ts`; orchestrators in `src/lib/domains/<originating-domain>/orchestrate.ts`.
3. All mutating server actions wrapped in `loudAction`; all forms render `<ActionFeedback>`.
4. Atomic critical paths via Postgres functions; side effects post-commit.

### Pre-commit

1. `npx next build` passes.
2. `git diff` shows zero `?? []` / `?? null` near Supabase calls (silent-fail tripwire).
3. `gitnexus_detect_changes()` confirms only intended scope.
4. Branch matches `git branch --show-current` echoed in the same shell as `git commit` (per the verify-branch-before-commit project rule).
5. Author identity is `drdeebtech@gmail.com` (Vercel Hobby plan blocks unrecognized authors on private repos — though FURQAN is now on Pro, the rule remains a defensive default).

### Pre-merge

1. CI green: `npx next build`, `npm run lint`, `npx playwright test`, `npx vercel ls furqan --prod`.
2. Migrations dry-run on PR: `Supabase Migrate` workflow shows expected diff.
3. For spec-kit features: `/speckit.analyze` reports zero unjustified deviations from this constitution.

---

## Governance

This constitution supersedes any ad-hoc style choice and any conflicting guidance elsewhere (CLAUDE.md style notes, individual code review preferences, agent skill defaults). When a conflict surfaces, the resolution is a PR that either updates this constitution or updates the conflicting source — not a quiet override in implementation.

**Amendments** require a PR that updates:
1. `.specify/memory/constitution.md` (this file).
2. Any cross-referenced files (CLAUDE.md, CONTEXT.md, affected ADRs, `EVENT_CATALOG.md`, `LIFECYCLES.md`).
3. Any active feature spec under `specs/` whose plan was generated against the prior version.

Version bumps follow semver on the constitution itself:
- **MAJOR** — adding/removing a Principle, or changing a NON-NEGOTIABLE marker.
- **MINOR** — adding an Additional Constraint or a Workflow step that hasn't existed before.
- **PATCH** — clarifications, source-link updates, typo fixes.

`/speckit.plan` and `/speckit.analyze` consult this file by path. `/speckit.constitution` is the canonical editor; manual edits are allowed but should round-trip through `/speckit.constitution`'s validation before merge.

**Version**: 1.0.0 | **Ratified**: 2026-05-08 | **Last Amended**: 2026-05-08
