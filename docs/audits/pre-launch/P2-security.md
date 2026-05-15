# P2 — Security Surface

**Date:** 2026-05-15  
**Branch:** `main` @ `bb273c2`

---

## dangerouslySetInnerHTML (5 instances)

| File | Line | Content | Risk |
|------|------|---------|------|
| `src/components/seo/structured-data.tsx` | 15, 50, 90, 107 | `JSON.stringify(schema)` in `<script type="application/ld+json">` | ✅ Low — server-side schema objects, not user input; ld+json not executed as JS |
| `src/components/admin/remote-handoff-button.tsx` | 154 | `state.qrSvg` — QR code SVG from server-generated handoff token | ⚠️ Review — QR SVG generated server-side but ensure it flows through a trusted path only |

**Finding:** 4 of 5 are the standard JSON-LD SEO pattern — safe. The QR SVG in `remote-handoff-button.tsx` is worth confirming the SVG is generated entirely server-side with no user-influenced content.

---

## Timing-Safe Comparisons

### Routes still using local `timingSafeEqual` (not yet migrated to `safeCompareSecret`)

| File | Pattern |
|------|---------|
| `src/app/api/retention/score/route.ts` | Inline `timingSafeEqual` wrapper |
| `src/app/api/reports/session/[id]/route.ts` | Inline `timingSafeEqual` wrapper |
| `src/app/api/reports/session/[id]/send/route.ts` | Inline `timingSafeEqual` wrapper |

**Finding:** ⚠️ These 3 routes define their own local `safeCompare()` helper instead of importing `safeCompareSecret` from `@/lib/security/secrets`. Functionality is equivalent but inconsistent — if the canonical implementation changes (e.g., constant-time length padding), these won't pick it up.

### Routes using safeCompareSecret correctly

All 9 dedicated cron routes + `webhooks/n8n` + `sentry-watch/notify` + `n8n/auto-restart` use `safeCompareSecret` from the shared library. ✅

### HMAC verification (appropriate local usage)

- `src/lib/bunny/client.ts` — Bunny.net HMAC; correct
- `src/lib/daily/webhook-verify.ts` — Daily.co HMAC; correct
- Both are webhook signature verifiers that must own their algorithm — not candidates for migration.

---

## Cron Route Auth Coverage

10 cron routes exist. All have both CRON_SECRET and N8N_WEBHOOK_SECRET dual-auth:

```
audit-cleanup:          CRON=7 N8N=4  ✅
auto-complete-sessions: CRON=7 N8N=4  ✅
bunny-stuck-lessons:    CRON=6 N8N=4  ✅
cache-clear:            CRON=6 N8N=3  ✅
email-health:           CRON=7 N8N=3  ✅
handoff-cleanup:        CRON=7 N8N=4  ✅
murajaah-due:           CRON=7 N8N=4  ✅
n8n-healthcheck:        CRON=7 N8N=3  ✅
reconciliation:         CRON=7 N8N=3  ✅
retention-score:        CRON=2 N8N=1  ✅ (single-check, still auth-gated)
```

---

## process.env in src/app/ (non-NEXT_PUBLIC)

43 references. These are all in server components / API routes — not client components. No client-side env leakage detected.

---

## Summary

| Check | Result |
|-------|--------|
| dangerouslySetInnerHTML | ⚠️ Review QR SVG path in `remote-handoff-button.tsx` |
| Cron route dual-auth | ✅ All 10 routes protected |
| timingSafeEqual migration | ⚠️ 3 routes still use local wrappers (non-critical) |
| console.log in API routes | ✅ Zero |
| process.env client leakage | ✅ No non-NEXT_PUBLIC vars in client components |

**Blocker:** No. No critical security gaps. QR SVG + 3 stale wrappers are warnings only.

---

*Read-only audit finding.*
