#!/usr/bin/env bash
# ──────────────────────────────────────────────────────────────────────────────
# run-probes-auth-edge.sh — Run the auth-edge adversarial probe suite
#
# Sends 6 intentionally-malformed auth cookies at /student/dashboard and
# asserts middleware redirects each to /login without throwing.
#
# Usage:
#   ./k6/run-probes-auth-edge.sh                      # localhost dev server
#   BASE_URL=https://furqan-preview.vercel.app ./k6/run-probes-auth-edge.sh
# ──────────────────────────────────────────────────────────────────────────────

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

if [ -f "$PROJECT_DIR/.env.local" ]; then
  while IFS='=' read -r key value; do
    [[ -z "$key" || "$key" =~ ^# ]] && continue
    value="${value%\"}" && value="${value#\"}"
    case "$key" in
      NEXT_PUBLIC_SUPABASE_URL) export SUPABASE_URL="${SUPABASE_URL:-$value}" ;;
      NEXT_PUBLIC_APP_URL)      export BASE_URL="${BASE_URL:-$value}" ;;
    esac
  done < "$PROJECT_DIR/.env.local"
fi

BASE_URL="${BASE_URL:-http://localhost:3000}"

# Derive Supabase project ref from URL for the cookie name.
if [ -n "${SUPABASE_URL:-}" ]; then
  SUPABASE_REF="$(echo "$SUPABASE_URL" | sed -E 's|https?://([^.]+)\..*|\1|')"
  export SUPABASE_REF
fi

cat <<INFO
╔══════════════════════════════════════════════════════════╗
║  Auth-edge Adversarial Probe Suite                       ║
╠══════════════════════════════════════════════════════════╣
║  Base URL:    $BASE_URL
║  Cookie name: sb-${SUPABASE_REF:-<missing>}-auth-token
╚══════════════════════════════════════════════════════════╝
INFO

cd "$PROJECT_DIR"
exec k6 run k6/probes-auth-edge.js
