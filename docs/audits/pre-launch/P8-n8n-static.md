# P8 — n8n Workflow Audit (Static)

**Date:** 2026-05-15  
**Branch:** `main` @ `bb273c2`  
**Note:** Full live audit requires Mac mini VPN access. This is a static code audit only.

---

## Scheduling Ownership

**`vercel.json` cron block:** `NONE` ✅

n8n on the Mac mini owns all scheduling per CLAUDE.md. No Vercel cron jobs exist. This is the correct architecture.

---

## Cron Route Dual-Auth Coverage

All 10 cron routes under `src/app/api/cron/` have both CRON_SECRET and N8N_WEBHOOK_SECRET checks:

| Route | CRON_SECRET refs | N8N_SECRET refs |
|-------|-----------------|-----------------|
| `audit-cleanup` | 7 | 4 |
| `auto-complete-sessions` | 7 | 4 |
| `bunny-stuck-lessons` | 6 | 4 |
| `cache-clear` | 6 | 3 |
| `email-health` | 7 | 3 |
| `handoff-cleanup` | 7 | 4 |
| `murajaah-due` | 7 | 4 |
| `n8n-healthcheck` | 7 | 3 |
| `reconciliation` | 7 | 3 |
| `retention-score` | 2 | 1 |

All routes are auth-gated. `retention-score` has fewer references because it uses a single combined check rather than separate `cronOk`/`n8nOk` booleans.

---

## n8n REST Client

`src/lib/n8n/client.ts`:
- Throws `Error("N8N_API_KEY not configured")` at startup if key absent ✅
- Throws `Error("N8N_API_URL not configured")` at startup if URL absent ✅
- Non-200 responses throw with status code and body ✅
- `logError()` called for Telegram alert failures ✅
- Execution status, error message, and stack correctly typed ✅

---

## n8n Live Workflow Audit

n8n became reachable partway through this audit session. A live API call returned HTTP 200 (previously ECONNREFUSED). Full workflow audit (active count, last execution timestamps, error rates) deferred — requires authenticated API call from approved environment.

**Known from AUTOMATION_REGISTRY.md:** 44+ active workflows registered.

---

## Summary

| Check | Result |
|-------|--------|
| Vercel cron jobs | ✅ None (n8n owns scheduling) |
| All 10 cron routes auth-gated | ✅ |
| n8n client error handling | ✅ |
| Live workflow audit | ⚠️ Deferred (network access) |

**Blocker:** No.

---

*Read-only audit finding.*
