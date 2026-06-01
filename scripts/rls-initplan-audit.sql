-- rls-initplan-audit.sql — READ-ONLY RLS initplan-wrap audit (issue #345, RLS-perf theme)
--
-- WHY
--   Supabase's `auth_rls_initplan` performance advisor flags RLS policies that
--   call auth.uid() / auth.role() / auth.jwt() / is_admin*() WITHOUT wrapping
--   them in a scalar sub-select, e.g.  `auth.uid() = user_id`. Unwrapped, the
--   function is re-evaluated PER ROW; wrapped as `(select auth.uid()) = user_id`
--   Postgres caches it as a one-time initplan. At 10M rows this is the
--   difference between a constant and 10M function calls per policy check —
--   the exact 50k-scale RLS concern in CLAUDE.md.
--
-- WHY THIS IS AN AUDIT, NOT A MIGRATION
--   The wrap is a *semantics-preserving* rewrite (same rows match), but the
--   authoritative current policy bodies live only in the production catalog —
--   reconstructing them from migration files is unreliable (many policies were
--   dropped/replaced by later migrations). So this script reads the LIVE
--   pg_catalog and prints each flagged policy with its real USING / WITH CHECK
--   text. The fix is then a hand-reviewed `ALTER POLICY` per row, shipped as a
--   normal migration — never a blind reconstruction.
--
-- HOW TO RUN (requires correct-account access to the furqan project — the same
--   gate as #185; the Claude/MCP-linked Supabase account is a different project
--   and cannot reach furqan):
--     supabase db execute --file scripts/rls-initplan-audit.sql --linked
--   or via psql against the pooler/direct connection string.
--
-- TRANSFORMATION RECIPE (apply per flagged row, in a new migration):
--     -- before:  using (auth.uid() = user_id)
--     -- after:   using ((select auth.uid()) = user_id)
--   Wrap EACH bare auth.uid()/auth.role()/auth.jwt()/is_admin()/is_admin_or_mod()
--   call in `(select …)`. Leave the rest of the predicate byte-identical. Then
--   ALTER POLICY <name> ON <table> USING (<wrapped>) [WITH CHECK (<wrapped>)];
--   Re-run this script after applying — flagged count should drop to 0.

with target as (
  select
    c.relname                                                          as table_name,
    p.polname                                                          as policy_name,
    case p.polcmd
      when 'r' then 'SELECT' when 'a' then 'INSERT'
      when 'w' then 'UPDATE' when 'd' then 'DELETE' when '*' then 'ALL'
    end                                                                as command,
    coalesce(
      (select array_agg(r.rolname order by r.rolname)
         from pg_roles r where r.oid = any (p.polroles)),
      array['public']
    )                                                                  as roles,
    coalesce(pg_get_expr(p.polqual,      p.polrelid), '')              as using_expr,
    coalesce(pg_get_expr(p.polwithcheck, p.polrelid), '')              as with_check_expr
  from pg_policy p
  join pg_class     c on c.oid = p.polrelid
  join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public'
),
flagged as (
  select t.*,
    -- A function is "bare" in an expression when its total occurrences exceed
    -- the occurrences already preceded by `select ` (the wrapped form). PG17's
    -- regexp_count makes this exact without needing lookbehind.
    (
      (regexp_count(using_expr,      'auth\.uid\(\)')            > regexp_count(using_expr,      'select\s+auth\.uid\(\)'))            or
      (regexp_count(using_expr,      'auth\.role\(\)')           > regexp_count(using_expr,      'select\s+auth\.role\(\)'))           or
      (regexp_count(using_expr,      'auth\.jwt\(\)')            > regexp_count(using_expr,      'select\s+auth\.jwt\(\)'))            or
      (regexp_count(using_expr,      'is_admin\(\)')             > regexp_count(using_expr,      'select\s+(public\.)?is_admin\(\)'))  or
      (regexp_count(using_expr,      'is_admin_or_mod\(\)')      > regexp_count(using_expr,      'select\s+(public\.)?is_admin_or_mod\(\)')) or
      (regexp_count(with_check_expr, 'auth\.uid\(\)')            > regexp_count(with_check_expr, 'select\s+auth\.uid\(\)'))            or
      (regexp_count(with_check_expr, 'auth\.role\(\)')           > regexp_count(with_check_expr, 'select\s+auth\.role\(\)'))           or
      (regexp_count(with_check_expr, 'auth\.jwt\(\)')            > regexp_count(with_check_expr, 'select\s+auth\.jwt\(\)'))            or
      (regexp_count(with_check_expr, 'is_admin\(\)')             > regexp_count(with_check_expr, 'select\s+(public\.)?is_admin\(\)'))  or
      (regexp_count(with_check_expr, 'is_admin_or_mod\(\)')      > regexp_count(with_check_expr, 'select\s+(public\.)?is_admin_or_mod\(\)'))
    ) as needs_initplan_wrap
  from target t
)
select table_name, policy_name, command, roles, using_expr, with_check_expr
from flagged
where needs_initplan_wrap
order by table_name, policy_name;

-- Summary line:
select count(*) as policies_needing_initplan_wrap
from (
  select 1 from pg_policy p
  join pg_class c on c.oid = p.polrelid
  join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public'
    and (
      regexp_count(coalesce(pg_get_expr(p.polqual,p.polrelid),''),      'auth\.uid\(\)')       > regexp_count(coalesce(pg_get_expr(p.polqual,p.polrelid),''),      'select\s+auth\.uid\(\)') or
      regexp_count(coalesce(pg_get_expr(p.polwithcheck,p.polrelid),''), 'auth\.uid\(\)')       > regexp_count(coalesce(pg_get_expr(p.polwithcheck,p.polrelid),''), 'select\s+auth\.uid\(\)') or
      regexp_count(coalesce(pg_get_expr(p.polqual,p.polrelid),''),      'is_admin(_or_mod)?\(\)') > regexp_count(coalesce(pg_get_expr(p.polqual,p.polrelid),''),      'select\s+(public\.)?is_admin(_or_mod)?\(\)') or
      regexp_count(coalesce(pg_get_expr(p.polwithcheck,p.polrelid),''), 'is_admin(_or_mod)?\(\)') > regexp_count(coalesce(pg_get_expr(p.polwithcheck,p.polrelid),''), 'select\s+(public\.)?is_admin(_or_mod)?\(\)')
    )
) s;
