# Project Reference — FURQAN

> Descriptive snapshot of the project (stack, roles, domain map, feature history,
> remaining work, docs index). Active rules and gotchas live in `AGENTS.md`
> (`CLAUDE.md` symlinks to it); operational deep-detail in `docs/agents/CLAUDE-reference.md`.
>
> **Last full refresh: 2026-07-22.** Volatile numbers (table counts, line counts,
> test counts) are deliberately not restated here — they rot. Count from the
> source of truth named in each section.

FURQAN Academy — online Quran-memorization platform (furqan.today).

**Current phase:** subscription + courses business model; Stripe billing live in code
(go-live owner-gated), teacher marketplace public, payouts dormant behind a cutover date.

## Stack
- **Next.js 16.2.x** (App Router, Turbopack; modified/canary build — check `node_modules/next/dist/docs/` before using an unfamiliar API) · **React 19** · **TypeScript 5 (strict)**
- **Supabase** (Postgres, Auth, RLS, Storage) · `@supabase/ssr`
- **Stripe** (subscriptions, single sessions, Connect payouts — dormant) · PayPal (recurring epic pending owner gate)
- **Daily.co** (video sessions + observer mode) · **Bunny CDN** (course video)
- **TailwindCSS 4** · full RTL/Arabic · PWA
- **n8n** (n8n.drdeeb.tech — automation layer) · **Telegram** (@furqantoday_bot)
- **Sentry** (manaracode / javascript-nextjs / de.sentry.io) · PostHog + Mixpanel (fail-soft)
- **Vercel** (furqan.today; `origin/staging` = main + Basic-auth gate on a separate Supabase ref)

## Roles (3)
Per ADR-0003 the moderator role was dropped; its surfaces are admin-owned.

- **student** — browse/subscribe, book sessions, join video, track hifz progress, follow-up, messages
- **teacher** — availability, bookings, sessions, follow-up grading, evaluations, CV workflow, marketplace profile
- **admin** — full platform management incl. n8n control, control tower, AI-output review, settings

## Domain Layer — source of truth `src/lib/domains/`

One folder per domain: achievements, attendance, billing, booking, catalog, certificates,
connect, follow-up, goals, honor-board, murajaah, notifications, package, parent-portal,
progress, reports, scheduling, session, single-sessions.

Key invariants:
- **Booking** is fail-closed on the active-package/subscription precondition (`domains/booking/actions.ts`).
- **Billing** handlers live in `domains/billing/webhook-handlers.ts` behind a thin verify+dispatch webhook shell.
- **Progress is merged, never overwritten**; `surah:ayah` ranges validate against `src/lib/quran/ayah-counts.ts` and are DB-enforced.
- **Connect payouts** (spec 040) are fully wired but dormant until `connect_cutover_date` is set.

## Data Layer
- `supabase/migrations/` — remote pg_dump baseline + timestamped migrations (never push the baseline; archive in `supabase/migrations_archive/`). Contract: `AGENTS.md` §4.
- `src/types/database.ts` — **hand-corrected** types layer (spec 026), NOT a stale duplicate of `src/types/supabase.generated.ts`. Never blind-regenerate; read only the alias section at the end.
- Regenerate after a migration: `npm run db:types` (guarded by the `db-types-fresh` CI workflow).

## Events & Automation
- Typed `FurqanEvent` names from `src/lib/automation/emit.ts` — no raw strings. Taxonomy in `EVENT_CATALOG.md`; state machines in `LIFECYCLES.md`; incident playbooks in `EXCEPTION_PLAYBOOKS.md`.
- n8n workflow registry: `AUTOMATION_REGISTRY.md` (audited by `scripts/n8n-audit.mjs`). Status as of the 2026-07 audit: healthy — most workflows green, the amber set is event-driven idle-by-design, and the dark set sits behind the `renewal_campaigns_enabled` flag.
- AI workflows (spec 028) ship flag-gated with an eval gate (`ai_output_review` + `/admin/ai-review`).

## File Structure (key paths)
```
src/app/admin/**                 Admin dashboard (incl. control-tower, n8n, ai-review, tour)
src/app/teacher/**               Teacher dashboard
src/app/student/**               Student dashboard
src/app/(public)/**, (auth)/**   Public site (marketplace, pricing, blog) & auth
src/app/api/**                   API routes (webhooks: stripe, daily, n8n)
src/lib/actions/**               Server actions (leaf files own "use server")
src/lib/domains/**               Domain/business layer (see above)
src/lib/views/**                 Per-screen dashboard read bundles (test seam)
src/lib/quran/**                 Canonical surah/ayah structure — never hand-edit scripture
src/types/database.ts            Hand-corrected DB types (spec 026)
supabase/migrations/**           Data layer
specs/**                         speckit specs / plans / tasks (INDEX.md = catalog)
docs/CODEMAPS/**                 Generated code maps (routes, domains, screens, actions)
e2e/, **/*.test.ts               Playwright + Vitest
.github/workflows/**             CI: migrate, migration-safety, fresh-apply, rls-tests,
                                 silent-fail-check, unit-tests, db-types-fresh, trufflehog, …
```

## Feature History (condensed)

**Foundation (through 2026-05):** three role dashboards, bilingual RTL/LTR + dark mode,
booking + Daily.co sessions with webhook-driven lifecycle (spec 007), follow-up state
machine, packages, notifications dispatcher, messaging, PWA, blog CMS, CV review,
n8n automation layer + control panel, control tower, loudAction no-silent-failures.

**Business pivot (2026-06):** subscription + courses model — billing foundation
(spec 018), catalog/credit redesign (019), scheduling & cohorts (020), attendance/payroll
(021), onboarding + single sessions (022), reports/gamification/notifications (023),
migration cutover (024), subscribe checkout (025). Schema reconciled to a pg_dump
baseline (spec 011); RLS hardening (012–017); database-types drift guard (026).

**Trust & marketplace (2026-06 → 07):** SEO gaps (027), AI/LLM workflows flag-gated (028),
web-push/re-engagement/certificates/realtime/achievements (029–033), admin analytics
audit (034), website trust & credibility (035), public teacher marketplace (036) +
public teacher profile (037), prepaid hour wallet + instant-session bridge (038),
Shannon audit remediation (039), Stripe Connect payouts — built, dormant (040).
Verified Uthmani ayah rendering (KFGQPC module). Hifz price-ladder fix (#755).

## Remaining Work (owner-gated unless noted)
1. **Stripe go-live** — runbook exists; only account-bound prep is the six `subscription_plans` placeholder price IDs. Run from `main`.
2. **PayPal recurring** (epic #756) — Phase 0 (#757) is a blocking owner gate that can void the epic. `/subscribe` returning 503 for PayPal is correct behavior, not a bug.
3. **Connect payouts go-live** (spec 040) — set `connect_cutover_date` + owner Stripe checklist.
4. **AI feature flags** — off until the owner enables per flag from `/admin/settings`.
5. **Refund/failed-payment policy build-out** — owner decided: refund = take back unused + cancel plan; failed payment = block bookings immediately. Separate DB-proven PRs.

## Documentation Index
| File | Purpose |
|------|---------|
| `AGENTS.md` (= `CLAUDE.md`) | Agent contract — load-bearing rules only |
| `docs/agents/CLAUDE-reference.md` | Operational deep-detail (architecture, migrations, Sentry) |
| `docs/agents/env-vars.md` | **Env vars source of truth** |
| `docs/agents/cursor-cloud.md` | Cursor Cloud bootstrap |
| `docs/agents/domain.md`, `issue-tracker.md`, `triage-labels.md` | Agent process docs |
| `.impeccable.md` | **Design context — read before any UI work** |
| `DESIGN.md` / `PRODUCT.md` | Current design & product framing |
| `CONTEXT.md` + `docs/adr/` | Domain context + decision records |
| `EVENT_CATALOG.md` / `LIFECYCLES.md` / `EXCEPTION_PLAYBOOKS.md` | Events, state machines, incident playbooks |
| `AUTOMATION_REGISTRY.md` | n8n workflow registry |
| `docs/CODEMAPS/` | Generated code maps |
| `docs/marketing-plan.md` | Marketing/pricing plan |
| `.specify/memory/constitution.md` | speckit constitution |
| `specs/INDEX.md` | Spec catalog (one folder per feature) |
