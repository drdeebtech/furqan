#!/usr/bin/env bash
# ──────────────────────────────────────────────────────────────────────────────
# run-smoke-all.sh — Run smoke tests for every role + the auth-edge probes
#
# Sequence:
#   1. Auth-edge adversarial probes (k6/probes-auth-edge.js) — fast, ~5s
#   2. Student smoke (pre-minted variant by default)
#   3. Teacher smoke (smoke-role.js with TEACHER_ROUTES)
#   4. Admin smoke (smoke-role.js with ADMIN_ROUTES)
#   5. Moderator smoke (smoke-role.js with MODERATOR_ROUTES)
#
# Each step is independent; if one fails the script keeps going so the
# operator gets a complete picture of what's broken.
#
# Prerequisites:
#   - .env.local has SUPABASE_URL + SUPABASE_ANON_KEY + SUPABASE_SERVICE_ROLE_KEY
#   - Test users provisioned. To bootstrap:
#       node k6/create-test-students.js
#       ROLE=teacher    COUNT=20 EMAIL_PREFIX=k6-teacher    OUTPUT=teachers-credentials.csv    node k6/create-test-role-users.js
#       ROLE=admin      COUNT=5  EMAIL_PREFIX=k6-admin      OUTPUT=admins-credentials.csv      node k6/create-test-role-users.js
#       ROLE=moderator  COUNT=3  EMAIL_PREFIX=k6-moderator  OUTPUT=moderators-credentials.csv  node k6/create-test-role-users.js
#
# Usage:
#   ./k6/run-smoke-all.sh                   # localhost, default VU counts
#   BASE_URL=https://furqan-preview.vercel.app ./k6/run-smoke-all.sh
# ──────────────────────────────────────────────────────────────────────────────

set -uo pipefail   # NOT -e — we want to continue on per-step failures

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
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

: "${BASE_URL:=http://localhost:3000}"
: "${SUPABASE_URL:=https://xyqscjnqfeusgrhmwjts.supabase.co}"

# Route lists per role. Subset of full pages per role; smoke goal is breadth
# of coverage, not exhaustive crawl.
TEACHER_ROUTES='["/teacher/dashboard","/teacher/availability","/teacher/students","/teacher/sessions","/teacher/homework","/teacher/courses","/teacher/cv","/teacher/messages","/teacher/notifications","/teacher/settings"]'

ADMIN_ROUTES='["/admin/dashboard","/admin/users","/admin/teachers","/admin/bookings","/admin/sessions","/admin/evaluations","/admin/packages","/admin/payments","/admin/notifications","/admin/control-tower","/admin/automation","/admin/n8n","/admin/retention","/admin/audit","/admin/settings"]'

MODERATOR_ROUTES='["/moderator/dashboard","/moderator/users","/moderator/cv-review","/moderator/sessions","/moderator/evaluations","/moderator/audit"]'

# ── Reporting helpers ───────────────────────────────────────────────────────
PASS_COUNT=0
FAIL_COUNT=0
SKIP_COUNT=0
declare -a STEP_RESULTS

run_step() {
  local name="$1"
  shift
  echo ""
  echo "════════════════════════════════════════════════════════════"
  echo "  STEP: $name"
  echo "════════════════════════════════════════════════════════════"
  if "$@"; then
    PASS_COUNT=$((PASS_COUNT + 1))
    STEP_RESULTS+=("✓ $name")
    return 0
  else
    FAIL_COUNT=$((FAIL_COUNT + 1))
    STEP_RESULTS+=("✗ $name")
    return 1
  fi
}

skip_step() {
  local name="$1"
  local why="$2"
  SKIP_COUNT=$((SKIP_COUNT + 1))
  STEP_RESULTS+=("- $name (skipped: $why)")
  echo ""
  echo "  [SKIP] $name — $why"
}

# ── Step runners ────────────────────────────────────────────────────────────
run_auth_edge() {
  BASE_URL="$BASE_URL" "$SCRIPT_DIR/run-probes-auth-edge.sh"
}

run_student() {
  BASE_URL="$BASE_URL" "$SCRIPT_DIR/run-smoke-student.sh"
}

run_role_smoke() {
  local role="$1"
  local routes="$2"
  local csv="${role}s-credentials.csv"

  if [ ! -f "$SCRIPT_DIR/$csv" ]; then
    skip_step "$role smoke" "$csv missing — run create-test-role-users.js"
    return 0
  fi

  ROLE="$role" \
    ROUTES="$routes" \
    CREDENTIALS_CSV="$csv" \
    BASE_URL="$BASE_URL" \
    SUPABASE_URL="$SUPABASE_URL" \
    SUPABASE_ANON_KEY="$SUPABASE_ANON_KEY" \
    k6 run "$SCRIPT_DIR/smoke-role.js"
}

# ── Main ────────────────────────────────────────────────────────────────────
echo "╔══════════════════════════════════════════════════════════╗"
echo "║  Furqan Smoke Suite — All Roles + Auth-Edge Probes       ║"
echo "╠══════════════════════════════════════════════════════════╣"
echo "║  Base URL:    ${BASE_URL}"
echo "║  Supabase:    ${SUPABASE_URL}"
echo "╚══════════════════════════════════════════════════════════╝"

run_step "auth-edge probes"      run_auth_edge       || true
run_step "student smoke"         run_student         || true
run_step "teacher smoke"         run_role_smoke teacher   "$TEACHER_ROUTES"   || true
run_step "admin smoke"           run_role_smoke admin     "$ADMIN_ROUTES"     || true
run_step "moderator smoke"       run_role_smoke moderator "$MODERATOR_ROUTES" || true

echo ""
echo "════════════════════════════════════════════════════════════"
echo "  SUMMARY"
echo "════════════════════════════════════════════════════════════"
for r in "${STEP_RESULTS[@]}"; do
  echo "  $r"
done
echo "  ──────────────────────────────────────────────────────────"
echo "  passed=$PASS_COUNT  failed=$FAIL_COUNT  skipped=$SKIP_COUNT"
echo "════════════════════════════════════════════════════════════"

[ "$FAIL_COUNT" -eq 0 ]
