-- 20260726000000_class_offerings_role_gate.sql
--
-- Security fix (MEDIUM): the "teacher rw own offerings" RLS policy on
-- public.class_offerings gated ONLY on `teacher_id = auth.uid()` with NO role
-- predicate. Because it is a PERMISSIVE policy for ALL commands, any
-- authenticated user (e.g. a student) could INSERT/UPDATE a row with
-- teacher_id = their own uid — self-publishing a paid group class that is then
-- listed to real students via "student read open offerings". (IDOR / missing
-- RBAC at the data layer; principles #2, #4.)
--
-- Fix: recreate the policy so the owner must ALSO hold the 'teacher' role,
-- mirroring the app-layer requireRole(["teacher","admin"]) gate now enforced in
-- createOffering(). Admins/moderators keep full access via the SEPARATE
-- "admin mod manage offerings" policy (is_admin_or_mod()); since RLS policies
-- are OR'd, this policy only needs the teacher predicate. Ownership
-- (teacher_id = auth.uid()) is preserved.
--
-- Role source: profiles.roles (the authoritative role SET — how the app
-- authorizes teachers via requireRole), not the single active `role` column,
-- so a multi-role teacher is not falsely blocked. The inline
-- EXISTS(... profiles WHERE id = auth.uid()) pattern matches the existing
-- admin policies in the baseline (a user can always read their own profile row).
--
-- expand-contract-ok: DROP POLICY IF EXISTS is immediately followed by CREATE
-- POLICY of the same name within one transaction (no window). This only
-- TIGHTENS access — legitimate teachers (roles ∋ 'teacher') are unaffected;
-- only non-teachers, who never had a legitimate reason to write here, are
-- blocked. Safe to deploy concurrently with the running build.

drop policy if exists "teacher rw own offerings" on public.class_offerings;

create policy "teacher rw own offerings" on public.class_offerings
  using (
    teacher_id = (select auth.uid())
    and exists (
      select 1
      from public.profiles p
      where p.id = (select auth.uid())
        and 'teacher'::public.user_role = any (p.roles)
    )
  )
  with check (
    teacher_id = (select auth.uid())
    and exists (
      select 1
      from public.profiles p
      where p.id = (select auth.uid())
        and 'teacher'::public.user_role = any (p.roles)
    )
  );
