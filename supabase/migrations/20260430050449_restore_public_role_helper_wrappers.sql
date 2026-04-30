-- Restore thin public.* wrappers for the role-check helpers.
--
-- Migration 20260428203550 moved the canonical role helpers into the
-- `private` schema (security improvement — keeps the function bodies off
-- the public API). Subsequent V17 feature migrations (modules, quizzes,
-- forum, study_log, help center, resources) were written referencing
-- `public.is_admin()` and `public.is_admin_or_mod()`, so we re-introduce
-- thin SECURITY DEFINER wrappers that delegate to the private helpers.
--
-- The wrappers add no policy logic — they exist purely so RLS policies in
-- migrations authored after the move can keep their `public.is_admin()`
-- shorthand. The actual role check still happens inside `private.*`, which
-- still owns the profiles lookup.

create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select private.is_admin()
$$;

create or replace function public.is_admin_or_mod()
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select private.is_admin_or_mod()
$$;

create or replace function public.is_moderator()
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select private.is_moderator()
$$;

revoke execute on function public.is_admin()         from public;
revoke execute on function public.is_admin_or_mod()  from public;
revoke execute on function public.is_moderator()     from public;

grant execute on function public.is_admin()         to anon, authenticated, service_role;
grant execute on function public.is_admin_or_mod()  to anon, authenticated, service_role;
grant execute on function public.is_moderator()     to anon, authenticated, service_role;
