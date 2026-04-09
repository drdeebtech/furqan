# n8n Credentials Setup — Actual Values

## HOW TO USE THIS FILE
Transfer your `.env.local` file to the VPS alongside this file.
Then tell Claude Code on VPS: "Read furqan-handoff/env-secrets.txt and set up all credentials"

## Transfer Command (run from your Mac):
```bash
# Copy env file to VPS
scp /Users/drdeeb/furqan/.env.local YOUR_VPS_IP:/var/lib/docker/volumes/n8n_n8n_data/_data/furqan-handoff/env-secrets.txt

# Copy this file too
scp /Users/drdeeb/furqan/automation/CREDENTIALS_SETUP.md YOUR_VPS_IP:/var/lib/docker/volumes/n8n_n8n_data/_data/furqan-handoff/
```

## What Claude Code on VPS Should Do With env-secrets.txt

Read the file and extract these values:

### 1. Supabase Credential
- **Name in n8n:** `Supabase FURQAN`
- **Type:** Supabase
- **Host:** Value of `NEXT_PUBLIC_SUPABASE_URL` from env-secrets.txt
- **Service Role Key:** Value of `SUPABASE_SERVICE_ROLE_KEY` from env-secrets.txt

### 2. Daily.co Credential
- **Name in n8n:** `Daily.co API`
- **Type:** Header Auth
- **Header Name:** `Authorization`
- **Header Value:** `Bearer <value of DAILY_API_KEY from env-secrets.txt>`

### 3. Email Credential
- **Name in n8n:** Already exists as `Gmail SMTP (deeb.research1)`
- **Admin email for alerts:** Value of `ADMIN_EMAIL` from env-secrets.txt

### 4. Resend Email API
- **Name in n8n:** `Resend API`
- **Type:** Header Auth
- **Header Name:** `Authorization`
- **Header Value:** `Bearer <value of RESEND_API_KEY from env-secrets.txt>`

### 5. N8N_WEBHOOK_SECRET (needs to be created)
This secret does NOT exist yet. Create it:
```bash
openssl rand -hex 32
```
Then:
- Add to Vercel env vars as `N8N_WEBHOOK_SECRET`
- Use in every n8n workflow that calls `https://furqan.today/api/webhooks/n8n`
- Pass as header: `X-N8N-Secret: <the secret>`

### 6. N8N_WEBHOOK_URL (needs to be added to Vercel)
- **Value:** `https://n8n.drdeeb.tech`
- Add to Vercel env vars as `N8N_WEBHOOK_URL`

## Supabase Direct Query Access

Claude Code on VPS can query Supabase directly using curl + service role key:

```bash
# Example: list tables
curl -s "https://xyqscjnqfeusgrhmwjts.supabase.co/rest/v1/" \
  -H "apikey: <SUPABASE_SERVICE_ROLE_KEY>" \
  -H "Authorization: Bearer <SUPABASE_SERVICE_ROLE_KEY>"

# Example: query bookings
curl -s "https://xyqscjnqfeusgrhmwjts.supabase.co/rest/v1/bookings?status=eq.confirmed&select=id,student_id,teacher_id,scheduled_at&limit=5" \
  -H "apikey: <SUPABASE_SERVICE_ROLE_KEY>" \
  -H "Authorization: Bearer <SUPABASE_SERVICE_ROLE_KEY>"

# Example: check automation_logs
curl -s "https://xyqscjnqfeusgrhmwjts.supabase.co/rest/v1/automation_logs?select=*&limit=10&order=started_at.desc" \
  -H "apikey: <SUPABASE_SERVICE_ROLE_KEY>" \
  -H "Authorization: Bearer <SUPABASE_SERVICE_ROLE_KEY>"
```

## Telegram Admin Alert Config

- **Bot:** @barondeeb2bot (credential already in n8n)
- **Admin Chat ID:** You need to provide this — send `/start` to @barondeeb2bot on Telegram, then check the chat ID

## Message To Give Claude Code After Setup

```
All credentials are ready:
- Supabase: configured (read env-secrets.txt for the keys)
- Daily.co: configured
- Telegram: @barondeeb2bot already in n8n
- Gmail SMTP: already in n8n
- N8N_WEBHOOK_SECRET: <paste the generated secret>
- Telegram admin chat ID: <your chat ID>

The .env.local file is at: /home/node/.n8n/furqan-handoff/env-secrets.txt
Read it to get all API keys.

automation_logs table: EXISTS in Supabase
/api/webhooks/n8n: LIVE at https://furqan.today/api/webhooks/n8n
Feature flags: all seeded in platform_settings table

Start building WF-1 (Platform Health Check) first, test it, then continue to WF-8.
```
