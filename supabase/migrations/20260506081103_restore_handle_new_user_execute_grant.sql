-- Restore EXECUTE on every auth.users trigger function to supabase_auth_admin.
--
-- Background:
-- 20260428095637_hardening_security_definer_and_rls.sql revoked EXECUTE
-- from anon + authenticated, then 20260428102110_revoke_execute_from_public_on_secdef.sql
-- revoked it from PUBLIC. The 20260428110357_restore_role_check_function_grants.sql
-- migration explicitly chose NOT to re-grant the auth-trigger functions
-- (lines 31-33), on the assumption that "trigger-only functions don't need
-- EXECUTE granted".
--
-- That assumption is wrong. Postgres requires EXECUTE permission on the
-- trigger function for the role performing the table operation, even when
-- the function is SECURITY DEFINER. The DEFINER attribute changes whose
-- privileges are used inside the function body; it does not bypass the
-- EXECUTE permission check on the function itself.
--
-- After the revoke chain, supabase_auth_admin (the role Supabase Auth uses
-- to INSERT into auth.users) lost its EXECUTE through PUBLIC. Every signup
-- since 2026-04-28 silently failed with:
--   ERROR: permission denied for function <trigger-fn>
-- which auth.users rolled back into:
--   HTTP 500 unexpected_failure: "Database error saving new user"
-- Sentry: JAVASCRIPT-NEXTJS-E4-1T (auth-signup-unexpected, captured by the
-- logError path added in PR #90).
--
-- Defensive form: rather than naming a specific function (a previous attempt
-- assumed `public.handle_new_user()` and the apply failed with "function
-- does not exist" — the schema in src/lib/supabase/schema.sql may not match
-- what's actually deployed on prod), this block introspects pg_trigger for
-- every user-defined trigger on auth.users and grants EXECUTE on its target
-- function to supabase_auth_admin. Idempotent: if no triggers exist, the
-- migration is a no-op and emits a NOTICE so CI logs surface the truth.

do $$
declare
  trg record;
  granted_count int := 0;
begin
  for trg in
    select
      n.nspname as schema_name,
      p.proname as func_name,
      pg_get_function_identity_arguments(p.oid) as args
    from pg_trigger t
    join pg_class c on c.oid = t.tgrelid
    join pg_namespace nc on nc.oid = c.relnamespace
    join pg_proc p on p.oid = t.tgfoid
    join pg_namespace n on n.oid = p.pronamespace
    where nc.nspname = 'auth'
      and c.relname = 'users'
      and not t.tgisinternal
  loop
    raise notice 'auth.users trigger fn: %.%(%) — granting EXECUTE to supabase_auth_admin',
      trg.schema_name, trg.func_name, trg.args;
    execute format(
      'grant execute on function %I.%I(%s) to supabase_auth_admin',
      trg.schema_name, trg.func_name, trg.args
    );
    granted_count := granted_count + 1;
  end loop;

  if granted_count = 0 then
    raise notice 'no user-defined triggers on auth.users — nothing to grant. The 500 must originate elsewhere (constraint, foreign-key, or downstream RLS).';
  else
    raise notice 'granted EXECUTE on % auth.users trigger function(s) to supabase_auth_admin', granted_count;
  end if;
end $$;
