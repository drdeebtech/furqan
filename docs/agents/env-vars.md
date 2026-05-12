# Environment Variables — Source of Truth

> Extracted from `CLAUDE.md` on 2026-05-12. The same-PR rule still applies:
> **if you add `process.env.X` to code, add `X` to this table in the same PR.**
> Run `npx vercel env ls` to verify each is set in Production / Preview / Development.

| Variable | Purpose |
|----------|---------|
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase project URL |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Supabase anon key |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase admin key |
| `NEXT_PUBLIC_APP_URL` | App base URL |
| `DAILY_API_KEY` | Daily.co video rooms |
| `RESEND_API_KEY` | Email sending |
| `ADMIN_EMAIL` | Admin notification email |
| `N8N_WEBHOOK_URL` | n8n base URL (https://n8n.drdeeb.tech) |
| `N8N_WEBHOOK_SECRET` | Shared secret for n8n callbacks |
| `N8N_API_URL` | n8n REST API (https://n8n.drdeeb.tech/api/v1) |
| `N8N_API_KEY` | n8n API key for control panel |
| `TG_BOT_TOKEN` | Telegram bot @furqantoday_bot |
| `TG_ADMIN_CHAT_ID` | Admin Telegram chat (707213038) |
| `STRIPE_SECRET_KEY` | Stripe payments (deferred) |
| `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY` | Stripe client (deferred) |
| `STRIPE_WEBHOOK_SECRET` | Stripe webhook (deferred) |
| `SENTRY_DSN` | Sentry server/edge ingest (DE region) |
| `NEXT_PUBLIC_SENTRY_DSN` | Sentry browser ingest (publicly bundled) |
| `CRON_SECRET` | Bearer token gating `/api/cron/*` against unauthenticated hits |
| `RESEND_FROM_EMAIL` | "From" header for transactional email |
| `N8N_HEALTHCHECK_URL` | Endpoint hit by `/api/cron/n8n-healthcheck` |
| `NEXT_PUBLIC_N8N_UI_URL` | Link target from `/admin/n8n` to the n8n UI |
| `CALLMEBOT_KEY_EG` | CallMeBot API key (Egypt WhatsApp routing) |
| `CALLMEBOT_KEY_KW` | CallMeBot API key (Kuwait WhatsApp routing) |
| `CALLMEBOT_PHONE_EG` | CallMeBot recipient phone (Egypt) |
| `CALLMEBOT_PHONE_KW` | CallMeBot recipient phone (Kuwait) |
| `BUNNY_STREAM_API_KEY` | Bunny.net Stream library API key (server-only; never sent to client) |
| `BUNNY_STREAM_LIBRARY_ID` | Bunny.net Stream library numeric ID |
| `BUNNY_STREAM_PULL_ZONE_HOSTNAME` | Bunny CDN pull-zone hostname for video playback (e.g. `vz-12345678-abc.b-cdn.net`) |
| `BUNNY_STREAM_TOKEN_AUTH_KEY` | Bunny CDN token-auth key for signing playback URLs |
| `BUNNY_WEBHOOK_SECRET` | Bunny.net webhook HMAC SHA256 signing secret (verifies status callbacks) |
| `PAYPAL_CLIENT_ID` | PayPal app client ID — server-side and surfaced as NEXT_PUBLIC_PAYPAL_CLIENT_ID for the SDK loader |
| `PAYPAL_CLIENT_SECRET` | PayPal app client secret — server-only, used for OAuth client-credentials grant |
| `NEXT_PUBLIC_PAYPAL_CLIENT_ID` | Same value as `PAYPAL_CLIENT_ID`; needed in the browser by `@paypal/react-paypal-js` |
| `PAYPAL_API_BASE` | `https://api-m.sandbox.paypal.com` (sandbox) or `https://api-m.paypal.com` (live). Defaults to sandbox if missing |
| `SENTRY_WATCH_SECRET` | Shared bearer token for `POST /api/sentry-watch/notify`. The hourly Claude Code Sentry-watcher cron presents it; the endpoint validates against it before sending the WhatsApp triage alert |
| `BOTID_BYPASS_EMAILS` | Comma-separated allow-list of admin emails that skip BotID on `/login` + `/register`. Emergency-glass when the BotID client SDK fails to mint a token in a specific browser. The per-email rate limiter (10/hr) still gates stuffing attempts. Optional — leave unset to enforce BotID for everyone |
