-- Wrap bare is_admin() / private.is_admin() calls in RLS policy predicates with a
-- scalar subselect `(select ...)` so Postgres evaluates the STABLE SECURITY
-- DEFINER admin check once per query (as an InitPlan) instead of once per row.
-- This clears the remaining `auth_rls_initplan` Supabase advisor findings that
-- 20260615150000_rls_initplan_optimize.sql began; that migration wrapped 24
-- policies, but the baseline plus every table added since re-introduced the
-- per-row pattern (~99 policies across ~50 tables at time of writing).
--
-- PURE PERFORMANCE. `(select is_admin())` returns the identical boolean as
-- `is_admin()` in a policy predicate — the wrap changes evaluation strategy,
-- never the access decision.
--
-- Why a dynamic block instead of hand-written ALTER POLICY statements:
--   * It reads each policy's CURRENT definition from the catalog at apply time
--     (pg_get_expr), so it rewrites THIS database's real predicates — never a
--     transcribed copy that could drift from what is actually deployed.
--   * It only ever inserts `(select ...)` around an is_admin() token; the rest
--     of every predicate is preserved byte-for-byte by construction.
--   * It is idempotent: once a predicate reads `(select ... is_admin())` the
--     already-wrapped guard skips it, so re-running is a no-op (safe to replay).
--   * Function-body is_admin() calls (in trigger/guard functions) are untouched
--     — this only alters pg_policy rows.
--
-- expand-contract-ok: alters only RLS policy predicate evaluation strategy;
-- the access decision is unchanged, so old and new code both see identical RLS
-- behaviour during the concurrent migrate+deploy window.

do $$
declare
  r record;
  v_using text;
  v_check text;
  v_clauses text;
  v_count int := 0;
begin
  for r in
    select n.nspname as sch,
           c.relname as tbl,
           p.polname as pol,
           pg_get_expr(p.polqual, p.polrelid)      as using_expr,
           pg_get_expr(p.polwithcheck, p.polrelid) as check_expr
    from pg_policy p
    join pg_class c     on c.oid = p.polrelid
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public'
  loop
    v_clauses := '';

    -- USING: rewrite only when it calls is_admin() and is not already wrapped.
    -- The already-wrapped guard (`SELECT ... is_admin`) prevents any double-wrap,
    -- which is also what makes the whole migration idempotent.
    if r.using_expr is not null
       and r.using_expr ~ 'is_admin\(\)'
       and r.using_expr !~ 'SELECT[^)]*is_admin' then
      v_using := regexp_replace(
        r.using_expr, '(private\.)?is_admin\(\)', '(select \1is_admin())', 'g');
      v_clauses := v_clauses || format(' using (%s)', v_using);
    end if;

    -- WITH CHECK: same treatment.
    if r.check_expr is not null
       and r.check_expr ~ 'is_admin\(\)'
       and r.check_expr !~ 'SELECT[^)]*is_admin' then
      v_check := regexp_replace(
        r.check_expr, '(private\.)?is_admin\(\)', '(select \1is_admin())', 'g');
      v_clauses := v_clauses || format(' with check (%s)', v_check);
    end if;

    if v_clauses <> '' then
      execute format('alter policy %I on %I.%I', r.pol, r.sch, r.tbl) || v_clauses;
      v_count := v_count + 1;
      raise notice 'initplan-wrapped is_admin in policy %.%.%', r.sch, r.tbl, r.pol;
    end if;
  end loop;

  raise notice 'rls_is_admin_initplan_wrap: % policies updated', v_count;
end $$;
