-- 20260601000217_add_get_user_id_by_email_rpc.sql
--
-- Audit finding H5: grantCredit resolved a student by
-- listUsers({page:1, perPage:200}) + JS .find() on email. GoTrue has no
-- server-side email filter, so past ~200 users virtually every student falls
-- outside page 1 and the money-grant feature throws "student not found" for
-- valid students. Resolve the id directly instead of page-scanning.
--
-- SECURITY DEFINER so it can read auth.users; service_role ONLY so it is not an
-- email-enumeration oracle for authenticated/anon users (the admin client uses
-- service_role).

create or replace function public.get_user_id_by_email(p_email text)
returns uuid
language sql
security definer
set search_path = ''
as $$
  select id from auth.users where lower(email) = lower(p_email) limit 1;
$$;

revoke execute on function public.get_user_id_by_email(text) from public, anon, authenticated;
grant execute on function public.get_user_id_by_email(text) to service_role;
