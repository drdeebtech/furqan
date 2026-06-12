-- 20260515141057_refund_package_session_fn.sql
-- Closes #240.
-- Companion to deduct_package_session: decrements sessions_used by 1.
-- Used when a booking is cancelled after deduction already ran (no-show revert,
-- admin refund). SECURITY DEFINER so it runs as owner and bypasses RLS.
--
-- Returns true if refund applied (FOUND), false otherwise (sessions_used = 0
-- guard tripped, or package not found).
--
-- 2026-05-15 amendment: switched from `language sql` + `returning true` to
-- `plpgsql` + `RETURN FOUND`. The original SQL form returned an empty row set
-- on no-op, which `.rpc()` callers receive as `data: null` — indistinguishable
-- from a network error. plpgsql + FOUND gives the boolean contract the
-- function header promises. Production state corrected by 20260515171500.

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
