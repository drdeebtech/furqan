-- 20260507223609_drop_moderator_role.sql
-- Description: Remove the moderator role from FURQAN's role taxonomy. Per ADR-0003.
--
-- This file documents the SQL that was applied directly to prod via
-- `supabase db query --linked` on 2026-05-08 after two PR-driven attempts
-- failed in production:
--
--   Attempt 1 (split UPDATEs): tripped profiles_active_role_in_set CHECK
--   constraint (`role = ANY(roles)`) — intermediate state had role and
--   roles[] disagreeing.
--
--   Attempt 2 (combined UPDATE + ENUM recreate): tripped Postgres's
--   "cannot alter type of a column used in a policy definition" — 20+
--   RLS policies depend on profiles.role.
--
-- This pragmatic version sidesteps the ENUM-recreate cascade entirely:
-- the 'moderator' value remains in user_role as a dead union member,
-- but is unreachable due to CHECK constraints on profiles.role and roles[].
-- Legacy is_moderator() always returns false; is_admin_or_mod() collapses
-- to admin-only (preserving the function symbols so 13+ dependent policies
-- on sessions, student_packages, study_log, ijazah, mentorship, storage,
-- etc. don't get cascade-dropped).
--
-- Migration tracker (`supabase_migrations.schema_migrations`) was hand-
-- inserted with version 20260507223609 after the direct apply, so future
-- `supabase db push --include-all` runs see this as already applied and
-- skip it. This file in the repo matches what is in prod.

begin;

-- 1. Migrate moderator users to admin — both columns updated atomically so
--    the profiles_active_role_in_set CHECK (role = ANY(roles)) sees a
--    consistent final state. Splitting into two statements fails because
--    either ordering leaves a moment where role and roles[] disagree.
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

-- 2. Replace function bodies (NOT drop with cascade — that would auto-drop
--    13+ dependent policies on sessions, student_packages, study_log,
--    ijazah_progress, mentorship, storage objects, etc.).
--    is_moderator() now always returns false; is_admin_or_mod() collapses
--    to admin-only. Dependent policies keep working with their moderator
--    branches dead.
create or replace function private.is_moderator() returns boolean
  language sql stable
  set search_path to 'public', 'pg_temp'
as $$ select false $$;

create or replace function private.is_admin_or_mod() returns boolean
  language sql stable
  set search_path to 'public', 'pg_temp'
as $$
  select exists(
    select 1 from public.profiles
     where id = (select auth.uid())
       and role = 'admin'::public.user_role
       and deleted_at is null
       and is_active = true
  )
$$;

-- 3. Rewrite the one RLS policy that hardcoded 'moderator' in its
--    expression (the others reference 'role' generally and don't need
--    edits — they continue to work via the redefined functions).
drop policy if exists resource_assignments_admin_all on public.resource_assignments;
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

-- 4. Add CHECK constraints to make the 'moderator' ENUM value unreachable.
--    Future inserts/updates that try to set role='moderator' or include
--    'moderator' in roles[] will fail with constraint violation.
alter table public.profiles
  drop constraint if exists profiles_role_no_moderator;
alter table public.profiles
  add constraint profiles_role_no_moderator
  check (role <> 'moderator'::public.user_role);

alter table public.profiles
  drop constraint if exists profiles_roles_no_moderator;
alter table public.profiles
  add constraint profiles_roles_no_moderator
  check (not ('moderator'::public.user_role = any(roles)));

commit;

-- =============================================================================
-- POST-APPLY VERIFICATION (run in the Supabase dashboard after this migration
-- lands, to confirm the new state):
-- =============================================================================
--
-- (i) No moderator users left:
--   select count(*) from public.profiles
--    where role::text = 'moderator' or 'moderator' = any(roles::text[]);
--   -- Expected: 0
--
-- (ii) is_moderator() always returns false:
--   select private.is_moderator();  -- Expected: false
--
-- (iii) CHECK constraints in place:
--   select conname from pg_constraint
--    where conrelid = 'public.profiles'::regclass and conname like '%moderator%';
--   -- Expected: profiles_role_no_moderator, profiles_roles_no_moderator
--
-- (iv) ENUM still has 'moderator' (intentional — pragmatic path):
--   select unnest(enum_range(null::public.user_role));
--   -- Expected: student, teacher, admin, moderator (last is unreachable)
