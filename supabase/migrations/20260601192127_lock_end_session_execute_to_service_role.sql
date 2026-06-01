-- 20260601192127_lock_end_session_execute_to_service_role.sql
--
-- Follow-up to #368: fully lock down end_session_with_booking EXECUTE.
--
-- The original migration (20260601165807) did `revoke ... from public` + grant
-- to service_role, mirroring confirm_booking_with_session. But Supabase's
-- default privileges grant EXECUTE on new public functions directly to `anon`
-- and `authenticated` (not via PUBLIC), so the revoke-from-public left those
-- intact — verified in prod: authenticated_exec=true, anon_exec=true.
--
-- Since this is a SECURITY DEFINER function (runs as owner, bypasses RLS), a
-- logged-in (or even anonymous) user could POST /rest/v1/rpc/
-- end_session_with_booking to end an arbitrary session. The function is only
-- ever invoked server-side via the service-role admin client (the session-end
-- orchestrator), so revoking end-user roles is safe and closes the bypass.

revoke execute on function public.end_session_with_booking(uuid, int) from anon, authenticated;
grant  execute on function public.end_session_with_booking(uuid, int) to service_role;

-- NOTE (separate, pre-existing finding — out of scope for this fix):
-- confirm_booking_with_session, deduct_package_session, deduct_student_package,
-- refund_package_session and other SECURITY DEFINER functions share the same
-- posture (authenticated_exec=true) because of the same Supabase default-grant
-- behaviour. A platform-wide EXECUTE audit + lockdown should be tracked
-- separately; this migration only closes the function #368 introduced.
