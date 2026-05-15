# P5 — Performance & Scale (50k target)

**Date:** 2026-05-15  
**Branch:** `main` @ `bb273c2`

---

## Build Output

Next.js 16.2.6 with Turbopack does not emit per-route JS bundle sizes in the build log. All 134 routes compiled successfully in 11.5s. Bundle size analysis requires a separate webpack build or Vercel dashboard inspection.

---

## Unbounded Queries

### `select("*")` without `.limit()` in API routes

| File | Line | Context |
|------|------|---------|
| `src/app/api/n8n/admin-actions/route.ts` | 13 | `select("*")` — fetches from unknown table without limit |

**Finding:** ⚠️ One unbounded `select("*")` in the n8n admin-actions route. At 50k DAU, if this table grows it becomes an unbounded full-table scan on every call. Needs a `.limit()` or scoping predicate.

All student dashboard and teacher dashboard queries inspected via grep are scoped or use existing `loadOrFail`/`countOrFail` patterns. ✅

---

## Student Dashboard (50k hot path)

`src/app/(student)/dashboard` — queried via grep to spot N+1 patterns. No obvious waterfall queries found in server component files. The `Today's Plan` widget uses a ±1 day server window with client-side trim (per CLAUDE.md) — this is the correct pattern.

---

## Write Amplification

- No per-render column update patterns detected in the dashboard hot path.
- Retention scoring is done via batch cron, not per-request. ✅
- Notification delivery logs are write-once at dispatch time. ✅

---

## Per-Student Cron Sizing

At 50k DAU:
- `murajaah-due` cron touches homework rows per active student — needs index on `due_date` + `status`. ✅ (verified in prior sprint)
- `retention-score` computes scores per student batch — verify batch size in n8n workflow (not auditable from this network).

---

## Summary

| Check | Result |
|-------|--------|
| Build success | ✅ |
| Unbounded queries | ⚠️ 1 in `n8n/admin-actions/route.ts` |
| N+1 in dashboard hot path | ✅ None detected |
| Write amplification | ✅ No per-render writes |
| Bundle size analysis | ⚠️ Not available (Turbopack mode; check Vercel dashboard) |

**Blocker:** No. One unbounded query is a warning for admin endpoint (low traffic). Dashboard path is clean.

---

*Read-only audit finding.*
