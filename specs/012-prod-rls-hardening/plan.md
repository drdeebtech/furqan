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

**Fix (defense in depth — both layers):**
- **Trigger (hard guard, schema-change-proof):** `BEFORE UPDATE ON public.profiles` — if
  `NEW.role IS DISTINCT FROM OLD.role OR NEW.roles IS DISTINCT FROM OLD.roles` and
  `NOT private.is_admin()` → `raise exception … errcode 42501`. (RLS `WITH CHECK` cannot compare
  OLD vs NEW, so a trigger is required.)
- **Column privilege (fail-closed at the privilege layer):**
  `REVOKE UPDATE ON public.profiles FROM authenticated, anon;` then
  `GRANT UPDATE (<every non-role/roles column>) ON public.profiles TO authenticated;`
  Enumerate columns from the dump; add a comment that new columns need re-granting.
- Keep `anon` with **no** UPDATE.

**Local verification (required before push):**
1. `supabase db reset`; seed a non-admin user.
2. As that user's JWT, attempt `update profiles set role='admin' where id=<self>` → must be rejected
   (trigger raise *and* column-privilege denial).
3. Confirm a legitimate self-update (e.g. `full_name`) still succeeds.
4. Confirm an admin can still change roles.

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
