# Automation Runbook

How to detect, diagnose, and recover when the n8n automation layer goes wrong.

n8n runs on the Mac mini at `n8n.drdeeb.tech`. The app talks to it via HMAC-signed webhooks; n8n calls back to the app via `X-N8N-Secret`. Workflow JSONs are exported nightly to `automation/workflows/` in this repo.

---

## Health signals

| Signal | Where | Means |
|--------|-------|-------|
| `/api/cron/n8n-healthcheck` returns `status=down` | Vercel cron (paid tier) or external uptime probe | n8n.drdeeb.tech is unreachable from Vercel |
| Telegram alert "n8n DOWN" | @furqantoday_bot to admin chat | Healthcheck flipped from up→down |
| `/admin/automation` shows `failed` count climbing | Admin UI | Workflows running but erroring |
| `/admin/automation/replay` dead-letter list growing | Admin UI | Events exhausted retries on n8n side |
| `automation_logs.status='skipped'` rows appearing | Supabase | Kill-switch is suppressing events (intentional or not) |

---

## Outage playbook

### 1. n8n unreachable (DOWN alert)

1. SSH to Mac mini. Check the n8n process:
   ```sh
   pm2 status              # if managed by pm2
   docker ps | grep n8n    # if containerized
   systemctl status n8n    # if systemd unit
   ```
2. Tail logs for the last error: `pm2 logs n8n --lines 100` (or equivalent).
3. Common causes:
   - Mac mini rebooted and n8n didn't auto-start → start the service.
   - Disk full → `df -h`, prune `~/.n8n/database.sqlite` backups or Docker volumes.
   - SSL cert expired on the Cloudflare tunnel → renew via Cloudflare dashboard.
   - n8n upgraded itself and a new version is incompatible → roll back.
4. After bringing it back up, hit `https://n8n.drdeeb.tech/healthz` from your laptop. If it returns 200, the next Vercel cron run will auto-clear the alert.

### 2. Workflows failing en masse (failed count climbing)

1. Open `/admin/n8n` — find the workflow with the highest fresh-error count.
2. Open it in the n8n UI (`https://n8n.drdeeb.tech`) → Executions tab.
3. Click into the most recent failure. The Function/HTTP node that errored shows the actual exception.
4. Common causes & fixes:
   - **Supabase service-role key rotated** → update n8n credential `Supabase Service Role`.
   - **Telegram bot token revoked** → regenerate via @BotFather, update credential.
   - **App-side schema change** broke a SELECT in the workflow → adjust the n8n SQL node OR roll the schema change back.
   - **Daily.co API quota** → wait for reset or upgrade.
5. After fixing the credential / column / quota: in `/admin/n8n` click the workflow's restart toggle (uses `/api/n8n/auto-restart`).
6. Replay the failed events from `/admin/automation/replay` — pick the rows tagged with the failed workflow name and click Replay.

### 3. App→n8n events not arriving

Symptom: `/admin/automation` shows `automation_logs.status='failed'` rows with `workflow_name='furqan-app:emitEvent'` and error_message like `n8n 401` or `fetch failed`.

1. **n8n 401** → HMAC signature rejected. Check that `N8N_WEBHOOK_SECRET` matches on both sides:
   - Vercel: `npx vercel env ls` should show it set in Production.
   - n8n: open the verifier Function node → ensure the secret it reads matches.
2. **fetch failed** → n8n unreachable from Vercel. See playbook 1.
3. **status='skipped'** rows with reason `automation_enabled=false` → kill-switch is on. Flip it back at `/admin/settings`.

### 4. Notifications spamming a user

Symptom: a user reports being flooded with in-app notifications.

1. Check `/admin/automation` for `workflow_name` patterns hitting that user.
2. The callback now rate-limits per-user to **30 notifications/minute**. Throttled attempts appear in `message_delivery_log` with `status='throttled'`.
3. If throttled rows are stacking up, the offending workflow has a loop or trigger storm:
   - Open the workflow in n8n → check trigger filters (likely a webhook firing too often).
   - Deactivate via `/admin/n8n` toggle.
   - Audit `audit_log` for `table_name='n8n_workflows'` to confirm who/what touched it last.

---

## Workflow recovery (Mac mini disk failure)

Workflows are exported nightly to `automation/workflows/*.json`. To restore:

1. Stand up a new n8n instance (Docker, PM2, whatever). Configure credentials matching the originals.
2. For each file in `automation/workflows/`:
   ```sh
   curl -X POST https://NEW_N8N/api/v1/workflows \
     -H "X-N8N-API-KEY: $NEW_KEY" \
     -H "Content-Type: application/json" \
     -d @automation/workflows/<id>__<slug>.json
   ```
3. Activate the workflows you want running (n8n imports inactive by default).
4. Update `N8N_API_URL`, `N8N_WEBHOOK_URL`, `N8N_HEALTHCHECK_URL` in Vercel if the new instance has a different domain.

---

## Secret rotation

`N8N_WEBHOOK_SECRET` is shared between the app (Vercel env) and the n8n verifier Function node. Rotate atomically:

1. Generate a new secret: `openssl rand -hex 32`.
2. In the n8n verifier node, update logic to accept **both** the old and the new secret for a brief window (e.g. 10 min). Save and activate.
3. In Vercel, update `N8N_WEBHOOK_SECRET` to the new value (Production + Preview + Development).
4. Trigger a redeploy.
5. After ~10 min, remove the old-secret branch from the verifier node.

`N8N_API_KEY` (admin-side, controls workflow toggle/restart): generate a new key in n8n → update Vercel env → redeploy → revoke the old key.

---

## Kill switch

`automation_enabled` flag at `/admin/settings`. When **off**:
- `emitEvent()` does NOT POST to n8n.
- Each suppressed event writes a row to `automation_logs` with `status='skipped'` and `error_message='automation_enabled=false'`.
- n8n callbacks are still accepted (they don't check this flag — they're inbound from a workflow you presumably want running).

Per-event sub-flags (defined in `src/lib/automation/emit.ts:EVENT_SUB_FLAGS`):
- `homework.graded`, `session.notes_saved`, `session.no_show` → `ai_parent_reports_enabled`
- `retention.signal_triggered` → `retention_automation_enabled`

---

## Backups

- **Workflow JSONs:** nightly `node scripts/n8n-export.mjs --commit` on Mac mini cron. Restore via the curl loop above.
- **n8n internal DB** (executions, credentials, queue state): Mac mini Time Machine + manual weekly `~/.n8n/database.sqlite` snapshot to off-machine storage.
- **automation_logs / message_delivery_log / audit_log:** Supabase nightly backups (Supabase plan default).
