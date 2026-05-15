-- 20260515141057_refund_package_session_fn.sql
-- Closes #240.
-- Companion to deduct_package_session: decrements sessions_used by 1.
-- Used when a booking is cancelled after deduction already ran (no-show revert,
-- admin refund). SECURITY DEFINER so it runs as owner and bypasses RLS.
-- Returns true if refund applied; false (no row updated) if sessions_used = 0.

create or replace function public.refund_package_session(p_package_id uuid)
returns boolean
language sql
security definer
set search_path = public
as $$
  update student_packages
  set sessions_used = sessions_used - 1
  where id = p_package_id
    and sessions_used > 0
  returning true;
$$;

grant execute on function public.refund_package_session(uuid) to authenticated;
grant execute on function public.refund_package_session(uuid) to service_role;
