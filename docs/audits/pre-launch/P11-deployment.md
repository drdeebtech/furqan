# P11 — Deployment Readiness

**Date:** 2026-05-15  
**Branch:** `main` @ `bb273c2`

---

## vercel.json

| Check | Status |
|-------|--------|
| `installCommand` includes `PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1` | ✅ |
| Cron block | ✅ None (n8n owns scheduling) |

---

## Node Version Alignment

| Source | Version |
|--------|---------|
| `.nvmrc` | 24 |
| `package.json` engines | 24.x |
| Vercel project setting | 24.x |
| Runtime | v24.15.0 |
| **Status** | ✅ All aligned |

---

## next.config.ts

| Check | Status |
|-------|--------|
| `withSentryConfig` present | ✅ |
| `ignoreBuildErrors: true` | ✅ Not present |
| `ignoreDuringBuilds` (lint) | Not checked — build passes TypeScript cleanly |

---

## Supabase Edge Functions

`supabase/functions/` excluded from `tsconfig.json` (Deno imports) — verified per CLAUDE.md convention.

---

## console.log in API Routes

**0 instances** — No production logging via console.log in any API route. ✅

---

## Git Author

Git identity correctly set:
- `user.email = drdeebtech@gmail.com`
- `user.name = drdeebtech`

This matches the Vercel author allowlist required for Hobby/Pro deployments.

---

## Stripe Integration

**Status: 🔴 STUB**

`src/app/api/stripe/checkout/route.ts` and `src/app/api/stripe/webhook/route.ts` exist but are **incomplete stubs** (per ROADMAP.md Sprint 1):
- Webhook signature verification block is commented out
- Checkout session creation pending `STRIPE_SECRET_KEY`
- Fulfillment logic (`src/lib/stripe/*`) is unit-callable but not wired to live routes

**Impact:** Payment flow does not work. If the platform is launching without payments (students pay outside the platform), this is not a blocker. If payments are required at launch, this is a **critical blocker**.

Required env vars not present in Vercel:
- `STRIPE_SECRET_KEY`
- `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY`
- `STRIPE_WEBHOOK_SECRET`

---

## Summary

| Check | Result |
|-------|--------|
| `PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1` | ✅ |
| Node version aligned | ✅ |
| `withSentryConfig` | ✅ |
| No `ignoreBuildErrors` | ✅ |
| No console.log in API | ✅ |
| Stripe integration | 🔴 Stub — not wired for live payments |

**Blocker:** Conditional. Stripe stub is a blocker if payments are required at launch. If launch is payments-free (or manual billing), it is not a blocker.

---

*Read-only audit finding.*
