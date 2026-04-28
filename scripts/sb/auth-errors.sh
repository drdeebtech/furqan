#!/usr/bin/env bash
# scripts/sb/auth-errors.sh — recent auth_audit_logs errors.
# Defaults to last 1 hour; pass a number of hours as arg (decimals OK).
#
# Usage:
#   bash scripts/sb/auth-errors.sh        # last 1 hour
#   bash scripts/sb/auth-errors.sh 24     # last 24 hours
#   bash scripts/sb/auth-errors.sh 0.1    # last 6 minutes

set -euo pipefail
source "$(dirname "$0")/_lib.sh"
require_token

HOURS="${1:-1}"

SQL="
select
  cast(timestamp as datetime) as ts,
  msg,
  metadata->>'error' as error,
  metadata->>'path' as path,
  metadata->'auth_event'->>'actor_username' as actor
from auth_audit_logs
where level = 'error'
  and timestamp > now() - interval '${HOURS} hours'
order by timestamp desc
limit 50
"

sb_sql "$SQL" | pretty_json
