-- Fix 2.2 (spec 012 P1): revoke EXECUTE on refund_package_session from anon + authenticated.
--
-- The SECURITY DEFINER function has no internal owner check — any caller can decrement
-- sessions_used on any student_package. Zero app-side callers exist (grep confirmed);
-- the only legitimate path would be a service-role admin action.
-- Keep execute on service_role + postgres (superuser).

revoke execute on function public.refund_package_session(p_package_id uuid)
  from anon, authenticated;
