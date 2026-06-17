# Implementation Plan: Attendance, Excuses & Teacher Payroll

**Branch**: `021-attendance-payroll` | **Date**: 2026-06-16 | **Spec**: [spec.md](spec.md)
**Input**: Feature specification from `specs/021-attendance-payroll/spec.md`

---

## Summary

Introduces `subscription_extensions` (Phase 0 — carry-over grants without touching the Stripe-mirror `current_period_end`), four new tables (`attendance_records`, `excuse_requests`, `session_deliveries`, `teacher_payouts`), and two SECURITY DEFINER functions (`finalize_attendance`, `run_monthly_payroll`). Reuses the existing `restore_student_package` kernel unchanged for credit restoration. All financial/outcome writes are service-role only; teacher payroll is idempotent via unique constraint on `(teacher_id, payroll_period_month)`.

---

## Technical Context

**Language/Version**: TypeScript 5 strict, Node 24, Next.js App Router  
**Primary Dependencies**: Supabase JS v2, Zod v3  
**Storage**: PostgreSQL 15 via Supabase; migrations in `supabase/migrations/` after baseline  
**Testing**: Vitest (unit), Playwright (E2E critical flows)  
**Target Platform**: Vercel serverless — all financial ops server-only  
**Constraints**: RLS every new table; service-role-only financial writes; `userId` from session; `(select auth.uid())` initplan on all policies; no hardcoded thresholds/rates; `restore_student_package` called, never redefined; `subscriptions.current_period_end` never mutated  
**Scale/Scope**: ~50k sessions/month; ~100 teacher payouts/month

---

## Constitution Check

| Gate | Status | Notes |
|------|--------|-------|
| RLS on every new table, policies in same migration | ✅ PASS | All 5 tables |
| Service-role key server-only | ✅ PASS | |
| `userId` from auth session, never request input | ✅ PASS | `student_id`/`teacher_id` always from bookings row, never body |
| Zod validation at every route handler | ✅ PASS | All 6 endpoints |
| Financial columns guarded by BEFORE UPDATE OF | ✅ PASS | `extension_seconds`, `total_amount_usd`, `hourly_rate_usd`, `duration_minutes` |
| SECURITY DEFINER EXECUTE lockdown | ✅ PASS | Both fns revoke from public/anon/authenticated |
| `restore_student_package` called, not redefined | ✅ PASS | |
| `subscriptions.current_period_end` never mutated | ✅ PASS | Extensions recorded in `subscription_extensions` only |
| `npm run db:types` + tsc + lint pass | ✅ GATE | Required before PR merge |
| Local Postgres verification | ✅ GATE | NFR-002: idempotent restore, idempotent payroll, double-finalization blocked |

---

## Project Structure

### Source Code Layout

```text
src/
├── app/api/
│   ├── attendance/
│   │   ├── record/route.ts        ← POST finalize attendance
│   │   └── [studentId]/route.ts   ← GET attendance records
│   ├── excuses/
│   │   ├── submit/route.ts        ← POST submit excuse
│   │   └── [id]/decide/route.ts   ← PATCH teacher decides
│   └── payroll/
│       ├── run/route.ts           ← POST run monthly payroll
│       └── payouts/route.ts       ← GET list payouts
└── lib/domains/attendance/
    ├── finalize.ts                ← finalize_attendance wrapper
    ├── excuses.ts                 ← excuse eligibility + submit + decide logic
    └── payroll.ts                 ← payroll run + payout query logic

supabase/migrations/
├── 20260619000000_profiles_hourly_rate.sql
│   — ALTER profiles ADD hourly_rate_usd numeric(10,2) (verified absent 2026-06-16; precondition for rate snapshot)
├── 20260619000001_subscription_extensions.sql
│   — subscription_extensions table (booking_id idempotency anchor) + RLS + BEFORE UPDATE guard + platform_settings seeds
├── 20260619000002_attendance_excuses.sql
│   — attendance_outcome / credit_action / excuse_status enums
│   — attendance_records + excuse_requests + RLS + guards
├── 20260619000003_payroll_tables.sql
│   — payout_status enum + session_deliveries + teacher_payouts + RLS + guards
└── 20260619000004_attendance_payroll_fns.sql
    — finalize_attendance() + run_monthly_payroll() SECURITY DEFINER
    — REVOKE from public/anon/authenticated; GRANT to service_role
# Timestamps 20260619xxxxxx sort after spec 020's 20260618xxxxxx (resolves 020↔021 collision)
```

---

## Key Implementation Decisions

1. **subscription_extensions (never mutate Stripe mirror)**: Carry-over grants accumulate in a separate table. Effective access end is computed as `current_period_end + SUM(extension_seconds)`. Unique index on `(subscription_id, booking_id)` makes carry-over idempotent per carried booking (`booking_id` is always present; `session_id` is nullable on bookings, verified 2026-06-16, so it cannot anchor idempotency).

2. **Attendance outcome enum**: `attendance_outcome` Postgres enum with four states; UNIQUE on `booking_id` enforces one final outcome per session. `finalize_attendance` is idempotent — second call for same booking returns without error.

3. **Excuse eligibility boundary**: Inclusive comparison (`submitted_at <= session_start - threshold`). Threshold stored in `platform_settings.excuse_notice_threshold_seconds` (default 7200). Teacher inaction at session time is not acceptance — unexcused rule applies.

4. **Rate snapshot at delivery**: `session_deliveries.hourly_rate_usd` captures the teacher's rate at the moment of delivery. Monthly payroll aggregates per teacher per month. `teacher_payouts` unique constraint on `(teacher_id, payroll_period_month)` + `ON CONFLICT DO NOTHING` makes payroll runs idempotent.

5. **restore_student_package reuse**: Existing SECURITY DEFINER function called as-is. Idempotency guard: check `attendance_records.credit_action != 'restored'` before calling — prevents double-restore on retry.

6. **Teacher absent → student held harmless**: `finalize_attendance` with `teacher_absent` outcome: restores student credit (same path as excused_carried), inserts no `session_deliveries` row for the absent teacher. Substitute teacher (if provided via `actualTeacherId`) gets the `session_deliveries` row.

---

## Artifacts

| File | Status |
|------|--------|
| research.md | ✅ Complete |
| data-model.md | ✅ Complete |
| contracts/api.md | ✅ Complete |
| quickstart.md | ✅ Complete |
| tasks.md | ⏳ Next |
