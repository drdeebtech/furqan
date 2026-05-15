# P6 — Notifications & Integrations

**Date:** 2026-05-15  
**Branch:** `main` @ `bb273c2`

---

## WhatsApp (Callmebot)

**File:** `src/lib/whatsapp.ts`

```ts
{ phone: process.env.CALLMEBOT_PHONE_KW ?? "", apiKey: process.env.CALLMEBOT_KEY_KW },
{ phone: process.env.CALLMEBOT_PHONE_EG ?? "", apiKey: process.env.CALLMEBOT_KEY_EG },
```

Recipients are filtered by `apiKey` presence before sending. A `logWarn` fires if no recipients are configured.

| Recipient | Env var | Vercel Production | Status |
|-----------|---------|-------------------|--------|
| Egypt operator | `CALLMEBOT_KEY_EG` | ✅ Present | Active |
| Kuwait operator | `CALLMEBOT_KEY_KW` | 🔴 ABSENT | Dark — receives no alerts |

**Finding:** 🔴 KW operator is completely dark on WhatsApp. Code handles this gracefully (no crash, warns to log), but operationally the KW operator has zero visibility into system events.

---

## Telegram

`TG_BOT_TOKEN` and `TG_ADMIN_CHAT_ID` both present in Vercel production ✅  
`src/lib/n8n/client.ts` `sendTelegramAlert()` has proper error handling with `logError()` on failure ✅

---

## Resend (Email)

`RESEND_API_KEY` present in Vercel production ✅  
Email dispatched via `dispatchNotification()` in `src/lib/notifications/dispatcher.ts` ✅

---

## Sentry

`SENTRY_DSN` present in Vercel production ✅  
`withSentryConfig` in `next.config.ts` ✅  
No `ignoreBuildErrors: true` in Next config ✅  
0 unresolved Sentry issues in last 7 days ✅

---

## n8n Callback Route

`src/app/api/webhooks/n8n/route.ts`:
- HMAC verification via `safeCompareSecret(secret, process.env.N8N_WEBHOOK_SECRET)` ✅
- Structured event routing to DB ✅

---

## Bunny.net

`BUNNY_API_KEY` and `BUNNY_LIBRARY_ID` present in Vercel production ✅  
Webhook verification in `src/app/api/webhooks/bunny/route.ts` uses `crypto.timingSafeEqual` ✅

---

## Daily.co

`DAILY_API_KEY` and `DAILY_HMAC_SECRET` — assumed present (not re-checked; Daily webhook live per spec 007 shipped 2026-05-12). Webhook verification in `src/lib/daily/webhook-verify.ts` ✅

---

## Summary

| Integration | Status |
|-------------|--------|
| WhatsApp (EG) | ✅ Active |
| WhatsApp (KW) | 🔴 Operator dark — key absent |
| Telegram | ✅ Configured + error handled |
| Resend (email) | ✅ Configured |
| Sentry | ✅ Clean (0 issues) |
| n8n webhook | ✅ HMAC verified |
| Bunny.net | ✅ Configured |
| Daily.co | ✅ Shipped (spec 007) |

**Blocker:** No (operational gap, not crash). KW operator darkness is a monitoring gap to fix before meaningful Kuwait-based traffic lands.

---

*Read-only audit finding.*
