-- Fix: add SECURITY DEFINER so deduct_package_session runs as the function
-- owner (postgres) rather than the calling role. Without this, the authenticated
-- role may not have UPDATE rights on student_packages rows it doesn't own,
-- causing silent financial deduction failures.
--
-- Also adds service_role grant for n8n/admin callers.
-- Closes issue #246.

create or replace function public.deduct_package_session(p_package_id uuid)
returns boolean
language sql
security definer
set search_path = public
as $$
  update student_packages
  set sessions_used = sessions_used + 1
  where id = p_package_id
    and status = 'active'
    and sessions_used < sessions_total
    and (expires_at is null or expires_at > now())
  returning true;
$$;

grant execute on function public.deduct_package_session(uuid) to authenticated;
grant execute on function public.deduct_package_session(uuid) to service_role;
