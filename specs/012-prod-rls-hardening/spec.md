# Feature Specification: Production RLS / security hardening (CodeRabbit baseline review)

**Feature Branch**: `refactor/follow-up-collapse` *(spec 012's migrations shipped via PR #458 alongside specs 011/015/016/017; the security review that produced them ran 2026-06-12 against the freshly-captured prod baseline from spec 011)*
**Created**: 2026-06-12
**Status**: **Shipped** — all 5 forward migrations (`20260612120000`–`20260612120004`) merged to main via #458. The P0 trigger was authored, locally verified, and push-staged; subsequent adversarial review (codex gpt-5.5, plan §12) confirmed no live holes remain and produced 3 hardening items folded into the same migration set. See `plan.md` for the authoritative finding-by-finding record.

> **Speckit shape note.** Like spec 011, this is paperwork close on already-shipped infrastructure work. `plan.md` is the authoritative design record (32 CodeRabbit findings, 7 forward migrations, 1 adversarial review pass). No `tasks.md` is authored retroactively — the work is binary verification per finding, not a stack of independent user stories.

## User Scenarios & Testing *(mandatory)*

### User Story 1 — A non-admin user cannot self-escalate privileges (Priority: P0)

An authenticated user with role `student` (or any non-admin role) attempts to grant themselves admin by directly updating their own `profiles.roles[]` array via PostgREST (`PATCH /rest/v1/profiles?id=eq.<own-uid>` body `{"roles":["{admin,teacher}"]}`). The BEFORE UPDATE OF `roles` trigger raises `42501` and the write is rejected. The exploit path that existed on prod before 2026-06-12 is closed.

**Why this priority**: privilege escalation is the worst class of security bug — any authenticated user could become admin and from there access every other surface. This was the original P0 finding that motivated the whole spec.

**Independent Test**: under a fresh `supabase db reset` (which now includes the baseline dump with `profiles.roles`), simulate an authenticated non-admin JWT and run the 6-case test matrix from `plan.md` §1:
1. non-admin `set roles='{admin}'` → **REJECTED 42501**
2. non-admin `set role` within held `roles[]` (switchActiveRole) → **ALLOWED**
3. service-role `set roles+role` → **ALLOWED**
4. admin-via-session `set roles+role` → **ALLOWED**
5. non-admin self-update of `full_name` → **ALLOWED**
6. exploit variant `set role='admin'` alone → **REJECTED by existing CHECK `profiles_active_role_in_set`**

### User Story 2 — A student cannot self-confirm a pending booking (Priority: P1)

A student with a `pending` booking attempts to flip it to `confirmed` without teacher approval. The hardened `validate_booking_status()` trigger requires `request.jwt.claims.role = 'service_role'` OR `auth.uid() = NEW.teacher_id` for any transition into `confirmed`. Student cancel (`pending→cancelled`) and the rest of the state-machine remain intact.

**Why this priority**: bookings are money — a confirmed booking debits a session credit. Self-confirm lets a student get sessions without teacher approval.

**Independent Test**: as a non-teacher, attempt `UPDATE bookings SET status='confirmed' WHERE id=<own-pending-booking>` → REJECTED 42501.

### User Story 3 — Money functions are not callable by anon/authenticated (Priority: P1)

`refund_package_session` (SECURITY DEFINER) had `EXECUTE` granted to `authenticated` and `anon` — any user could call it to decrement any package. After the fix, EXECUTE is limited to `postgres` and `service_role`. The function is callable only from trusted server actions.

**Why this priority**: direct money theft vector.

**Independent Test**: `select grantee from information_schema.role_routine_grants where routine_name='refund_package_session'` returns only `postgres` and `service_role`.

### User Story 4 — RLS policies return correct rows (Priority: P2)

- `resources_student_via_assignment` policy: the original `WHERE ra.resource_id = ra.id` was a self-join bug (the qual never correlated to the outer `resources.id`) — students saw wrong rows or nothing. Fixed to `ra.resource_id = resources.id`.
- `audit_log_action_check`: the original CHECK rejected `session.webhook.*` actions, breaking webhook RPCs that wrote audit rows. Broadened to allow the full set.

**Why this priority**: correctness — these didn't expose new attack surface but they silently broke legitimate flows.

**Independent Test**: a student assigned to a resource can `SELECT` that resource; a webhook RPC that writes `audit_log.action = 'session.webhook.started'` succeeds.

### Edge Cases

- **switchActiveRole path preserved** — guarding `roles[]` only (not the scalar `role`) means users can still switch their active role within their held set. The first implementation guarded both and broke 5 of 7 role-write paths; the corrected design is `roles[]`-only.
- **Direct-DB / migration writes bypass the trigger** — `v_jwt_role IS NULL` (no JWT) is treated as trusted (migration or direct psql), so legitimate schema changes still work.
- **SECURITY DEFINER on the guard function** — required so it can call `private.is_admin()` without recursing through RLS.
- **Local-dev bootstrap gap (known limitation, separate issue)** — the `scripts/dev-local-db-bootstrap.sh` script does not currently reproduce `profiles.roles[]` from the baseline dump. Local P0 verification therefore requires either fixing the bootstrap or running against a faithful prod replica. This does NOT affect prod, where the column is present per the baseline dump (line 2948 of `20260428000000_remote_baseline.sql`) and the migration applies cleanly.

## Requirements *(mandatory)*

### FR-001 — Privilege-escalation block (P0)
A non-admin authenticated user cannot change their own `profiles.roles[]` array. Service-role writes, admin-via-session writes, and direct-DB/migration writes are exempt.

### FR-002 — Booking self-confirm block (P1)
The `*→confirmed` booking-status transition is gated on `request.jwt.claims.role = 'service_role'` OR `auth.uid() = NEW.teacher_id`. Other transitions (`pending→cancelled`, etc.) are unchanged.

### FR-003 — Money-function EXECUTE lockdown (P1)
`refund_package_session` (and any other money-mutating SECURITY DEFINER function surfaced publicly) has EXECUTE limited to `service_role` and `postgres`. `anon` and `authenticated` are revoked.

### FR-004 — RLS policy correctness (P2)
`resources_student_via_assignment` correlates the join to the outer `resources.id` (not a self-join). `audit_log_action_check` accepts the full webhook-action vocabulary.

### FR-005 — No baseline edits
No edits to `supabase/migrations/20260428000000_remote_baseline.sql` or anything under `supabase/migrations_archive/`. Every fix ships as a new forward migration with a timestamp after the baseline.

## Success Criteria

- The 6-case P0 test matrix passes on a faithful local replica (`plan.md` §1).
- A non-admin authenticated JWT cannot escalate to admin via PostgREST in production.
- A student cannot flip their own booking to `confirmed` without teacher approval.
- `refund_package_session` is callable only from service-role / postgres contexts.
- `supabase db diff --linked` against a faithful replica shows only the 5 forward migrations as the diff.
- `npm run sb:advisors` clean; no new RLS recursions or secdef advisories.

## Key Entities

- `supabase/migrations/20260612120000_guard_profiles_role_escalation.sql` — P0 trigger + `private.guard_profiles_roles_change()` SECURITY DEFINER function.
- `supabase/migrations/20260612120001_revoke_refund_package_session_from_public.sql` — P1 2.2 EXECUTE lockdown.
- `supabase/migrations/20260612120002_fix_resources_student_via_assignment.sql` — P2 3.1 policy fix.
- `supabase/migrations/20260612120003_broaden_audit_log_action_check.sql` — P2 3.2 CHECK broadening.
- `supabase/migrations/20260612120004_block_student_booking_self_confirm.sql` — P1 2.1 actor guard in `validate_booking_status()`.
- `supabase/migrations/20260613120000_session_participant_secdef.sql` — P1 2.5 (shipped via spec 014; closes the last P1).

## Out of Scope (per plan.md §4)

- ENUM-instead-of-text+CHECK nits, tsvector indexes, ON CONFLICT suggestions on archived migrations — already-applied prod objects; rewriting archive files is a no-op and diverges from prod.
- The `20260612004838` ayah-guard `search_path = public` is correct as-is (no `pg_temp` shadowing risk).
- `effects.ts` "duplicate homework.ts/follow-up.ts" — stale (rename done).
- **P2 3.3 (halaqa / `session_participants` policies excluding booking-less halaqa sessions)** — flagged in plan but not explicitly closed in the verification log. Worth verifying against the current `session_participants` policies as a follow-up; out of scope for this close.

## Open Questions

None for the close itself. The single follow-up worth tracking: P2 3.3 (halaqa policies) status against the current live schema — plan.md didn't record an explicit close.
