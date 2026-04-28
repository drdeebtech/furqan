#!/usr/bin/env bash
# scripts/sb/sql.sh — run a SQL query against prod via Management API.
#
# This bypasses RLS (runs as postgres role). It's the equivalent of opening
# Studio's SQL Editor, but from your terminal. Use with care.
#
# Usage:
#   bash scripts/sb/sql.sh "select count(*) from auth.users"
#   bash scripts/sb/sql.sh < query.sql
#   echo "select now()" | bash scripts/sb/sql.sh
#   bash scripts/sb/sql.sh -f path/to/query.sql

set -euo pipefail
source "$(dirname "$0")/_lib.sh"
require_token

SQL=""
if [ "${1:-}" = "-f" ] && [ -n "${2:-}" ]; then
  SQL="$(cat "$2")"
elif [ -n "${1:-}" ]; then
  SQL="$1"
elif [ ! -t 0 ]; then
  SQL="$(cat)"
else
  die "No SQL provided. Pass as arg, via stdin, or -f path/to/file.sql"
fi

[ -n "$SQL" ] || die "Empty SQL"

sb_sql "$SQL" | pretty_json
