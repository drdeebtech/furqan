# P0 — Inventory & Baseline

**Date:** 2026-05-15  
**Auditor:** Claude Code  
**Branch audited:** `main` @ `bb273c2`  
**Purpose:** As-of snapshot. No findings here — just facts. All subsequent phases reference this.

---

## Git State

| Item | Value |
|------|-------|
| HEAD | `bb273c2` — test(settings): add unit tests for isAllowedSettingKey type guard |
| Branch | `main` |
| Working tree | Clean (only gitignored runtime artifacts modified locally) |

---

## Node / Runtime Alignment

| Source | Version |
|--------|---------|
| Running node | v24.15.0 |
| `.nvmrc` | 24 |
| `package.json` `engines` | 24.x |
| Vercel project setting | 24.x |
| **Status** | ✅ All aligned |

---

## Vercel Production

| Item | Status |
|------|--------|
| Latest build | ● Ready |
| Build time | ~2 min |
| Most recent deploy | < 1 hour before audit start |
| Platform | Vercel Pro (since 2026-05-05) |
| Project | furqan.today |

---

## Feature Flags (`platform_settings` table)

| Flag | State |
|------|-------|
| `automation_enabled` | ON |
| `whatsapp_enabled` | ON |
| `ai_parent_reports_enabled` | OFF |
| `teacher_quality_monitor_enabled` | OFF |
| `retention_automation_enabled` | OFF |
| `renewal_campaigns_enabled` | OFF |

---

## n8n

| Item | Status |
|------|--------|
| Instance | n8n.drdeeb.tech (Mac mini, 185.19.77.128) |
| Reachability at audit time | ✅ Reachable (was offline earlier in session, now online) |
| API auth | N8N_API_KEY present in `.env.local` and Vercel env |
| GH Actions secret | ⚠️ `N8N_API_KEY` absent from GitHub Actions secrets |

---

## Sentry

| Item | Status |
|------|--------|
| Org | `furqan-academy` |
| Region | `https://de.sentry.io` |
| Unresolved issues (7-day window) | 0 |
| **Status** | ✅ Clean |

---

## GitNexus Code Intelligence

| Item | Status |
|------|--------|
| Last indexed | 2026-05-15 (force re-index run) |
| Nodes / Edges | 10,645 / 16,977 |
| Clusters / Flows | 220 / 300 |
| FTS index (CLI) | ⚠️ Read-only DB conflict — FTS unavailable via CLI; MCP tools unaffected |

---

## CI Workflows — Last Run Status

| Workflow | Last Result | Last Run | Notes |
|----------|-------------|----------|-------|
| `migration-drift` | ✅ success | 2026-05-12 | |
| `rls-tests` | ✅ success | 2026-05-14 | |
| `silent-fail-check` | ✅ success | 2026-05-14 | |
| `db-types-fresh` | ⚠️ stale | 2026-05-07 | Last success 8 days ago — exceeds 7-day freshness threshold |
| `supabase-lint` | ⚠️ last failure | 2026-05-06 | 9 days ago; failure not yet re-run to confirm clear |

---

## GitHub Actions Secrets

| Secret | Present |
|--------|---------|
| `SUPABASE_DB_PASSWORD` | ✅ |
| `SUPABASE_ACCESS_TOKEN` | ✅ |
| `VERCEL_AUTOMATION_BYPASS_SECRET` | ✅ |
| `NEXT_PUBLIC_SUPABASE_URL` | ✅ |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | ✅ |
| `N8N_API_KEY` | ⚠️ ABSENT — exists in Vercel env, not GH Actions |

---

## Vercel Production Environment Variables (56 total)

### Critical — Present ✅

| Variable | Purpose |
|----------|---------|
| `CRON_SECRET` | Dual-auth on all 9 cron routes |
| `N8N_WEBHOOK_SECRET` | Dual-auth on all 9 cron routes |
| `SUPABASE_SERVICE_ROLE_KEY` | Admin DB client |
| `SENTRY_DSN` | Error tracking |
| `TG_BOT_TOKEN` | Telegram alerts |
| `TG_ADMIN_CHAT_ID` | Telegram alerts |
| `RESEND_API_KEY` | Email notifications |
| `BUNNY_API_KEY` | Video CDN |
| `BUNNY_LIBRARY_ID` | Video CDN |
| `CALLMEBOT_KEY_EG` | WhatsApp Egypt operator |
| `N8N_API_KEY` | n8n REST client |

### Missing ⚠️🔴

| Variable | Impact |
|----------|--------|
| `CALLMEBOT_KEY_KW` | 🔴 WhatsApp alerts only reach Egypt operator; Kuwait operator receives nothing. Code handles absent key gracefully (silent skip) but KW operator is effectively dark. |

---

## Roles (per ADR-0003, 2026-05-08)

Active roles: **student · teacher · admin** (3 roles).  
Moderator role retired. Legacy `/moderator/*` URLs 301-redirect → `/admin/*`.  
`is_moderator()` and `is_admin_or_mod()` no longer exist — use `is_admin()` only.

---

## Stack Summary

| Layer | Technology |
|-------|-----------|
| Frontend | Next.js 15, React 19, TypeScript |
| Styling | Tailwind CSS + custom design tokens |
| Backend | Next.js API routes + Server Actions |
| Database | Supabase (Postgres + RLS) — Free plan, shared across all Vercel envs |
| Auth | Supabase Auth |
| Video | Bunny.net + Daily.co |
| Automation | n8n (44+ workflows, Mac mini at n8n.drdeeb.tech) |
| Notifications | Resend (email) + Callmebot (WhatsApp) + Telegram |
| Error tracking | Sentry (`furqan-academy`, DE region) |
| Deployment | Vercel Pro |
| Testing | Vitest (unit) + Playwright (E2E) |

---

## Known Gaps Entering Audit

1. **Preview = Production DB** — All Vercel envs share the same Supabase project. No branching.
2. **CALLMEBOT_KEY_KW absent** — Kuwait operator dark on WhatsApp.
3. **db-types-fresh** CI stale (8 days).
4. **supabase-lint** last run had a failure (not re-checked).
5. **N8N_API_KEY** not in GH Actions secrets (so any GH Action that needs to call n8n directly cannot).

---

*Read-only reference. Do not modify.*
