-- Spec 016 / cursor-bot HIGH (verified live): public.public_profiles is a postgres-owned,
-- non-security_invoker auto-updatable view over profiles, granted ALL to anon+authenticated.
-- Via Supabase REST that lets anon enumerate every profile (PII) and UPDATE/DELETE arbitrary
-- rows, bypassing profiles RLS (owner-rights view). Restore the archived control: revoke all,
-- grant SELECT to authenticated only. service_role/postgres unaffected. View kept owner-rights
-- (NOT security_invoker) on purpose — it is a controlled non-PII projection the 13 authenticated
-- callers rely on; security_invoker would re-impose relationship-scoped profiles RLS and break them.
revoke all on table public.public_profiles from anon;
revoke all on table public.public_profiles from authenticated;
grant select on table public.public_profiles to authenticated;
