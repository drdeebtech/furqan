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
| `STRIPE_CONNECT_WEBHOOK_SECRET` | Stripe Connect webhook — connected-account events (spec 040 Phase 3; set at Phase 6 go-live) |
| `SENTRY_DSN` | Sentry server/edge ingest (DE region) |
| `NEXT_PUBLIC_SENTRY_DSN` | Sentry browser ingest (publicly bundled) |
| `CRON_SECRET` | Bearer token gating `/api/cron/*` against unauthenticated hits |
| `RESEND_FROM_EMAIL` | "From" header for transactional email |
| `N8N_HEALTHCHECK_URL` | Endpoint hit by `/api/cron/n8n-healthcheck` |
| `NEXT_PUBLIC_N8N_UI_URL` | Link target from `/admin/n8n` to the n8n UI |
| `NEXT_PUBLIC_MIXPANEL_TOKEN` | Mixpanel project token (client-public by design). Unset = Mixpanel disabled fail-soft. Client init in `src/lib/mixpanel-client.ts`; server events via `src/lib/mixpanel-server.ts`. |
| `TRUSTED_PROXY_HOPS` | Self-hosted only (#691): number of trusted reverse proxies appending to `x-forwarded-for`; client IP = Nth entry from the right. Unset on Vercel (edge headers already authoritative via `VERCEL`); unset + off-Vercel = no client IP (fail-safe). |
| `CALLMEBOT_KEY_EG` | CallMeBot API key (Egypt WhatsApp routing) |
| `CALLMEBOT_KEY_KW` | CallMeBot API key (Kuwait WhatsApp routing) |
| `CALLMEBOT_PHONE_EG` | CallMeBot recipient phone (Egypt) |
| `CALLMEBOT_PHONE_KW` | CallMeBot recipient phone (Kuwait) |
| `BUNNY_STREAM_API_KEY` | Bunny.net Stream library API key (server-only; never sent to client) |
| `BUNNY_STREAM_LIBRARY_ID` | Bunny.net Stream library numeric ID |
| `BUNNY_STREAM_PULL_ZONE_HOSTNAME` | Bunny CDN pull-zone hostname for video playback (e.g. `vz-12345678-abc.b-cdn.net`) |
| `BUNNY_STREAM_TOKEN_AUTH_KEY` | Bunny CDN token-auth key for signing playback URLs |
| `BUNNY_WEBHOOK_SECRET` | Bunny.net webhook HMAC SHA256 signing secret (verifies status callbacks) |
| `PAYPAL_CLIENT_ID` | PayPal app client ID — **server-only**. Used with the secret for the OAuth client-credentials grant. Checkout is a server-side redirect flow (the route creates an order and returns `approveUrl`), so this is never sent to the browser |
| `PAYPAL_CLIENT_SECRET` | PayPal app client secret — server-only, used for OAuth client-credentials grant |
| `PAYPAL_API_BASE` | `https://api-m.sandbox.paypal.com` (sandbox) or `https://api-m.paypal.com` (live). **Defaults to sandbox when unset or empty** — set it explicitly for live, or live credentials will be sent to the sandbox host and fail auth with no environment hint |
| `PAYPAL_WEBHOOK_ID` | PayPal webhook ID (from the app's Webhooks section — the ID, *not* the URL) for `/api/paypal/webhook`. **Required**: the route returns **503** when unset and trusts only `verification_status === 'SUCCESS'`. Subscribe the webhook to exactly `PAYMENT.CAPTURE.COMPLETED` / `.DENIED` / `.REFUNDED` / `.REVERSED` |
| `SENTRY_WATCH_SECRET` | Shared bearer token for `POST /api/sentry-watch/notify`. The hourly Claude Code Sentry-watcher cron presents it; the endpoint validates against it before sending the WhatsApp triage alert |
| `BOTID_BYPASS_EMAILS` | Comma-separated allow-list of admin emails that skip BotID on `/login` + `/register`. Emergency-glass when the BotID client SDK fails to mint a token in a specific browser. The per-email rate limiter (10/hr) still gates stuffing attempts. Optional — leave unset to enforce BotID for everyone |
| `DAILY_WEBHOOK_SECRET` | Daily.co webhook HMAC-SHA256 signing secret — **required** for the `/api/webhooks/daily` receiver. Set this in Vercel Production + Preview + Development, and in the Daily.co dashboard webhook config |
| `DAILY_WEBHOOK_SECRET_PREVIOUS` | Previous Daily.co webhook secret — **optional**. Set during the 24-hour rotation overlap window so old-signed events still verify while rotating to a new secret. Remove after the rotation window closes |
