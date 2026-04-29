# n8n on the Mac mini

n8n migrated from a VPS to a Mac mini on **2026-04-23**. This file documents the current topology. Replaces `VPS_HANDOFF.md` and `VPS_ANSWERS.md` (kept in repo for historical reference only).

---

## Topology

```
furqan.today (Vercel)
   │
   │  outbound: HMAC-signed POST → /webhook/<route>   (X-Furqan-Signature, X-Furqan-Timestamp)
   │  inbound: ← POST with X-N8N-Secret to /api/webhooks/n8n
   ▼
n8n.drdeeb.tech (Cloudflare Tunnel)
   │
   ▼
Mac mini (home network)
   ├── n8n process (PM2 / Docker / native — confirm in `pm2 status`)
   ├── ~/.n8n/database.sqlite (workflows, credentials, executions)
   └── outbound credentials: Supabase service role, Resend, Daily, Telegram bot
```

The Cloudflare tunnel terminates TLS and forwards to local `:5678`. No public IP exposed.

---

## What's where

| Thing | Location |
|-------|----------|
| n8n binary / container | Mac mini |
| n8n internal DB | `~/.n8n/database.sqlite` on Mac mini |
| Workflow JSON backups | `automation/workflows/*.json` in this repo (exported nightly) |
| Cloudflare tunnel config | Cloudflare dashboard → Zero Trust → Tunnels |
| n8n UI URL | `https://n8n.drdeeb.tech` |
| n8n REST API | `https://n8n.drdeeb.tech/api/v1` |
| Healthcheck endpoint | `https://n8n.drdeeb.tech/healthz` |
| Service-role keys (Supabase, etc.) | n8n Credentials store (encrypted in `database.sqlite`) |
| Backup cron | Mac mini crontab — `30 3 * * * node scripts/n8n-export.mjs --commit` |

---

## Access

| Role | How |
|------|-----|
| SSH to Mac mini | Tailscale (private network) |
| n8n UI | `https://n8n.drdeeb.tech` — basic auth from `~/.n8n/.env` |
| n8n REST API from app | `N8N_API_KEY` env var on Vercel |

Only the owner has SSH + n8n UI credentials at present. Add a second admin via 1Password if onboarding more operators.

---

## Env vars (app-side)

| Var | Purpose |
|-----|---------|
| `N8N_WEBHOOK_URL` | base URL for outbound events (`https://n8n.drdeeb.tech`) |
| `N8N_WEBHOOK_SECRET` | HMAC + callback shared secret |
| `N8N_API_URL` | REST API base (`https://n8n.drdeeb.tech/api/v1`) — **no longer falls back to a default**, must be set |
| `N8N_API_KEY` | n8n REST API key |
| `N8N_HEALTHCHECK_URL` | healthcheck probe target |
| `NEXT_PUBLIC_N8N_UI_URL` | UI link from `/admin/n8n` |
| `TG_BOT_TOKEN` / `TG_ADMIN_CHAT_ID` | Telegram alerts (auto-restart, healthcheck flips) |

---

## Why the move from VPS

The VPS had:
- Recurring SSL cert renewal failures.
- Higher cost than expected for what's a single n8n process.
- Network egress charges on workflow runs that hit external APIs.

The Mac mini gives us:
- Zero hosting cost.
- Direct disk access for snapshots.
- Cloudflare tunnel handles TLS and DDoS.
- Same uptime in practice (home internet has been more reliable than the budget VPS).

Trade-off: a residential power outage = n8n outage. The healthcheck cron + Telegram alert cover detection. For workflow recovery if the mini dies, see `RUNBOOK.md` § "Workflow recovery."

---

## Migrating to a new host (when needed)

The Mac mini is fine for now. If/when load demands a move:

1. Run `node scripts/n8n-export.mjs --commit` to capture current state.
2. Stand up new n8n on the target host, configure credentials.
3. Import each JSON via REST (see RUNBOOK).
4. Update Cloudflare tunnel target OR rotate `N8N_*` env vars on Vercel to point at the new host.
5. Trigger a Vercel redeploy.
6. Decommission the Mac mini.

The HMAC contract, callback secret, and audit-log expectations all survive a host move — they're app-side concerns, not host-specific.
