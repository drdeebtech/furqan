#!/usr/bin/env bash
# scripts/sb/tables.sh — list public tables with row counts + RLS status.
# Quick "what's in the DB?" overview.
#
# Usage:
#   bash scripts/sb/tables.sh

set -euo pipefail
source "$(dirname "$0")/_lib.sh"
require_token

SQL="
select
  c.relname as table_name,
  c.reltuples::bigint as approx_rows,
  pg_size_pretty(pg_total_relation_size(c.oid)) as total_size,
  c.relrowsecurity as rls_enabled,
  (select count(*) from pg_policies where schemaname='public' and tablename=c.relname) as policy_count
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public'
  and c.relkind = 'r'
order by pg_total_relation_size(c.oid) desc
"

sb_sql "$SQL" | pretty_json
