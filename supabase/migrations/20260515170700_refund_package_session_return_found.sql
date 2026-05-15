-- Fix: refund_package_session returned an empty row set (rather than `false`)
-- when sessions_used = 0. `.rpc()` callers received `data: null` —
-- indistinguishable from a network error.
--
-- Switch to `language plpgsql` + `RETURN FOUND` so the function honors the
-- boolean contract its header comment promises.
--
-- Migration 20260515141057 has also been amended in place (same change) so
-- fresh-environment replays land on the correct definition.

create or replace function public.refund_package_session(p_package_id uuid)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
begin
  update student_packages
  set sessions_used = sessions_used - 1
  where id = p_package_id
    and sessions_used > 0;
  return found;
end;
$$;

grant execute on function public.refund_package_session(uuid) to authenticated;
grant execute on function public.refund_package_session(uuid) to service_role;
