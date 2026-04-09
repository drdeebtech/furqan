# Answers to n8n Claude Code Setup Questions

## Status of Each Item

| # | Item | Status | Value / Action |
|---|------|--------|----------------|
| 1 | n8n API key | **YOU MUST CREATE** | n8n UI → Settings → API → Create API key → paste below |
| 2 | Supabase service role key | **YOU MUST ADD** | Add as credential in n8n UI (see Supabase section below) |
| 3 | Supabase project URL | **CONFIRMED** | `https://xyqscjnqfeusgrhmwjts.supabase.co` |
| 4 | Daily.co API key | **CHECK VERCEL** | Vercel → furqan → Settings → Env Vars → `DAILY_API_KEY` |
| 5 | Anthropic API key | **DEFER** | Skip for now — use WF-7 (structured fallback) instead of WF-6 (AI) |
| 6 | automation_logs table | **EXISTS** | Created via v12_001_automation.sql — live in production Supabase |
| 7 | /api/webhooks/n8n endpoint | **LIVE** | `https://furqan.today/api/webhooks/n8n` — deployed on Vercel |
| 8 | N8N_WEBHOOK_SECRET | **YOU MUST SET** | Generate with `openssl rand -hex 32`, add to BOTH Vercel + n8n |
| 9 | WhatsApp Business | **DEFERRED** | Phase 2 — not needed for first 8 workflows |

---

## What YOU Need To Do (Manual Steps)

### Step 1: Generate a shared webhook secret
Run this on your terminal:
```bash
openssl rand -hex 32
```
Save the output — you'll use it in Steps 2 and 3.

### Step 2: Add env vars to Vercel
Go to: https://vercel.com/drdeebtechs-projects/furqan/settings/environment-variables

Add these two:
```
N8N_WEBHOOK_URL = https://n8n.drdeeb.tech
N8N_WEBHOOK_SECRET = <the secret from Step 1>
```
After adding, redeploy: push an empty commit or trigger deploy from Vercel dashboard.

### Step 3: Create n8n API key
1. Go to https://n8n.drdeeb.tech
2. Settings → API → Create API key
3. Copy the key

### Step 4: Add Supabase credential in n8n
1. Go to https://n8n.drdeeb.tech
2. Credentials → Add New → Supabase
3. Fill in:
   - **Host**: `https://xyqscjnqfeusgrhmwjts.supabase.co`
   - **Service Role Key**: (get from Supabase Dashboard → Settings → API → service_role key)

### Step 5: Add Daily.co credential in n8n (for WF-4)
1. Credentials → Add New → Header Auth
2. Name: `Daily.co API`
3. Header Name: `Authorization`
4. Header Value: `Bearer <DAILY_API_KEY from Vercel env vars>`

---

## What To Tell Claude Code on VPS

After completing Steps 1-5, give Claude Code this message:

```
Here are the answers to your setup questions:

1. n8n API key: <paste key from Step 3>
2. Supabase credential: Added in n8n UI as "Supabase Service Role"
3. Supabase URL: https://xyqscjnqfeusgrhmwjts.supabase.co (confirmed)
4. Daily.co: Added in n8n UI as "Daily.co API"
5. Anthropic: Deferred — use structured fallback (WF-7) for now
6. automation_logs: EXISTS in Supabase (migration v12_001 applied)
7. /api/webhooks/n8n: LIVE at https://furqan.today/api/webhooks/n8n
8. N8N_WEBHOOK_SECRET: <paste secret from Step 1>
9. WhatsApp: Deferred to Phase 2

Telegram admin chat ID for alerts: <your Telegram chat ID with @barondeeb2bot>

Start building WF-1 through WF-8. Build them as importable JSON files, 
then import and activate each one. Test each workflow after activation.
Skip WF-6 (AI parent report) for now — build WF-7 (structured fallback) first.
```

---

## automation_logs Table Schema (Already Live)

```sql
CREATE TABLE automation_logs (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workflow_name    text NOT NULL,
  event_name       text,
  entity_type      text,
  entity_id        uuid,
  idempotency_key  text UNIQUE,
  status           text NOT NULL DEFAULT 'started' 
                   CHECK (status IN ('started','succeeded','failed','skipped')),
  channel          text,
  payload_json     jsonb,
  result_json      jsonb,
  error_message    text,
  attempt_count    integer DEFAULT 1,
  started_at       timestamptz DEFAULT now(),
  finished_at      timestamptz,
  trace_id         uuid DEFAULT gen_random_uuid()
);
```

## platform_settings Feature Flags (Already Live)

| Key | Current Value |
|-----|---------------|
| `automation_enabled` | `true` |
| `whatsapp_enabled` | `true` |
| `ai_parent_reports_enabled` | `false` |
| `teacher_quality_monitor_enabled` | `false` |
| `retention_automation_enabled` | `false` |
| `renewal_campaigns_enabled` | `false` |

## App Callback Endpoint Contract

**URL:** `https://furqan.today/api/webhooks/n8n`
**Method:** POST
**Auth Header:** `X-N8N-Secret: <N8N_WEBHOOK_SECRET>`

### Available Actions:

**Log an automation execution:**
```json
{
  "action": "log",
  "workflow_name": "session-reminder-engine",
  "event_name": "booking.reminder_sent",
  "entity_type": "booking",
  "entity_id": "uuid-here",
  "idempotency_key": "session-reminder:uuid:24h",
  "status": "succeeded",
  "channel": "in_app"
}
```

**Send in-app notification to a user:**
```json
{
  "action": "notify",
  "user_id": "uuid-here",
  "type": "reminder",
  "title": "تذكير بجلستك",
  "body": "جلستك القادمة بعد ساعة — استعد!"
}
```

**Check idempotency (was this already done?):**
```json
{
  "action": "check_idempotency",
  "idempotency_key": "session-reminder:uuid:24h"
}
// Response: { "exists": true } or { "exists": false }
```
