# CLAUDE Reference Material

Sections moved here from `CLAUDE.md` to reduce per-session token cost.
These are consulted on-demand (architecture questions, Sentry fixes, Supabase issues, migrations detail).

---

## Key Architecture

- **Route protection**: `src/proxy.ts` — role middleware + legacy moderator redirects.
- **Server actions**: `"use server"` + `revalidatePath`; `as never` for Supabase `.insert/.update/.upsert` (migrating to typed-helpers per ADR-0002).
- **Admin client**: `src/lib/supabase/admin.ts` — service-role.
- **Feature flags**: `src/lib/settings.ts` + `platform_settings` table.
- **Notifications**: `src/lib/notifications/dispatcher.ts` (multi-channel + quiet hours + `message_delivery_log`); parent reports in `src/lib/notifications/parent.ts`.
- **Event emission**: `src/lib/automation/emit.ts` (non-blocking webhooks → n8n).
- **n8n integration**: REST client `src/lib/n8n/client.ts`; callback `src/app/api/webhooks/n8n/route.ts`; control panel `/admin/n8n`; instance `n8n.drdeeb.tech` on Mac mini (44+ active FURQAN workflows).
- **Telegram bot**: @furqantoday_bot — alerts, failure notifications, admin digests.
- **Admin control tower**: `/admin/control-tower` — 7 real-time operational widgets.
- **Follow-up state machine**: `src/lib/actions/homework.ts` (5 actions, auto-regeneration).
- **Session observation**: Daily.co observer tokens, mic/camera off, max_participants=3.
- **Session lifecycle source of truth (spec 007, shipped 2026-05-12)**: `src/app/api/webhooks/daily/route.ts` receives Daily.co `meeting.started` / `meeting.ended` with HMAC-SHA256 verification + ±15-min skew window. SQL functions `start_session_from_webhook` / `end_session_from_webhook` (SECURITY DEFINER) write `sessions.started_at` / `sessions.ended_at`. Idempotency via `daily_webhook_events` table. Lib at `src/lib/daily/`. The teacher-side `endSession` is now a no-op when the webhook arrived first (reconciliation guard).
- **PWA**: `public/sw.js` + install prompt.

More file-path detail in `docs/agents/project-reference.md` § File Structure.

---

## Environment Variables

All env vars declared in **`docs/agents/env-vars.md`** (variable → purpose). **Rule:** if you add `process.env.X` to code, add `X` to that table in the same PR. Verify with `npx vercel env ls`.

---

## Docs Map

File tree, completed features, remaining work, full docs index all in `docs/agents/project-reference.md`. Deep references when needed: `PROJECT.md`, `ROADMAP.md`, `EVENT_CATALOG.md`, `LIFECYCLES.md`, `AUTOMATION_REGISTRY.md`, `.specify/memory/constitution.md`, `specs/INDEX.md`, `specs/<feature>/spec.md`.

> **Design rule:** before touching any visual surface (component, page, theme, color), open `.impeccable.md` and confirm alignment with the **Premium · Refined · Authentic** personality and the four anti-references.

---

## Sentry ↔ Git Commit Convention

When a commit fixes a Sentry issue, include `Fixes JAVASCRIPT-NEXTJS-E4-<N>` in the commit message body (or PR title/description). `Fixes` / `Resolves` / `Closes` all work. Release tagging via `withSentryConfig` in `next.config.ts` (`release.setCommits.auto: true`); fires once the commit lands on `main` and the next Vercel build ships.

Find the short ID in the Sentry issue header (e.g. `JAVASCRIPT-NEXTJS-E4-NN`).

**Auto-resolve currently broken** — until fixed, manually resolve via Sentry MCP `update_issue` on every `Fixes JAVASCRIPT-NEXTJS-…` PR. (Root cause: the Sentry GitHub App needs installing at the `drdeebtech` org level, not the personal level.)

---

## Database Migrations — Full Detail

⚠️ **The Supabase Branching GitHub integration silently skips applies more than once a month** (incidents: 2026-04-26..27, 2026-05-01..02, 2026-05-03). Each time, the SQL never runs, no error surfaces. **Do not trust the integration as source of truth.**

`.github/workflows/supabase-migrate.yml` is the source of truth: runs `supabase db push --linked` on every push to `main` touching `supabase/migrations/**`, plus dry-run on every PR.

**Required secret:** `SUPABASE_DB_PASSWORD`.
```bash
gh secret set SUPABASE_DB_PASSWORD
```
If the workflow is red on `main`, check `gh secret list` first.

### Existing v* migrations
The 30+ files at `src/lib/supabase/migrations/v*.sql` stay where they are — already applied to production via `public.schema_migrations`. Invisible to `supabase migration list --linked`. Don't migrate them; schema is already there.

### Manual / hotfix path
```bash
npx supabase db query --linked --file <path/to/file.sql>
```
Uses Management API via `supabase login` session. Bypasses both trackers — use sparingly + commit the file afterward.

### Detecting drift
- `npx supabase migration list --linked` — timestamped files only (Local vs Remote).
- For v* files: `select version from public.schema_migrations order by version`.
- CI runs `supabase db lint --linked` on every PR (`.github/workflows/supabase-lint.yml`) — catches syntax, NOT un-applied migrations.

---

## Preview Database Isolation — Known Gap (P2)

All three Vercel environments (Production, Preview, Development) currently point at the same Supabase project (`xyqscjnqfeusgrhmwjts`). Preview deployments share `SUPABASE_SERVICE_ROLE_KEY` with Production — any preview URL has full write access to the production database.

**Until Supabase Branching is set up, treat every preview URL as production for data-mutation testing.** Don't on a preview: deletes, bulk updates, payment flows, role changes, cron-trigger curls.

Long-term fix: Supabase Branching for Preview — tracked in `docs/agents/project-reference.md` § Infrastructure improvements.

---

## Supabase Auth — Leaked Password Protection

One-time HIBP toggle: enable **Leaked password protection** in Supabase → Authentication → Policies.

---

## Supabase MCP — Wrong-Account Gotcha

`mcp__claude_ai_Supabase__*` tools authenticate to the user's **primary** account, which is NOT FURQAN's owner. FURQAN lives under `alforqan.egy@gmail.com`; MCP sees `Dr Deeb Urology Clinic` instead.

**Consequences:** `list_projects`, `get_advisors`, `execute_sql`, `get_logs`, `apply_migration` silently target the wrong project. Use the browser dashboard signed in as the FURQAN-owning account, or generate a personal access token under that account and pass via `--token` / `SUPABASE_ACCESS_TOKEN`.

---

## Verification Checklist

After any code change:
1. `npx next build` — zero errors.
2. `npm run lint` — no new errors.
3. `npx playwright test` — all existing tests pass.
4. `npx vercel ls furqan --prod` — deployment succeeds.

---

## Agent Skills

- **Issue tracker** — GitHub issues at `github.com/drdeebtech/furqan/issues` via `gh` CLI. See `docs/agents/issue-tracker.md`.
- **Triage labels** — `needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, `wontfix`. The `triage` skill creates the first four on first use. See `docs/agents/triage-labels.md`.
- **Domain docs** — single-context layout. `CONTEXT.md` and `docs/adr/` at repo root (both lazily populated by `/grill-with-docs`). See `docs/agents/domain.md`.
