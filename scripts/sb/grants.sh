#!/usr/bin/env bash
# scripts/sb/grants.sh — audit EXECUTE grants on public functions.
# Useful when an RLS policy throws "permission denied for function X" —
# this shows which roles can execute which functions.
#
# Background: on 2026-04-28 a security-hardening migration revoked EXECUTE
# from is_admin / is_admin_or_mod / is_moderator and broke RLS across
# many tables. This script makes that class of bug instantly visible.
#
# Usage:
#   bash scripts/sb/grants.sh                  # all SECURITY DEFINER funcs
#   bash scripts/sb/grants.sh broken-only      # only those with no exec grants

set -euo pipefail
source "$(dirname "$0")/_lib.sh"
require_token

FILTER="${1:-all}"

WHERE_CLAUSE=""
if [ "$FILTER" = "broken-only" ]; then
  WHERE_CLAUSE="having not has_function_privilege('authenticated', p.oid, 'EXECUTE')"
fi

SQL="
select
  p.proname as function_name,
  pg_get_function_identity_arguments(p.oid) as args,
  case p.prosecdef when true then 'DEFINER' else 'INVOKER' end as security,
  has_function_privilege('anon', p.oid, 'EXECUTE')          as anon,
  has_function_privilege('authenticated', p.oid, 'EXECUTE') as authenticated,
  has_function_privilege('service_role', p.oid, 'EXECUTE')  as service_role
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and p.prosecdef = true
group by p.oid, p.proname
${WHERE_CLAUSE}
order by p.proname
"

sb_sql "$SQL" | pretty_json
