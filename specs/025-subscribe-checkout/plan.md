# Spec 025 — Subscribe Checkout Landing Page

**Branch:** `chore/stripe-live-plan-bootstrap`
**Status:** Implementation
**Date:** 2026-06-20

---

## Problem

The pricing page links to `/register?plan=hifz_group_4` and the plan code threads through
registration. But after login the plan is dropped — the register action sends
`/login?registered=true&plan=<code>` as a separate param, not as `?redirect=`. The login
form only reads `?redirect=`, so the plan never reaches the post-login redirect.

Additionally there is no `/subscribe` page. `POST /api/stripe/checkout` is fully built but
has no UI entry point. Students who log in with a plan intent have nowhere to land that shows
them what they are buying and lets them pay.

---

## Goal

1. Fix plan-param threading: register action → `/login?...&redirect=/subscribe?plan=<code>`
2. Build `/subscribe?plan=<code>` — a focused checkout landing page that calls
   `POST /api/stripe/checkout` and follows the Stripe Checkout redirect.

---

## User Stories

**US1 — New student checkout flow**
Visitor clicks pricing CTA → registers → login → subscribe page → pays.

**US2 — Existing student direct checkout**
Logged-in student navigates directly to `/subscribe?plan=hifz_group_4` and pays.

**US3 — Invalid / missing plan**
Page shows a friendly error if plan code is missing, unknown, or inactive.

**US4 — Already subscribed**
If POST returns 409 (hifz already active), the page surfaces a clear message.

---

## Architecture

### Files

| File | Action | Notes |
|------|--------|-------|
| `src/app/(auth)/actions.ts` | Edit | register: `?plan=<code>` → `?redirect=/subscribe?plan=<code>` |
| `src/app/subscribe/page.tsx` | Create | Server component — auth guard + plan fetch |
| `src/app/subscribe/checkout-button.tsx` | Create | Client component — POST + Stripe redirect |

### Plan-param thread (fixed)

```
/pricing                    CTA href="/register?plan=hifz_group_4"
  └─ /register?plan=...     RegisterPage reads searchParams.plan → hidden input
       └─ register()        reads formData.plan
            └─ redirect("/login?registered=true&redirect=/subscribe?plan=hifz_group_4")
                 └─ /login  LoginForm reads ?redirect → hidden input → login()
                      └─ login() isSafeRelativePath("/subscribe?plan=...") → true
                           └─ redirect("/subscribe?plan=hifz_group_4")
                                └─ /subscribe  shows plan summary + Confirm & Pay
                                     └─ POST /api/stripe/checkout {planCode}
                                          └─ Stripe Checkout URL
```

### Auth guard

`createClient()` → `auth.getUser()` server-side. If unauthenticated → redirect
`/login?redirect=/subscribe?plan=<code>`. Checkout API also enforces `requireRole("student")`.

### Layout

Standalone page — no nav chrome (focused checkout funnel). Glass design system,
bilingual Arabic/English, RTL-aware, min-h-[44px] touch targets.

---

## Security

- userId from `auth.getUser()` server-side; never from URL/input
- planCode resolved server-side from DB — client never sends price or grant size
- `isSafeRelativePath` already allows `/subscribe?plan=...` (starts with `/`, no CRLF/backslash)
- No sensitive data in URL (planCode is a stable public code, not a price)

---

## Tasks

- [x] T1 Fix register action redirect to use `?redirect=/subscribe?plan=<code>`
- [ ] T2 Create `src/app/subscribe/page.tsx`
- [ ] T3 Create `src/app/subscribe/checkout-button.tsx`
- [ ] T4 Typecheck + lint pass

---

## Decision Audit Trail

| # | Decision | Rationale |
|---|----------|-----------|
| D1 | `?redirect=/subscribe?plan=...` vs separate `?plan=` param | Login form already reads `?redirect`; minimal change, no login-form edits needed |
| D2 | Standalone `/subscribe` (not `/student/subscribe`) | Checkout funnel UX best practice — no dashboard nav chrome |
| D3 | Auth guard in server component | Defense-in-depth; middleware gates `/student/*` but `/subscribe` is outside that prefix |
| D4 | Server-side plan fetch on subscribe page | Must verify plan is real and active before showing CTA |
| D5 | Keep `success_url=/student/dashboard?subscription=success` | Already in checkout API; consistent with webhook grant flow |

## GSTACK REVIEW REPORT

**CEO:** PASS — minimal scope, right problem, threading fix is the obvious missing link.

**Eng:** PASS — no new tables/migrations; `isSafeRelativePath` already handles the path;
server-side plan fetch prevents spoofing; single-hifz guard lives in checkout API.

**Design:** PASS — glass design system, bilingual, RTL, WCAG 2.5.5 touch targets.
