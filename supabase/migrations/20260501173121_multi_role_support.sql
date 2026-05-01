-- 20260501173121_multi_role_support.sql
-- Description: Add `roles user_role[]` to profiles so a single user can hold
-- multiple roles (student / teacher / admin / moderator). The existing
-- `profiles.role` column is retained as the user's *active* role — the one
-- that gates RLS and decides which dashboard they're currently in. The new
-- `roles` array is the SET of roles they're allowed to switch into via the
-- topbar role-switcher.
--
-- Active-context semantic (locked in 2026-05-01 design): is_admin() and
-- friends keep reading `profiles.role` unchanged, so this migration is
-- additive — zero RLS-helper churn, zero policy edits required.
--
-- Backfill: every existing user gets `roles = ARRAY[role]`, so single-role
-- behaviour is byte-identical to today (topbar dropdown only renders when
-- roles.length > 1).

-- 1. Add the column. Nullable for now so the backfill can populate it.
alter table public.profiles add column if not exists roles user_role[];

-- 2. Backfill from the existing single role. Idempotent: only fills NULLs.
update public.profiles
set roles = array[role]::user_role[]
where roles is null;

-- 3. Lock down: NOT NULL + active role must be a member of the set.
--    Once we enforce this, any future write that drops the active role from
--    `roles` without also updating `role` will fail loudly — which is what
--    we want, since silent demotion to an unprivileged role is dangerous.
alter table public.profiles alter column roles set not null;

alter table public.profiles
  drop constraint if exists profiles_active_role_in_set;
alter table public.profiles
  add constraint profiles_active_role_in_set
  check (role = any(roles));

-- 4. GIN index so the route gate (proxy.ts) can resolve
--    `'teacher' = any(roles)` cheaply on every authenticated request.
create index if not exists profiles_roles_gin
  on public.profiles using gin (roles);

-- Sanity: every row should now have a non-null roles array containing at
-- least the active role.
do $$
declare
  bad_count int;
begin
  select count(*) into bad_count from public.profiles where roles is null;
  if bad_count > 0 then
    raise exception 'profiles.roles backfill incomplete: % rows still null', bad_count;
  end if;

  select count(*) into bad_count
  from public.profiles
  where not (role = any(roles));
  if bad_count > 0 then
    raise exception 'profiles_active_role_in_set violated by % rows', bad_count;
  end if;

  raise notice 'multi_role_support migration applied: profiles.roles backfilled, CHECK constraint and GIN index in place';
end $$;
