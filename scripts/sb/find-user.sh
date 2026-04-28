#!/usr/bin/env bash
# scripts/sb/find-user.sh — find a user by email, name, or partial match.
# Joins auth.users with public.profiles for full context.
#
# Usage:
#   bash scripts/sb/find-user.sh dr.ahmede81@yahoo.com
#   bash scripts/sb/find-user.sh ahmed
#   bash scripts/sb/find-user.sh sokar

set -euo pipefail
source "$(dirname "$0")/_lib.sh"
require_token

QUERY="${1:-}"
[ -n "$QUERY" ] || die "Usage: find-user.sh <email-or-name>"

# Escape single quotes for SQL safety (parameterized queries via mgmt API
# would be nicer but the endpoint takes a plain query string).
ESCAPED="${QUERY//\'/\'\'}"

SQL="
select
  u.id,
  u.email,
  u.email_confirmed_at,
  u.last_sign_in_at,
  u.created_at,
  p.full_name,
  p.role,
  p.is_active,
  p.deleted_at
from auth.users u
left join public.profiles p on p.id = u.id
where u.email ilike '%${ESCAPED}%'
   or p.full_name ilike '%${ESCAPED}%'
   or u.id::text = '${ESCAPED}'
order by u.created_at desc
limit 25
"

sb_sql "$SQL" | pretty_json
