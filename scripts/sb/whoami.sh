#!/usr/bin/env bash
# scripts/sb/whoami.sh — show who you are, what's linked, recent activity.
# Use as a sanity check before running anything destructive.
#
# Usage: bash scripts/sb/whoami.sh

set -euo pipefail
source "$(dirname "$0")/_lib.sh"

echo "═══ Supabase admin context ═══"
echo "Project ref:    ${PROJECT_REF}"
echo "Supabase URL:   ${SUPABASE_URL:-<not set>}"
echo "Token in env:   $([ -n "${SUPABASE_ACCESS_TOKEN:-}" ] && echo "yes (len=${#SUPABASE_ACCESS_TOKEN})" || echo "NO — direct curl calls won't work")"
echo "Anon key:       $([ -n "${SUPABASE_ANON_KEY:-}" ] && echo "loaded (len=${#SUPABASE_ANON_KEY})" || echo "missing")"
echo "Service role:   $([ -n "${SUPABASE_SERVICE_ROLE_KEY:-}" ] && echo "loaded (len=${#SUPABASE_SERVICE_ROLE_KEY})" || echo "missing")"
echo ""
echo "═══ CLI auth (keychain-stored) ═══"
npx supabase projects list 2>&1 | head -10 || warn "supabase projects list failed — try 'npx supabase login' first"
echo ""
if [ -n "${SUPABASE_ACCESS_TOKEN:-}" ]; then
  echo "═══ Recent auth activity (last 5 events) ═══"
  sb_sql "select cast(timestamp as datetime) as ts, msg, level from auth_audit_logs order by timestamp desc limit 5" 2>/dev/null | pretty_json
fi
