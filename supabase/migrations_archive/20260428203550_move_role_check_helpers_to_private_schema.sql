-- Move role-check helpers (is_admin, is_admin_or_mod, is_moderator) out of
-- the `public` schema into a new `private` schema, to silence the Supabase
-- advisor's `anon_security_definer_function_executable` and
-- `authenticated_security_definer_function_executable` warnings.
--
-- Background:
-- Supabase's PostgREST gateway exposes every function in the `public` schema
-- as `/rest/v1/rpc/<name>`. SECURITY DEFINER functions in public are therefore
-- callable by any role that has EXECUTE — including anon and authenticated.
-- The advisor flags this as a security concern (best-practice anti-pattern).
--
-- For these three role-check helpers specifically, we *must* keep EXECUTE
-- granted to anon + authenticated, because they are called from RLS policy
-- USING/WITH CHECK clauses across ~25+ policies (legal_documents, site_faqs,
-- site_features, site_blog_categories, teacher_picklists, retention_signals,
-- automation_logs, packages, parent_reports, session_evaluations,
-- session_observers, session_notes_history, platform_settings, ...).
-- Revoking EXECUTE breaks RLS — we already learned that the hard way at
-- 2026-04-28T11:00 (commit 462ac35 had to grant it back).
--
-- The clean fix: move the functions to a non-public schema. PostgREST does
-- not expose non-public schemas (its `db.schemas` config defaults to public
-- only), so the REST RPC endpoint disappears. RLS evaluation happens inside
-- Postgres and uses the function's OID, not its schema-qualified name —
-- ALTER FUNCTION ... SET SCHEMA preserves the OID, so every existing policy
-- continues to reference the same function in its new home without any
-- per-policy edits.

-- ─────────────────────────────────────────────────────────────────────────
-- 1. Create the private schema and grant USAGE (required for callers to
--    execute functions inside it, even with EXECUTE on the function itself).
-- ─────────────────────────────────────────────────────────────────────────
create schema if not exists private;

grant usage on schema private to anon, authenticated, service_role;

-- ─────────────────────────────────────────────────────────────────────────
-- 2. Move the three role-check helpers out of public.
--    Their OID is preserved, so all existing RLS policies that reference
--    them keep working without modification. Idempotent: only moves if the
--    function still exists in public (no-op if already moved, e.g. on a
--    Branching preview that already has this migration applied).
-- ─────────────────────────────────────────────────────────────────────────
do $$
declare
  fn_name text;
begin
  foreach fn_name in array array['is_admin', 'is_admin_or_mod', 'is_moderator']
  loop
    if exists (
      select 1 from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public'
        and p.proname = fn_name
        and pg_get_function_identity_arguments(p.oid) = ''
    ) then
      execute format('alter function public.%I() set schema private', fn_name);
      raise notice 'Moved public.%() → private.%()', fn_name, fn_name;
    else
      raise notice 'Skipped public.%() — not found in public (already moved?)', fn_name;
    end if;
  end loop;
end $$;

-- ─────────────────────────────────────────────────────────────────────────
-- 3. Re-affirm EXECUTE grants in the new location.
--    Existing grants on the function survive SET SCHEMA, but stating them
--    explicitly here makes this migration self-contained — applying it on
--    a fresh database (e.g. a Supabase Branching preview) produces the
--    same end state without depending on a prior grant migration.
-- ─────────────────────────────────────────────────────────────────────────
grant execute on function private.is_admin()        to anon, authenticated, service_role;
grant execute on function private.is_admin_or_mod() to anon, authenticated, service_role;
grant execute on function private.is_moderator()    to anon, authenticated, service_role;

-- Tighten: explicitly deny `public` (the implicit pseudo-role) — defense
-- against future PUBLIC grants accidentally widening exposure.
revoke execute on function private.is_admin()        from public;
revoke execute on function private.is_admin_or_mod() from public;
revoke execute on function private.is_moderator()    from public;

-- ─────────────────────────────────────────────────────────────────────────
-- 4. Sanity check: assert all three functions are now in `private` and
--    that no policy still references them via `public.<name>` (which
--    would only be possible if a policy had a schema-qualified reference,
--    in which case the OID-preservation trick wouldn't help).
-- ─────────────────────────────────────────────────────────────────────────
do $$
declare
  fn_count int;
  bad_policy_count int;
begin
  -- Functions should now live in 'private', not 'public'
  select count(*) into fn_count
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'private'
    and p.proname in ('is_admin', 'is_admin_or_mod', 'is_moderator');

  if fn_count <> 3 then
    raise exception 'Expected 3 role-check functions in private schema, found %', fn_count;
  end if;

  -- No remaining functions in `public` with these names
  select count(*) into fn_count
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public'
    and p.proname in ('is_admin', 'is_admin_or_mod', 'is_moderator');

  if fn_count <> 0 then
    raise exception 'Found % stale role-check functions still in public schema', fn_count;
  end if;

  -- Check no policies reference public.is_admin etc. by literal text — a
  -- belt-and-braces guard for the rare case a policy was written with
  -- schema-qualified `public.is_admin()` rather than unqualified.
  select count(*) into bad_policy_count
  from pg_policies
  where qual ilike '%public.is_admin%'
     or qual ilike '%public.is_admin_or_mod%'
     or qual ilike '%public.is_moderator%'
     or with_check ilike '%public.is_admin%'
     or with_check ilike '%public.is_admin_or_mod%'
     or with_check ilike '%public.is_moderator%';

  if bad_policy_count > 0 then
    raise warning 'Found % policies with literal public.<helper>() references — these may need manual update to private.<helper>()', bad_policy_count;
  end if;

  raise notice 'Role-check helpers moved to private schema. % policies reference these (verified callable).',
    (select count(*) from pg_policies
     where qual ilike '%is_admin(%'
        or qual ilike '%is_admin_or_mod(%'
        or qual ilike '%is_moderator(%'
        or with_check ilike '%is_admin(%'
        or with_check ilike '%is_admin_or_mod(%'
        or with_check ilike '%is_moderator(%');
end $$;
