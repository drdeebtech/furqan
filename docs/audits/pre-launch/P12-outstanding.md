# P12 — Outstanding Issues & Remaining Work

**Date:** 2026-05-15  
**Branch:** `main` @ `bb273c2`

---

## Open GitHub Issues (19 total)

### 🔴 Critical Bugs

| Issue | Title | Impact |
|-------|-------|--------|
| #246 ✅ | `SECURITY DEFINER` missing from `deduct_package_session` | Fixed and closed |
| #245 ✅ | Homework grade + auto-regen are NOT atomic | Fixed and closed |
| #229 ✅ | `startInstantSession` bypasses package-balance check | Fixed and closed |
| #247 ✅ | TS callers of `deduct_package_session` ignore return value | Fixed and closed |

### ⚠️ Open Enhancement / Technical Debt

| Issue | Title |
|-------|-------|
| #244 | No `UNIQUE` constraint on `bookings(teacher_id, scheduled_at)` — slot race possible |
| #243 | `student_packages.cancel_reason` normalization |
| #242 | No explicit fallback prompt when `deduct_package_session_mode` falls back to legacy |
| #241 | No view for effective package status (virtual exhausted/expired) |
| #240 | No `refund_package_session()` companion function |
| #239 | Wrap `savePackage`, `deletePackage`, `togglePackageActive` in loudAction |
| #236 | No explicit `ON DELETE` on `homework_assignments.parent_assignment_id` FK |
| #235 | No chain-depth cap on `parent_assignment_id` |
| #234 | No DB-level guard against UPDATE to completed homework rows |
| #233 | No `validate_homework_status` trigger |
| #232 | Wrap all 6 homework server actions in loudAction (5 of 6 done; 1 remaining) |
| #228 | `bookings.cancel_reason` enum + detail-text split |
| #227 | Wrap `createBooking`, `updateBookingStatus`, `recreateRoom` in loudAction |
| #185 | Regenerate Supabase types against correct account (ready-for-human) |

### Documentation

| Issue | Title |
|-------|-------|
| #248 | Correct two inaccuracies in spec 003 (booking lifecycle) |

---

## ROADMAP.md Status

| Sprint | Status |
|--------|--------|
| Sprint 1: Stripe Payment | 🔴 DB scaffolded; **blocked on STRIPE_SECRET_KEY** |
| Sprint 2: Communication Infrastructure | ✅ Shipped |
| Sprint 3–8 | Various — see ROADMAP.md |

**Sprint 1 critical path:** Install `stripe` package → uncomment sig verification in `src/app/api/stripe/webhook/route.ts` → add `STRIPE_SECRET_KEY` + `STRIPE_WEBHOOK_SECRET` to Vercel → test with `stripe listen`.

---

## db-types-fresh CI

Issue #185 (regenerate types against correct account) was closed post-audit. `src/types/database.ts` should be current. Verify with `npx supabase gen types typescript --linked` if in doubt.

---

## Summary

| Category | Count | Status |
|----------|-------|--------|
| Critical bugs | 4 | ✅ All closed (#246, #245, #229, #247) |
| Stripe integration | 1 | Blocked on keys |
| Technical debt | 11 | Enhancement/loudAction/DB guards |
| Documentation | 2 | Minor |

**Remaining before launch:**
1. Decide Stripe scope: ship stub or complete Sprint 1

---

*Read-only audit finding.*
