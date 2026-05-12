#!/usr/bin/env bash
#
# Register the Daily.co webhook for FURQAN session lifecycle events.
#
# Use this instead of the Daily.co dashboard — the dashboard webhook UI has
# moved around over the years and is hidden on some plan tiers. The REST API
# is always available as long as DAILY_API_KEY is set.
#
# Behaviour:
#   1. Lists existing webhooks; aborts if one already points at our URL.
#   2. Generates a 32-byte hex HMAC secret if DAILY_WEBHOOK_SECRET is unset.
#   3. POSTs to https://api.daily.co/v1/webhooks with our event types.
#   4. Prints the secret value with paste-ready commands for Vercel + GitHub.
#
# Usage:
#   DAILY_API_KEY=dk_... ./scripts/register-daily-webhook.sh
#
# Optional overrides:
#   WEBHOOK_URL=https://staging.furqan.today/api/webhooks/daily ...
#   DAILY_WEBHOOK_SECRET=<reuse-existing> ...
#
# Refs: spec 008 US1 (T003), spec 007 webhook receiver.

set -euo pipefail

WEBHOOK_URL="${WEBHOOK_URL:-https://www.furqan.today/api/webhooks/daily}"
API_KEY="${DAILY_API_KEY:?DAILY_API_KEY must be set — find it in Vercel → Settings → Environment Variables}"
SECRET="${DAILY_WEBHOOK_SECRET:-$(openssl rand -hex 32)}"

echo "==> Listing existing webhooks on the Daily.co account..."
existing=$(curl -sS -H "Authorization: Bearer $API_KEY" https://api.daily.co/v1/webhooks)
echo "$existing" | (command -v jq >/dev/null && jq . || cat)

if echo "$existing" | grep -F -q "\"$WEBHOOK_URL\""; then
  echo
  echo "⚠️  A webhook for $WEBHOOK_URL already exists."
  echo "    Either delete it first (DELETE https://api.daily.co/v1/webhooks/<uuid>)"
  echo "    or reuse its existing secret via Daily.co support."
  exit 1
fi

echo
echo "==> Registering webhook: $WEBHOOK_URL"
response=$(curl -sS -X POST https://api.daily.co/v1/webhooks \
  -H "Authorization: Bearer $API_KEY" \
  -H "Content-Type: application/json" \
  -d "{
    \"url\": \"$WEBHOOK_URL\",
    \"eventTypes\": [\"meeting.started\", \"meeting.ended\", \"participant.joined\", \"participant.left\"],
    \"hmac\": \"$SECRET\"
  }")

echo "$response" | (command -v jq >/dev/null && jq . || cat)

if ! echo "$response" | grep -q '"uuid"'; then
  echo
  echo "❌ Registration appears to have failed. See the Daily.co response above."
  exit 2
fi

cat <<EOF

=================================================================
✅ Webhook registered.

Now propagate this secret to two places so the receiver can verify
signatures and CI can exercise the handler.

  DAILY_WEBHOOK_SECRET=$SECRET

  1. Vercel:    Project → Settings → Environment Variables
                Add as Production (and Preview if desired).
                Trigger a redeploy after saving.

  2. GitHub:    gh secret set DAILY_WEBHOOK_SECRET --body "$SECRET"

Verify with a test session: open a room, leave after >5 minutes, and
confirm sessions.ended_at populates within 60s. Detailed verification
steps: specs/008-ops-debt-cleanup/tasks.md T006-T007.
=================================================================
EOF
