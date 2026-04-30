#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

if [ -f "$PROJECT_DIR/.env.local" ]; then
  while IFS='=' read -r key value; do
    [[ -z "$key" || "$key" =~ ^# ]] && continue
    value="${value%\"}" && value="${value#\"}"
    case "$key" in
      NEXT_PUBLIC_SUPABASE_URL)      export SUPABASE_URL="${SUPABASE_URL:-$value}" ;;
      NEXT_PUBLIC_SUPABASE_ANON_KEY) export SUPABASE_ANON_KEY="${SUPABASE_ANON_KEY:-$value}" ;;
    esac
  done < "$PROJECT_DIR/.env.local"
fi

: "${BASE_URL:=https://www.furqan.today}"
: "${AUTH_DELAY_MS:=1500}"

if [ ! -f "$SCRIPT_DIR/students-credentials.csv" ]; then
  echo "ERROR: students-credentials.csv not found"
  echo "Run: node k6/create-test-students.js"
  exit 1
fi

if ! command -v node &>/dev/null; then
  echo "ERROR: node not installed"
  exit 1
fi

if ! command -v k6 &>/dev/null; then
  echo "ERROR: k6 not installed"
  exit 1
fi

echo "Preparing pre-authenticated student sessions..."
BASE_URL="$BASE_URL" AUTH_DELAY_MS="$AUTH_DELAY_MS" node "$SCRIPT_DIR/create-student-sessions.js"

if [ ! -f "$SCRIPT_DIR/student-sessions.json" ]; then
  echo "ERROR: student-sessions.json was not created"
  exit 1
fi

SESSION_COUNT=$(python3 - <<'PY'
import json
with open('/Users/drdeeb/furqan/k6/student-sessions.json') as f:
    print(len(json.load(f).get('sessions', [])))
PY
)

: "${VU_COUNT:=$SESSION_COUNT}"

echo "╔══════════════════════════════════════════════════════════╗"
echo "║  k6 App-Only Smoke Test — Pre-authenticated Students   ║"
echo "╠══════════════════════════════════════════════════════════╣"
echo "║  Base URL:    ${BASE_URL}"
echo "║  Sessions:    ${SESSION_COUNT}"
echo "║  VUs:         ${VU_COUNT}"
echo "╚══════════════════════════════════════════════════════════╝"
echo ""

export BASE_URL VU_COUNT
k6 run "$SCRIPT_DIR/smoke-student-app.js" "$@"
