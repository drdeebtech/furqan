# TestSprite AI Testing Report (MCP) — PRODUCTION

---

## 1️⃣ Document Metadata
- **Project Name:** furqan
- **Date:** 2026-06-03
- **Prepared by:** TestSprite AI Team
- **Target:** **LIVE PRODUCTION** — `https://www.furqan.today` (apex `furqan.today` 307-redirects to www)
- **Scope:** Unauthenticated perimeter only (TC001, TC002, TC007, TC008, TC009)
- **Why perimeter-only:** The test-login affordance is **gated off in production by design** (`NODE_ENV=production` + `VERCEL=1`), so no session can be obtained against prod and no write path can fire. Verified live: `POST /api/auth/test-login` → 404 in prod mode even with the correct secret.

### Outcome
| Result | Count |
|--------|-------|
| Endpoints behaving correctly | **5 / 5** |
| TestSprite-marked pass | 4 / 5 |
| Real defects | **0** |

TestSprite reported 80% (4/5). The one "fail" (TC008) is TestSprite being unable to forge a valid HMAC signature — production correctly rejected it with 401, which is the desired security property.

---

## 2️⃣ Requirement Validation Summary

### Requirement: Authentication & Session (perimeter)
#### TC001 — GET /api/auth/callback/google
- **Status:** ✅ Passed
- **Findings:** Forged `code` → 3xx redirect to `/login?error=oauth_exchange_failed`. A fake code never reaches `/dashboard`. **Production auth callback correct.**

#### TC002 — GET /api/auth/handoff/[code]
- **Status:** ✅ Passed
- **Findings:** Random code → **410 Gone**. One-time handoff codes correctly invalid. **Correct.**

### Requirement: Payments (perimeter)
#### TC007 — POST /api/stripe/webhook
- **Status:** ✅ Passed
- **Findings:** **501** — webhook hard-disabled by design in production too, so unsigned payloads can never grant a paid package. Fails closed. **Correct.**

### Requirement: Video / Automation Webhooks
#### TC008 — POST /api/webhooks/daily
- **Status:** ❌ Marked Failed → ✅ **Correct production behavior**
- **Test Error:** `Expected 200 OK but got 401 {"error":"invalid_signature"}`
- **Findings:** The test ("valid signature") tried the 200 happy path but **cannot compute a valid HMAC without `DAILY_WEBHOOK_SECRET`** (which only the server and Daily.co hold). Production correctly rejected the invalid signature with **401**. This 401 is exactly the security boundary working — an unauthorized party cannot forge a webhook. The assertion's expected 200 is unreachable by design, and should be. **Not a defect; the opposite — proof the HMAC gate holds.** (Note: locally this same endpoint returned 500 because the secret was unset; production's 401 is the healthy state.)

### Requirement: Cron / Scheduled Jobs
#### TC009 — POST /api/cron/audit-cleanup
- **Status:** ✅ Passed
- **Findings:** **405 Method Not Allowed** — route is GET-only (n8n triggers via GET with dual secrets `CRON_SECRET` + `X-N8N-Secret`). POST correctly rejected. **Correct.**

---

## 3️⃣ Coverage & Matching Metrics

| Endpoint | Prod response | Correct? |
|---|---|---|
| GET /api/auth/callback/google (fake code) | 3xx → /login?error | ✅ |
| GET /api/auth/handoff/[fake] | 410 Gone | ✅ |
| POST /api/stripe/webhook | 501 (hard-disabled) | ✅ |
| POST /api/webhooks/daily (bad sig) | 401 invalid_signature | ✅ |
| POST /api/cron/audit-cleanup (POST) | 405 Method Not Allowed | ✅ |

- **Perimeter endpoints validated:** 5/5 correct
- **Forged-input rejection confirmed in production:** OAuth code, handoff code, webhook signature, cron method — all rejected
- **Write paths reachable anonymously:** 0 (every mutation requires a session unobtainable in prod)

---

## 4️⃣ Key Gaps / Risks

**Zero production defects. The live perimeter is sound.** Every endpoint that should reject anonymous/forged traffic does so, and there is no anonymous path to any write.

**Notable production-vs-local difference (healthy):**
- `/api/webhooks/daily`: **prod → 401** (secret configured, bad signature rejected) vs **local → 500** (secret unset). Production is the correct, secure state. This reinforces the earlier local recommendation: locally set `DAILY_WEBHOOK_SECRET`, and optionally return **503** (not 500) for the missing-config branch so a config gap is distinguishable from a real internal error.

**Confirmed security property:** the test-login route is provably inert in production — live check returned **404** in prod mode with a valid secret, because `NODE_ENV=production` (and `VERCEL=1` on deploys) gate it off. Authenticated API coverage is therefore intentionally only available locally.

**Coverage boundary:** Black-box prod testing validates the API/auth perimeter only. Business logic in server actions (`src/lib/actions/**`) and authenticated flows are covered by the local TestSprite run (see `testsprite-mcp-test-report.md`), Vitest, and Playwright.

**Recommendation:** keep production TestSprite runs scoped to this perimeter set. Never run authenticated or state-mutating tests against `www.furqan.today` — at 50k-user scale, synthetic writes (payments, bookings) would pollute real data. The local test-login + dev-server path is the correct place for authenticated coverage.

---

*Live perimeter pre-verified by direct request before and corroborated by the TestSprite run. Apex→www redirect (307) accounted for by targeting the www host directly.*
