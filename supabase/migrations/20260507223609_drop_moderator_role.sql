-- 20260507223609_drop_moderator_role.sql
-- Description: Remove the 'moderator' value from the user_role ENUM. Migrate
--   any existing moderator users to 'admin'. Drop the SQL helper functions
--   that referenced moderator, and rewrite the one RLS policy that hard-coded
--   the 'moderator' value. Per ADR-0003.
--
-- This migration is atomic — wrapped in a single transaction. If any step
-- fails, all roll back.
--
-- Pre-flight findings (run 2026-05-08 against prod, ref xyqscjnqfeusgrhmwjts):
--   (a) 1 moderator user (single role + array entry — same user)
--   (b) 2 user_role columns: profiles.role, profiles.roles[]
--       (idx_profiles_active and profiles_roles_gin are indexes, not columns;
--       re-evaluated automatically when column types change)
--   (c) 1 RLS policy: public.resource_assignments.resource_assignments_admin_all
--   (d) 3 functions: public.is_moderator, private.is_moderator,
--       private.is_admin_or_mod (public.is_admin_or_mod does not exist)

begin;

-- -----------------------------------------------------------------------------
-- 1. Migrate moderator users to admin — both columns updated atomically.
--    Pre-flight (a) showed exactly 1 row affected.
--
--    The 2026-05-08 first attempt split this into two UPDATEs and failed in
--    prod with `profiles_active_role_in_set` CHECK constraint violation: the
--    constraint enforces `role = ANY(roles)`, so any intermediate state where
--    role and roles[] disagree (which both possible orderings produce when
--    split) trips it. Combining into one row UPDATE means the CHECK fires
--    once on the consistent final state (role='admin', roles=['admin']).
-- -----------------------------------------------------------------------------
update public.profiles
   set role  = case when role = 'moderator'::public.user_role
                    then 'admin'::public.user_role
                    else role
               end,
       roles = (
         select array_agg(distinct
                  case when r = 'moderator'::public.user_role
                       then 'admin'::public.user_role
                       else r
                  end)::public.user_role[]
           from unnest(roles) r
       )
 where role = 'moderator'::public.user_role
    or 'moderator'::public.user_role = any(roles);

-- -----------------------------------------------------------------------------
-- 3. Drop SQL helpers that referenced moderator.
--    Pre-flight (d) confirmed: public.is_moderator, private.is_moderator,
--    private.is_admin_or_mod exist. public.is_admin_or_mod does not exist
--    (only `if exists` survives that case). Cascade clears any incidental
--    dependents not visible in the policy/column queries.
-- -----------------------------------------------------------------------------
drop function if exists public.is_moderator() cascade;
drop function if exists public.is_admin_or_mod() cascade;
drop function if exists private.is_moderator() cascade;
drop function if exists private.is_admin_or_mod() cascade;

-- -----------------------------------------------------------------------------
-- 4. Rewrite the one RLS policy that hard-coded 'moderator'.
--    Pre-flight (c): public.resource_assignments.resource_assignments_admin_all
--    (cmd ALL — both USING and WITH CHECK reference moderator).
--    Replacement: admin-only check.
-- -----------------------------------------------------------------------------
drop policy if exists resource_assignments_admin_all
  on public.resource_assignments;

create policy resource_assignments_admin_all
  on public.resource_assignments
  for all
  using (
    exists (
      select 1 from public.profiles p
       where p.id = auth.uid()
         and p.role = 'admin'::public.user_role
    )
  )
  with check (
    exists (
      select 1 from public.profiles p
       where p.id = auth.uid()
         and p.role = 'admin'::public.user_role
    )
  );

-- -----------------------------------------------------------------------------
-- 5. Recreate the user_role ENUM without 'moderator'.
-- -----------------------------------------------------------------------------
alter type public.user_role rename to user_role_old;

create type public.user_role as enum ('student', 'teacher', 'admin');

-- -----------------------------------------------------------------------------
-- 6. Migrate every column referencing user_role_old to the new user_role.
--    Pre-flight (b) confirmed: only profiles.role and profiles.roles need
--    explicit ALTERs. The two indexes are auto-maintained.
-- -----------------------------------------------------------------------------

-- profiles.role
alter table public.profiles
  alter column role drop default,
  alter column role type public.user_role
    using role::text::public.user_role,
  alter column role set default 'student'::public.user_role;

-- profiles.roles[] — array migration via text[] intermediate.
alter table public.profiles
  alter column roles type public.user_role[]
  using roles::text[]::public.user_role[];

-- -----------------------------------------------------------------------------
-- 7. Drop the old type.
-- -----------------------------------------------------------------------------
drop type public.user_role_old;

commit;

-- =============================================================================
-- POST-APPLY VERIFICATION — run in the Supabase dashboard after the migration
-- lands, to confirm the new state.
-- =============================================================================
--
-- (i) ENUM has only three values:
--   select unnest(enum_range(null::public.user_role));
--   -- Expected: student, teacher, admin
--
-- (ii) No moderator users left:
--   select count(*) from public.profiles where role::text = 'moderator';
--   -- Expected: 0
--   select count(*) from public.profiles where 'moderator' = any(roles::text[]);
--   -- Expected: 0
--
-- (iii) No SQL function still references 'moderator':
--   select n.nspname, p.proname from pg_proc p
--     join pg_namespace n on p.pronamespace = n.oid
--    where p.prosrc ilike '%moderator%'
--      and n.nspname not in ('pg_catalog', 'information_schema');
--   -- Expected: zero rows.
--
-- (iv) No RLS policy still references 'moderator':
--   select schemaname, tablename, policyname from pg_policies
--    where qual::text like '%moderator%' or with_check::text like '%moderator%';
--   -- Expected: zero rows.
--
-- (v) The rewritten resource_assignments policy still gates correctly:
--   select * from pg_policies
--    where tablename = 'resource_assignments'
--      and policyname = 'resource_assignments_admin_all';
--   -- Expected: one row, USING/WITH CHECK clauses reference 'admin' only.
