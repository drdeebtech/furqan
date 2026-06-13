# 012 — Production RLS / security hardening (CodeRabbit baseline review)

**Type:** Diagnosis + fix plan. **Date:** 2026-06-12
**Lenses:** 🔒 security (primary) · 🛠 engineer (RLS/migration correctness) · 📖/🎓 (money + academic-record integrity)

## 0. Origin & guardrails

The remote-dump baseline (spec 011) made prod's years of **untracked, dashboard-applied schema**
reviewable for the first time. A CodeRabbit `--agent` review (2026-06-12, 32 findings) surfaced
real pre-existing prod issues. **These were NOT introduced by any branch** — they are prod's
current live state.

**Hard rules for every fix here:**
1. **Never edit** `supabase/migrations/20260428000000_remote_baseline.sql` or anything under
   `supabase/migrations_archive/`. The baseline must stay byte-identical to prod HEAD (spec 011).
2. Every fix ships as a **new forward migration** (timestamp after the baseline) → `db push`.
3. **Verify each finding against the live schema before fixing** — CodeRabbit reads policy text
   statically and can miss column grants / triggers (see [[feedback_verify_money_triggers_locally]]).
4. **Test locally first** against the now-faithful replica (`supabase db reset` → reproduce the
   exploit as a non-privileged role → confirm the fix blocks it) before any prod push.
5. Money/auth changes get the iterative local repro from the memory rule above.

---

## 1. P0 — VERIFIED LIVE CRITICAL: privilege escalation via `profiles` self-update

**Evidence (from the dump = prod):**
- `GRANT ALL ON TABLE "public"."profiles" TO "authenticated";` (line 9043) → UPDATE on **all**
  columns incl. `role`, `roles`. No column-scoped grant.
- `CREATE POLICY "profiles_update" … WITH CHECK (private.is_admin() OR auth.uid() = id)` (line 6957)
  → a user satisfies the check for **their own row**.
- Triggers on `profiles`: `t_profiles_upd` (set_updated_at), `t_ensure_teacher_profile`
  (AFTER UPDATE OF role — *reacts to* role changes, does not block), `t_sync_teacher_archive`
  (on deleted_at). **None prevent a role change.**

**Exploit:** any authenticated user → `PATCH /rest/v1/profiles?id=eq.<own-uid>` body `{"role":"admin"}`
→ becomes admin (and `t_ensure_teacher_profile` even provisions a teacher_profile). **Live now.**

**⚠️ CORRECTION (post-implementation review of OpenCode commit `7df92e2`):** the first cut guarded
`role OR roles` and had no service-role bypass — it **broke 5 of 7 legitimate role-write paths**.
Corrected design below.

**Role-write path inventory (the test matrix every fix must satisfy):**

| Path | File | Client | Changes | Must |
|---|---|---|---|---|
| setUserRoles / createUserFromScratch | `admin/users/actions.ts` | **service-role** | `roles[]`+`role` | allow |
| createTeacher | `admin/teachers/actions.ts` | RLS, `requireAdmin` | `roles[]`+`role` | allow |
| submitTeacherApplication | `(public)/teach-with-us/apply/actions.ts` | **service-role** | `roles[]`+`role` | allow |
| test-login (dev only) | `api/auth/test-login/route.ts` | **service-role** | `roles[]`+`role` | allow |
| **switchActiveRole** | `lib/actions/active-role.ts:90` | RLS, **non-admin** | **`role` scalar only** | allow |
| (exploit) self-escalate | PostgREST direct | authenticated | `roles[]` | **block** |

**Key insight:** the privilege is **`roles[]`** (what you hold). The scalar `role` is only the *active*
selection and is already CHECK-bounded by `profiles_active_role_in_set` (`role = ANY(roles)`), so a
non-admin can never set `role` outside their held set. Therefore **guard `roles[]` only** — guarding
`role` needlessly breaks `switchActiveRole` and adds no security.

**Corrected fix — single trigger, `roles[]`-only, with trusted-caller bypass:**
```sql
create or replace function private.guard_profiles_roles_change()
returns trigger language plpgsql security definer set search_path to 'public' as $$
declare v_jwt_role text := current_setting('request.jwt.claims', true)::jsonb ->> 'role';
begin
  if new.roles is distinct from old.roles          -- only the privilege array
     and v_jwt_role is not null                     -- NULL ⇒ direct DB / migration (trusted)
     and v_jwt_role <> 'service_role'               -- trusted server actions (admin/users, apply, test-login)
     and not private.is_admin()                     -- admin via their own session
  then raise exception 'only an admin may change roles' using errcode = '42501';
  end if;
  return new;
end $$;
-- BEFORE UPDATE OF roles ON public.profiles ...
```
- **Verify the GUC locally first:** under a service-role connection, print
  `current_setting('request.jwt.claims', true)` to confirm `role` is `service_role` there and
  `authenticated` for a user JWT (PostgREST/Supabase version differences — do not assume).
- No column-grant changes (the earlier "REVOKE UPDATE" idea is dropped — it would break
  `switchActiveRole`'s `role` write and needs fragile per-column re-granting).

**Local verification (required before push) — all 6 cases on a fresh `supabase db reset`:**
1. authenticated non-admin `set roles='{admin}'` (the exploit) → **REJECTED 42501**.
2. authenticated non-admin `set role` within held `roles[]` (switchActiveRole) → **ALLOWED** (`roles` unchanged).
3. service-role `set roles+role` (apply / admin-users / test-login) → **ALLOWED**.
4. admin-via-session `set roles+role` → **ALLOWED**.
5. authenticated non-admin self-update `full_name` → **ALLOWED**.
6. exploit variant `set role='admin'` alone (roles unchanged) → **REJECTED by existing CHECK**
   `profiles_active_role_in_set` (role ∉ roles), not the trigger — confirm it still fails.

---

## 2. P1 — security findings to VERIFY then fix (CodeRabbit-flagged, not yet confirmed)

Each needs the §0.3 verification against the live dump before authoring a migration.

| # | Finding | File (dump line) | Risk |
|---|---|---|---|
| 2.1 | `bookings_update` lets a **student self-confirm** pending→confirmed | baseline ~6339 | Students bypass teacher confirmation |
| 2.2 | `refund_package_session` (SECURITY DEFINER) callable by **any authenticated** → decrement any package | archive `…170700` (verify LIVE def in dump) | Money: package-session theft |
| 2.3 | `quiz_questions.correct_answer` readable by students via `quiz_questions_public_read` | baseline (quiz policy) | Exam integrity |
| 2.4 | `route_package_debit` trigger does a **separate UPDATE** for `student_package_id` that's lost (returns NEW) | archive `…164428` (verify LIVE def) | Money: H17-adjacent; restore may credit wrong package |
| 2.5 | `user_is_session_participant` missing `SECURITY DEFINER` | baseline ~1868 | RLS recursion / wrong eval on sessions |

**Fix posture:** each as its own forward migration; 2.2/2.4 get the iterative local money-repro
(SM-2/H17 style) before push.

## 3. P2 — correctness / robustness (lower security urgency)

| # | Finding | Note |
|---|---|---|
| 3.1 | `resources_student_via_assignment` policy compares `ra.resource_id = ra.id` (self-join bug, never correlates to outer `resources.id`) | Policy silently wrong — students may see nothing or wrong rows. Real logic bug. |
| 3.2 | `audit_log_action_check` CHECK rejects `session.webhook.*` actions written by webhook RPCs (SQLSTATE 23514) | Functional: webhook RPCs fail. Broaden the CHECK. |
| 3.3 | `sp_*` / `halaqa_waiting_list` / `session_participants` policies exclude **booking-less halaqa** sessions (only join via bookings) | Teachers of halaqa sessions locked out. |

### Verification results (2026-06-12, queried against the live local replica)

All P1/P2 findings **CONFIRMED REAL**:
- **2.1** `validate_booking_status()` validates the transition state-machine but performs **no actor
  check** (`pending→confirmed` allowed for anyone); RLS `bookings_update` lets the student update
  their own row → **student can self-confirm**. Fix: gate `*→confirmed` on `teacher_id = auth.uid()
  OR is_admin()` inside the trigger.
- **2.2** `refund_package_session` has `EXECUTE` granted to **`authenticated` AND `anon`** (plus
  service_role/postgres). Fix: `REVOKE EXECUTE … FROM anon, authenticated` (service_role only) —
  matches [[reference_supabase_secdef_execute_lockdown]]. Also confirm/insert an internal owner check.
- **2.3** `quiz_questions` grants `SELECT` to `authenticated`+`anon`; `correct_answer` is a plain
  column with no exclusion → readable by anyone who can see the row. Fix: student-facing view/RPC
  omitting `correct_answer`, or column-privilege split.
- **3.1** `resources_student_via_assignment` qual is `((ra.resource_id = ra.id) AND (ra.student_id =
  auth.uid()))` — the self-comparison never links to `resources.id`. Fix: `ra.resource_id = resources.id`.
- **3.2** `audit_log_action_check` = `CHECK (action = ANY('INSERT','UPDATE','DELETE','LOGIN','LOGOUT'))`
  → rejects `session.webhook.*` written by webhook RPCs (23514). Fix: broaden the CHECK (allow the
  `session.webhook.%` actions) — verify the exact action strings the RPCs emit first.

**P0 independently verified GREEN** (2026-06-12, local replica): exploit `roles='{admin}'` REJECTED
42501; switchActiveRole / service-role / admin-session / unrelated-column updates all ALLOWED. Migration
`728f283` is push-ready; push gated on the password rotation completing (new credential).

**Implementation batching (2026-06-12):**
- **Now (unambiguous, low-risk → OpenCode):** 2.2 (`revoke execute on refund_package_session from anon,
  authenticated`), 3.1 (recreate `resources_student_via_assignment` with `ra.resource_id = resources.id`),
  3.2 (broaden `audit_log_action_check` to allow `'session.webhook.started'`/`'session.webhook.ended'`).
- **2.1** confirm-actor guard — **VERIFIED & SCOPED (2026-06-12).** Every confirm path routes through
  `confirmBooking` → `createAdminClient()` (service-role); `validate_booking_status()` checks the
  transition state-machine but not the actor, and RLS `bookings_update` lets a student update their own
  booking → student can self-confirm. **Fix:** new forward migration `create or replace
  public.validate_booking_status()` (preserve existing attrs) adding, after the `is_admin()` bypass:
  a `→confirmed` guard requiring `request.jwt.claims.role = 'service_role'` OR `auth.uid() =
  new.teacher_id`, else raise 42501. Student cancel (`pending→cancelled`) and the state-machine stay
  intact. → dispatched to OpenCode.
- **2.3** `correct_answer` exposure — **FALSE POSITIVE / already fixed (2026-06-12), no action.**
  `quiz_questions.correct_answer` no longer exists (column absent in live schema); answers live in
  `quiz_question_keys` (the "audit C1" refactor — `quizzes.ts` writes/reads it via `createAdminClient`).
  That table has RLS enabled with `quiz_question_keys_owner_select` = `is_admin() OR course-teacher`;
  a student empirically sees **0** rows. (Optional cosmetic: the table-level `GRANT…TO anon` is
  unnecessary but not exploitable behind RLS.) [cosmetic anon revoke shipped `20260612140000`.]
- **2.4** `route_package_debit` lost-UPDATE — **NON-ISSUE / does not exist (verified 2026-06-13).**
  No `route_package_debit` in the live schema (`pg_proc` count 0); it was an archived-migration
  artifact superseded before prod. The live money path is `deduct_student_package` /
  `restore_student_package`, both **AFTER UPDATE OF status** triggers that persist the package stamp
  via an **explicit `UPDATE bookings SET student_package_id=… WHERE id=new.id`** (not a discarded
  BEFORE-trigger NEW), already hardened for #346/#363/H17 (single-kernel `deduct_package_session`,
  `FOR UPDATE SKIP LOCKED`, restore credits the same stamped package clamped ≥0). No fix needed.
- **2.5** `user_is_session_participant` missing `SECURITY DEFINER` — **DOWNGRADED to hardening;
  shipped via spec 014 (verified 2026-06-13).** `prosecdef` was `f`; used by
  `sessions.sessions_select_via_participants_v2`. A two-direction local test (INVOKER vs DEFINER,
  same authenticated `SELECT … FROM sessions`) raised **no 42P17** on this PG version and returned
  **identical results** — the predicted recursion is **not reproducible**, because
  `sp_select_self_or_teacher_or_admin`'s first clause (`user_id = auth.uid()`) already lets the
  caller read their own participant row, so INVOKER returns the correct membership boolean. The fix
  (`CREATE OR REPLACE … SECURITY DEFINER`, `STABLE`, `search_path = pg_catalog, public`) is therefore
  **defense-in-depth + consistency with `private.is_admin` + perf**, with zero behavioral change —
  not the P1 the static review predicted. Migration `20260613120000`, independently verified
  (`prosecdef=t`, scope clean, db reset + tsc green). Closes the last open spec-012 P1/P2 item.

## 4. Out of scope / skip (with reason)

- All "use ENUM instead of text+CHECK", "add tsvector index", "ON CONFLICT target", idempotency
  nits, `search_path = ''` suggestions on **archived** migrations → these are already-applied prod
  objects; rewriting archive files does nothing and diverges from prod. Track only if re-surfaced
  by a real advisor finding.
- Our `20260612004838` ayah-guard `search_path = public`: **correct as-is** (no `pg_temp` in path
  already prevents temp-object shadowing; matches the `validate_student_progress_range` sibling).
- `effects.ts` "duplicate homework.ts/follow-up.ts": **stale** — files don't exist (rename done).

## 5. Bucket A — in-scope code fixes (this branch, safe, ship now)

Separate from the prod-security track; these are our own new code:
- `src/lib/actions/follow-up.ts` — `editFollowUp` empty-string → null (match `createFollowUp`).
- `src/lib/domains/follow-up/manage.ts` — runtime number-guard on the `sn/as/ae` merge before `validateRange`.

## 6. Execution order

1. **Bucket A** (§5) — OpenCode, low risk, commit. ✅ safe to automate.
2. **P0** (§1) — author forward migration + **local exploit test**; commit; **STOP before prod push**
   (human reviews; rotate nothing, but treat as an incident-grade fix — confirm no evidence of
   prior abuse: `select id, role from profiles where role='admin'` sanity check on prod).
3. **P1** (§2) — verify each against live schema → migration + local money-repro → review → push.
4. **P2** (§3) — fold into the same hardening PR or a follow-up.

## 7. Acceptance criteria

- [ ] P0: non-admin cannot change own `role`/`roles` (trigger + column-grant), verified locally;
      legitimate self-updates and admin role changes still work; `db diff` shows only the new
      forward migration vs prod.
- [ ] No edits to the baseline dump or archive files.
- [ ] Each P1/P2 fix verified against the live definition before its migration is written.
- [ ] Money fixes (2.2, 2.4) reproduced + fixed locally with iterative SQL before push.
- [ ] `npm run sb:advisors`, `tsc`, `lint`, `test:unit` green; prod push gated on human review.

---

## 12. Adversarial review (codex gpt-5.5, 2026-06-13) — hardening pass

Independent adversarial review of the 7 forward migrations + whitelist. No live holes (empirical
re-verification held), but 3 defense-in-depth items confirmed real → harden the **undeployed**
migrations in place:

- **H1 (booking confirm, `…120004`):** guard compares `auth.uid() = NEW.teacher_id` — a mutable field.
  Bypass (student sets `teacher_id=self`) is currently blocked only by the pre-existing
  `no_self_booking` CHECK. Harden: compare `auth.uid() = OLD.teacher_id` so the guard is self-contained.
- **H2 (jsonb cast, `…120000` + `…120004`):** `current_setting('request.jwt.claims', true)::jsonb`
  throws if the GUC is an empty string. Use `nullif(current_setting('request.jwt.claims', true), '')::jsonb`.
- **H3 (audit CHECK, `…120003`):** `drop constraint audit_log_action_check` → `drop constraint if exists`
  for idempotency.

Confirmed correct (no change): refund revoke (authenticated/anon EXECUTE = false, verified), profiles
roles[] guard, editFollowUp whitelist, ayah-range guard, resources policy fix.
