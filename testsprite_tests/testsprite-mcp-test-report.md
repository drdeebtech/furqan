# TestSprite — Consolidated Findings (FURQAN)

**Date:** 2026-06-04 · **Account:** drdeebtech@gmail.com (Starter, ~526 credits)

## TL;DR
- **Unauthenticated perimeter: validated, correct** — local + production. 0 defects.
- **Authenticated API: validated locally** via the gated test-login cookie (earlier run: TC003/004/005 passed, TC006/010 reached handlers).
- **Authenticated UI: BLOCKED by Vercel BotID — by design.** Automated browsers cannot log in. Not a defect.
- **Conclusion:** TestSprite fits the perimeter. Authenticated UI flows belong in **in-repo Playwright** with controlled Supabase session injection — NOT an external black-box runner. **Do not add a BotID bypass.**

---

## Why authenticated UI testing can't work through TestSprite
The app's auth model is structurally incompatible with an external browser-automation runner:
1. **Vercel BotID on the login form.**
   - Locally (`next start`): `checkBotId()` throws *"Must be deployed on Vercel to set response headers"* (Sentry FURQAN-32, 17 events).
   - On production: BotID's client-side check flags the headless/datacenter browser and **disables the submit button** ("تعذر التحقق من الطلب"). All 5 prod UI tests → BLOCKED at login.
2. **Supabase SSR cookies, not bearer tokens.** The app reads sessions from the `sb-<ref>-auth-token` cookie, so a standard `Authorization: Bearer <token>` (TestSprite Auto-Auth default) does not authenticate against the app's API routes. The working authenticated path was the local **test-login route returning a Set-Cookie**, which is intentionally gated off in production.

Both are correct security properties. The takeaway is to test authenticated flows where you control the session (in-repo), not to weaken the controls.

---

## Results by run

### Run 1 — Backend perimeter (local, unauth)
All 10 behaved correctly; 0 real defects. Auth gates reject forged/anon input; intentional 501 stubs (bookings, Stripe) and method/secret discipline all correct.

### Run 2 — Backend authenticated (local, via test-login cookie)
- TC003 logout ✅ · TC004 bookings 501 ✅ · TC005 bookings 501 ✅
- TC006 checkout → 501 (Stripe initiate unimplemented; auth+validation passed) ✅
- TC010 n8n admin → reached handler (admin gate passed; 500 only b/c `N8N_API_URL` unset locally) ✅

### Run 3 — Backend perimeter (production www.furqan.today, unauth)
5/5 correct: OAuth fake code → /login redirect; handoff → 410; Stripe webhook → 501; daily webhook bad-sig → **401**; cron POST → 405. (TestSprite scored 4/5; the one "fail" was its inability to forge a webhook HMAC — i.e. the gate working.)

### Run 4 — Frontend authenticated (local) — ABORTED
Failed at login on every attempt: BotID server-side throw (FURQAN-32). Stopped.

### Run 5 — Frontend authenticated (production) — BLOCKED
All 5 BLOCKED at login by BotID client-side form-disable. **No writes, no sessions established** (verified: 0 payments in the run window).

---

## Real (non-test-noise) issues found
1. **`/api/stripe/checkout` does not validate `package_id` is a UUID** — a non-uuid string reaches Postgres → `22P02` → 500 instead of a clean 400 (Sentry FURQAN-2Z). Minor input-validation gap; recommend a UUID check returning 400.
2. *(Already fixed during this work)* the test-login route's `profiles` upsert violated `CHECK (role = ANY(roles))` for non-student roles — fixed by writing `roles: [role]`.

Everything else in Sentry for the window was expected test traffic (forged codes, bad signatures, the BotID throws).

---

## Production hygiene
- **Pollution to clean:** 2 `pending` payment rows for `test-student` (`ccd0f2b0-…`), inserted by the *local* checkout test against the shared prod Supabase. Recommend deleting them.
- **Standing exposure:** `test-student` / `test-teacher` have production passwords set for the (now-infeasible) UI auth path. Recommend rotating/clearing them or deleting the test accounts, since authenticated coverage is moving in-repo.
- ⚠️ **Note:** local dev points at the **same production Supabase project** — any local write test mutates production data. Best practice: a separate Supabase project (or branch) for test writes.

## Recommended testing strategy
- **TestSprite** → unauthenticated perimeter (API), local + prod. Schedule via Web Portal Monitoring if desired.
- **In-repo Playwright** → authenticated UI journeys, with a test-env BotID disable + programmatic Supabase session cookie (team-controlled, no external creds).
- **Vitest** → server actions / units (where most business logic lives).
