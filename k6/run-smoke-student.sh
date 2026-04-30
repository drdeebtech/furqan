#!/usr/bin/env bash
# ──────────────────────────────────────────────────────────────────────────────
# run-smoke-student.sh — Run the k6 student smoke test
#
# Default: pre-minted-session variant (smoke-student-app.js). Each student is
# pre-authenticated via the service-role key once, then the actual k6 run
# replays the cookies — no Supabase Auth endpoint touched during load.
# This is the smoke we want for app-side regression catching: at 500 VUs the
# pre-minted variant gives a real 100% page-success metric, whereas the
# live-auth variant trips Supabase's 429 burst limit at ~40 concurrent logins
# and reports a misleadingly-low auth-success rate.
#
# Usage:
#   ./k6/run-smoke-student.sh                    # pre-minted (default)
#   VU_COUNT=50 ./k6/run-smoke-student.sh        # limit VUs
#
# Live-auth variant — tests Supabase's /auth/v1/token endpoint as part of
# the smoke. Use when you specifically want to stress that integration:
#   LIVE_AUTH=1 ./k6/run-smoke-student.sh
#
# Prerequisites for both paths:
#   node k6/create-test-students.js   # creates students-credentials.csv
# ──────────────────────────────────────────────────────────────────────────────

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

# Default = pre-minted sessions. Defer to the dedicated runner.
if [ -z "${LIVE_AUTH:-}" ]; then
  exec "$SCRIPT_DIR/run-smoke-student-app.sh" "$@"
fi

# ── Live-auth path (LIVE_AUTH=1) ─────────────────────────────────────────────
PROJECT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

if [ -f "$PROJECT_DIR/.env.local" ]; then
  while IFS='=' read -r key value; do
    [[ -z "$key" || "$key" =~ ^# ]] && continue
    value="${value%\"}" && value="${value#\"}"
    case "$key" in
      NEXT_PUBLIC_SUPABASE_URL)      export SUPABASE_URL="${SUPABASE_URL:-$value}" ;;
      NEXT_PUBLIC_SUPABASE_ANON_KEY) export SUPABASE_ANON_KEY="${SUPABASE_ANON_KEY:-$value}" ;;
      NEXT_PUBLIC_APP_URL)           export BASE_URL="${BASE_URL:-$value}" ;;
    esac
  done < "$PROJECT_DIR/.env.local"
fi

: "${BASE_URL:=https://www.furqan.today}"
: "${SUPABASE_URL:=https://xyqscjnqfeusgrhmwjts.supabase.co}"

if [ -z "${SUPABASE_ANON_KEY:-}" ]; then
  echo "ERROR: SUPABASE_ANON_KEY is required for LIVE_AUTH=1." >&2
  echo "  Set via .env.local (NEXT_PUBLIC_SUPABASE_ANON_KEY) or environment" >&2
  exit 1
fi

if [ ! -f "$SCRIPT_DIR/students-credentials.csv" ]; then
  echo "ERROR: students-credentials.csv not found." >&2
  echo "  Create test accounts first:  node k6/create-test-students.js" >&2
  exit 1
fi

CSV_LINES=$(($(wc -l < "$SCRIPT_DIR/students-credentials.csv") - 1))
if [ "$CSV_LINES" -lt 1 ]; then
  echo "ERROR: students-credentials.csv has no data rows." >&2
  exit 1
fi

if ! command -v k6 &>/dev/null; then
  echo "ERROR: k6 is not installed.  brew install k6" >&2
  exit 1
fi

: "${VU_COUNT:=$CSV_LINES}"

cat <<INFO
╔══════════════════════════════════════════════════════════╗
║  k6 Smoke Test — Student VUs (LIVE AUTH)                 ║
╠══════════════════════════════════════════════════════════╣
║  Base URL:    ${BASE_URL}
║  Supabase:    ${SUPABASE_URL}
║  Credentials: ${CSV_LINES} students in CSV
║  VUs:         ${VU_COUNT}
║  Note:        Supabase rate-limits ~40 concurrent logins;
║               at high VU counts auth_success will degrade.
║               For app-side load coverage, drop LIVE_AUTH=1.
╚══════════════════════════════════════════════════════════╝
INFO

export BASE_URL SUPABASE_URL SUPABASE_ANON_KEY VU_COUNT

k6 run "$SCRIPT_DIR/smoke-student.js" "$@"
