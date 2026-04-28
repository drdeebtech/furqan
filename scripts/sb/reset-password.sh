#!/usr/bin/env bash
# scripts/sb/reset-password.sh — trigger a password recovery email for a user.
# Wraps Supabase Auth's /recover endpoint via the public anon API.
#
# This is what Studio's "Send password recovery" button does, but from CLI.
# Email sending depends on SMTP being configured correctly (see SUPABASE_ADMIN.md).
#
# Usage:
#   bash scripts/sb/reset-password.sh someone@example.com

set -euo pipefail
source "$(dirname "$0")/_lib.sh"

EMAIL="${1:-}"
[ -n "$EMAIL" ] || die "Usage: reset-password.sh <email>"
[ -n "${SUPABASE_URL:-}" ] || die "SUPABASE_URL not loaded from .env.local"
[ -n "${SUPABASE_ANON_KEY:-}" ] || die "SUPABASE_ANON_KEY not loaded from .env.local"

info "Triggering recovery for ${EMAIL}..."
RESP="$(curl -sS -w '\nHTTP_CODE:%{http_code}' -X POST \
  -H "apikey: ${SUPABASE_ANON_KEY}" \
  -H "Content-Type: application/json" \
  "${SUPABASE_URL}/auth/v1/recover" \
  --data "$(jq -nc --arg e "$EMAIL" '{email:$e}')")"

CODE="$(echo "$RESP" | grep -oE 'HTTP_CODE:[0-9]+' | cut -d: -f2)"
BODY="$(echo "$RESP" | sed '$d')"

if [ "$CODE" = "200" ] || [ "$CODE" = "204" ]; then
  ok "Recovery request accepted (HTTP $CODE). Email send is async — check auth_audit_logs in ~10s."
  echo ""
  echo "Tail recent auth events:"
  echo "  npm run sb:errors -- 0.1   # last 6 minutes"
else
  warn "Non-success response (HTTP $CODE):"
  echo "$BODY" | pretty_json
  exit 1
fi
