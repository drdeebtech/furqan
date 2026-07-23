# CLAUDE Reference Material

Sections moved out of `AGENTS.md` (which `CLAUDE.md` symlinks to) to reduce per-session token cost.
Consulted on demand: architecture questions, Sentry fixes, Supabase issues, migration detail.

> Last full refresh: 2026-07-22. When this file and `AGENTS.md` disagree, `AGENTS.md` wins.

---

## Key Architecture

- **Route protection**: `src/proxy.ts` — role middleware + legacy moderator redirects.
- **Domain layer**: `src/lib/domains/**` — one folder per business domain (billing, booking, session, catalog, scheduling, murajaah, progress, connect, single-sessions, …). Business logic lives here, not in route files.
- **Server actions**: `src/lib/actions/**`, re-exported through per-dashboard barrels. A barrel of server actions must **not** carry its own `"use server"` — leaf files own it (Turbopack drops the client reference otherwise; `tsc` passes, `next build` fails).
- **Dashboard reads**: `src/lib/views/{student,teacher}-dashboard.ts` (injected client = test seam). `src/lib/dashboard-queries.ts` is the legacy god module — query a symbol, never read it wholesale.
- **Billing**: `src/lib/domains/billing/**`. The Stripe webhook route is a thin verify+dispatch shell; handlers in `webhook-handlers.ts`. Raw-body verification before any DB access, fail-closed 400. Webhook payloads never carry expandable lists — re-fetch with `expand` or use payload-guaranteed fields.
- **Admin client**: `src/lib/supabase/admin.ts` — service-role, server-only.
- **Feature flags**: `src/lib/settings.ts` + `platform_settings` table.
- **Notifications**: `src/lib/notifications/dispatcher.ts` (multi-channel + quiet hours + `message_delivery_log`); parent reports in `src/lib/notifications/parent.ts`.
- **Event emission**: `src/lib/automation/emit.ts` — typed `FurqanEvent` names only, non-blocking webhooks → n8n.
- **Analytics**: PostHog (US cloud) + Mixpanel, both fail-soft and env-gated. Mixpanel event names come from `MIXPANEL_EVENTS` (`src/lib/mixpanel-server.ts` server-side, `src/lib/mixpanel-client.ts` client). Autocapture/session-recording stay OFF — students may be minors.
- **n8n integration**: REST client `src/lib/n8n/client.ts`; callback `src/app/api/webhooks/n8n/route.ts`; control panel `/admin/n8n`; registry in `AUTOMATION_REGISTRY.md` (consumed by `scripts/n8n-audit.mjs`).
- **Telegram bot**: @furqantoday_bot — alerts, failure notifications, admin digests.
- **Session lifecycle (spec 007)**: `src/app/api/webhooks/daily/route.ts` receives Daily.co `meeting.started`/`meeting.ended` with HMAC-SHA256 verification + ±15-min skew window. SQL functions `start_session_from_webhook`/`end_session_from_webhook` (SECURITY DEFINER) write session times idempotently via `daily_webhook_events`. Teacher-side `endSession` is a no-op when the webhook arrived first.
- **Widget failures**: `logError` tags every failure with `route` + `widget` — grep the tag.
- **PWA**: `public/sw.js` + install prompt.

---

## Environment Variables

All env vars declared in **`docs/agents/env-vars.md`** (variable → purpose). **Rule:** if you add `process.env.X` to code, add `X` to that table in the same PR. Verify with `npx vercel env ls`.

---

## Docs Map

Project snapshot, feature history, and full docs index: `docs/agents/project-reference.md`.
Deep references when needed: `EVENT_CATALOG.md`, `LIFECYCLES.md`, `EXCEPTION_PLAYBOOKS.md`, `AUTOMATION_REGISTRY.md`, `CONTEXT.md`, `docs/CODEMAPS/`, `.specify/memory/constitution.md`, `specs/INDEX.md`, `specs/<feature>/spec.md`.

> **Design rule:** before touching any visual surface, open `.impeccable.md` and confirm alignment with the **Premium · Refined · Authentic** personality and the four anti-references. `DESIGN.md` and `PRODUCT.md` hold the current design/product framing.

---

## Sentry ↔ Git Commit Convention

When a commit fixes a Sentry issue, include `Fixes JAVASCRIPT-NEXTJS-E4-<N>` in the commit body (or PR title/description). `Fixes`/`Resolves`/`Closes` all work. Release tagging via `withSentryConfig` in `next.config.ts`; fires once the commit lands on `main` and the next Vercel build ships. Org `manaracode`, project `javascript-nextjs`, region `de.sentry.io`.

---

## Database Migrations — Full Detail

The contract (expand/contract, no ordering gate between migration and Vercel build) lives in `AGENTS.md` §4. Detail beyond that:

- **Topology**: the oldest file in `supabase/migrations/` is a **remote pg_dump baseline** (= prod HEAD at spec 011). **Never `db push` the baseline.** Previously-applied migrations live in `supabase/migrations_archive/`. New migrations sort after the baseline.
- **CI**: `.github/workflows/supabase-migrate.yml` applies on merge to `main`; `migration-safety.yml` runs `scripts/check-migration-safety.sh` (blocks structural expand/contract breakers); `migrations-fresh-apply.yml` replays from zero — a from-zero `supabase db reset` catches replay bugs `db push` hides, so replicate locally on every migration PR.
- **Legacy v\* files** at `src/lib/supabase/migrations/` are already applied to production via `public.schema_migrations` and invisible to `supabase migration list --linked`. Leave them.
- **Money/trigger/algorithm migrations**: prove locally on a real Postgres with a rolled-back walk and assertions before merge.
- Deliberate contract-phase opt-out: `-- expand-contract-ok: <reason>` in the migration file.

---

## Supabase Access

- Use the project-scoped MCP server (`supabase-furqan`) for advisors, SQL, logs — it targets the FURQAN project directly.
- The generic claude.ai Supabase connector authenticates to the user's **primary** account, which is **not** FURQAN's owner (`alforqan.egy@gmail.com`) — its project tools silently target the wrong org. Don't use it for FURQAN.
- Staging runs on a **separate** Supabase ref behind `origin/staging` + a Basic-auth gate. Preview-deployment DB isolation for the production project: verify current wiring before mutation-testing on a preview URL — historically previews shared the production database.

---

## Verification Checklist

After any code change (see `AGENTS.md` §5 for the full command table):

1. `npx tsc --noEmit` — zero errors.
2. `npm run lint` — no new errors (baseline warnings live in vendored `.agents/skills/`; `src/` is clean).
3. `npm run build` — **required**, `tsc` alone doesn't model the server/client boundary.
4. `npm run test:unit` — fast, per task. `npm test` (Playwright) before merge.
5. After a migration: `npm run db:types` + `npm run sb:advisors`.

---

## Agent Skills

- **Issue tracker** — GitHub issues via `gh` CLI. See `docs/agents/issue-tracker.md`.
- **Triage labels** — `needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, `wontfix`. See `docs/agents/triage-labels.md`.
- **Domain docs** — `CONTEXT.md` and `docs/adr/` at repo root. See `docs/agents/domain.md`.
- **Cursor Cloud** — local Supabase bootstrap and gotchas in `docs/agents/cursor-cloud.md`.
