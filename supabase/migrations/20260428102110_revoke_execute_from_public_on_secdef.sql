-- 20260428102110_revoke_execute_from_public_on_secdef.sql
-- Follow-up to 20260428095637_hardening_security_definer_and_rls.
--
-- That migration revoked EXECUTE on SECURITY DEFINER functions from `anon`
-- and `authenticated`, but Postgres grants `EXECUTE ... TO PUBLIC` by default
-- on every CREATE FUNCTION. `anon` and `authenticated` inherit through
-- PUBLIC, so the explicit revoke was a no-op against effective privilege.
-- Verified with `has_function_privilege(role, oid, 'execute')` after the
-- first migration: still true for all seven functions / both roles.
--
-- Fix: also revoke from PUBLIC. After this, /rest/v1/rpc/<fn> calls from
-- anon/authenticated should 401/404.
--
-- Internal use unaffected: trigger contexts and RLS predicate evaluation
-- run as the table owner / `postgres`, which retains EXECUTE.

revoke execute on function public.is_admin()                          from public;
revoke execute on function public.is_admin_or_mod()                   from public;
revoke execute on function public.is_moderator()                      from public;
revoke execute on function public.handle_new_user()                   from public;
revoke execute on function public.ensure_teacher_profile()            from public;
revoke execute on function public.sync_teacher_archive_with_profile() from public;

do $$
begin
  if exists (
    select 1 from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'rls_auto_enable'
  ) then
    execute 'revoke execute on function public.rls_auto_enable() from public';
  end if;
end $$;
