# P3 — Database & Migrations

**Date:** 2026-05-15  
**Branch:** `main` @ `bb273c2`

---

## Migration State

| Item | Value |
|------|-------|
| Total migration files in `supabase/migrations/` | 63 |
| Most recent migration | `20260512123700_add_daily_webhook_events_table.sql` (2026-05-12) |
| Migration drift CI | ✅ Passed 2026-05-12 |
| supabase-lint CI | ⚠️ Last run had failure on 2026-05-06 — status unknown, verify before next release |

---

## `as never` Type Casts

| Count | Status |
|-------|--------|
| 83 occurrences in `src/` (was 107 at audit; PRs #403 + #404 reduced count) | ⚠️ ADR-0002 Phase 4 migration (typed helpers) is ongoing |

Sample locations: student settings, group-session, halaqas, retention, contacts, control-tower actions.

**Finding:** 83 `as never` casts remain. Per ADR-0002, these should progressively migrate to `TableInsert<"X">` / `TableUpdate<"X">` from `src/lib/supabase/typed-helpers`. Not a runtime bug but means TypeScript doesn't catch insert/update shape mismatches.

---

## SECURITY DEFINER Functions

24 SECURITY DEFINER references found in migrations. All are **documented, intentional, and audited**:

| Migration | Purpose |
|-----------|---------|
| `20260506054344_sessions_rls_via_participants_v2.sql` | Recursion-safe RLS helper for `sessions` — breaks mutual recursion with `session_participants` |
| `20260428110357_restore_role_check_function_grants.sql` | Documents grant restoration for SECURITY DEFINER role-check functions |
| `20260506140536_teacher_can_read_student_packages.sql` | `private.teacher_has_booked_student()` — RLS bypass for teacher↔student package reads |
| `20260428102110_revoke_execute_from_public_on_secdef.sql` | Hardens by revoking `EXECUTE` from `anon` on SECURITY DEFINER functions |

**Finding:** ✅ SECURITY DEFINER usage is intentional and locked to `search_path`. No unguarded privilege escalation vectors.

**Open Issue Cross-ref:** Issue #246 — `deduct_package_session` RPC is missing `SECURITY DEFINER` from the 2026-04-28 hardening migration. This means callers using it via `rpc()` may not have correct privilege elevation. **This is a confirmed bug.**

---

## Open Database Issues (from gh issue list)

| Issue | Severity | Description |
|-------|----------|-------------|
| #246 ✅ | Bug (closed) | `SECURITY DEFINER` missing from `deduct_package_session` in 2026-04-28 migration — fixed |
| #245 ✅ | Bug (closed) | Homework grade + auto-regen are NOT atomic (separate Supabase calls at lines 257 and 294) — fixed |
| #244 | Enhancement | No `UNIQUE` constraint on `bookings(teacher_id, scheduled_at)` — slot race possible |
| #236 | Enhancement | No explicit `ON DELETE` policy on `homework_assignments.parent_assignment_id` FK |
| #234 | Enhancement | No DB-level guard against UPDATEs to completed_* homework rows |
| #233 | Enhancement | No `validate_homework_status` trigger (mirror of `validate_booking_status`) |

---

## Summary

| Check | Result |
|-------|--------|
| Migration files up to date | ✅ 63 files, most recent May 12 |
| Drift CI | ✅ Passed |
| supabase-lint CI | ⚠️ Last failure unresolved (9 days ago) |
| `as never` casts | ⚠️ 83 remaining (ADR-0002 in progress; was 107 at audit) |
| SECURITY DEFINER | ✅ All intentional + documented |
| Issue #246 (missing SECURITY DEFINER) | ✅ Fixed (closed) |
| Issue #245 (non-atomic grade+regen) | ✅ Fixed (closed) |
| Slot race (#244) | ⚠️ No UNIQUE constraint yet |

**Blocker:** No. Issues #246 and #245 were fixed and closed post-audit.

---

*Read-only audit finding.*
