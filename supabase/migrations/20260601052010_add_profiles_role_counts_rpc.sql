-- 20260601052010_add_profiles_role_counts_rpc.sql
--
-- CodeRabbit (admin/users stats): four separate count(*) queries per render are
-- replaced by one grouped scan. Admin-gated SECURITY DEFINER so it is not a
-- role-distribution oracle for non-admins.

create or replace function public.profiles_role_counts()
returns table (role text, n bigint)
language sql
security definer
set search_path = ''
as $$
  select p.role::text, count(*)::bigint
  from public.profiles p
  where (select public.is_admin())   -- non-admins get zero rows
  group by p.role;
$$;

revoke execute on function public.profiles_role_counts() from public, anon;
grant execute on function public.profiles_role_counts() to authenticated, service_role;
