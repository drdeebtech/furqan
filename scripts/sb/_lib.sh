#!/usr/bin/env bash
# Shared helpers for scripts/sb/* — sourced, not run directly.
#
# Provides:
#   - PROJECT_REF       — Supabase project ref from supabase/config.toml
#   - SUPABASE_ACCESS_TOKEN — pulled from env/keychain or .env.local fallback
#   - SUPABASE_URL      — public project URL
#   - SUPABASE_ANON_KEY / SUPABASE_SERVICE_ROLE_KEY — read from .env.local
#   - sb_sql 'select ...'  — runs SQL via Management API, returns JSON
#   - sb_sql_file path.sql — same but from a file
#   - sb_mgmt_api METHOD path [body]  — generic Management API caller
#   - die 'message'        — print to stderr + exit 1
#   - need 'NAME'          — assert env var is set
#   - require_token        — assert SUPABASE_ACCESS_TOKEN is set
#
# Usage in scripts/sb/foo.sh:
#   #!/usr/bin/env bash
#   set -euo pipefail
#   source "$(dirname "$0")/_lib.sh"
#   require_token
#   sb_sql "select count(*) from auth.users"

set -uo pipefail

# Find repo root and config
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
CONFIG_TOML="${REPO_ROOT}/supabase/config.toml"
ENV_LOCAL="${REPO_ROOT}/.env.local"

die() { printf '\033[31m✗ %s\033[0m\n' "$*" >&2; exit 1; }
warn() { printf '\033[33m⚠ %s\033[0m\n' "$*" >&2; }
info() { printf '\033[36m→ %s\033[0m\n' "$*" >&2; }
ok() { printf '\033[32m✓ %s\033[0m\n' "$*" >&2; }

need() {
  local var="$1"
  [ -n "${!var:-}" ] || die "Missing env var: $var (check .env.local)"
}

# Project ref from config.toml
if [ -f "$CONFIG_TOML" ]; then
  # BSD sed (macOS) doesn't honor \s — use [[:space:]] for portability.
  PROJECT_REF="$(grep -E '^project_id[[:space:]]*=' "$CONFIG_TOML" | sed -E 's/.*=[[:space:]]*"([^"]+)".*/\1/' | head -1)"
fi
[ -n "${PROJECT_REF:-}" ] || die "Could not read project_id from $CONFIG_TOML"

# Load .env.local values (without exporting all of them — pull only what we need)
load_env_var() {
  local var="$1"
  if [ -f "$ENV_LOCAL" ]; then
    local val
    val="$(grep -E "^${var}=" "$ENV_LOCAL" 2>/dev/null | head -1 | cut -d= -f2- | sed 's/^"//; s/"$//; s/\\n$//')"
    if [ -n "$val" ]; then printf '%s' "$val"; return 0; fi
  fi
  printf '%s' ""
}

SUPABASE_URL="${SUPABASE_URL:-$(load_env_var NEXT_PUBLIC_SUPABASE_URL)}"
SUPABASE_ANON_KEY="${SUPABASE_ANON_KEY:-$(load_env_var NEXT_PUBLIC_SUPABASE_ANON_KEY)}"
SUPABASE_SERVICE_ROLE_KEY="${SUPABASE_SERVICE_ROLE_KEY:-$(load_env_var SUPABASE_SERVICE_ROLE_KEY)}"

# Access token: prefer env, fall back to .env.local SUPABASE_ACCESS_TOKEN.
# CLI auth (keychain) is used by `npx supabase` directly; we need a raw token
# only for direct curl-to-Management-API calls.
SUPABASE_ACCESS_TOKEN="${SUPABASE_ACCESS_TOKEN:-$(load_env_var SUPABASE_ACCESS_TOKEN)}"

require_token() {
  if [ -z "${SUPABASE_ACCESS_TOKEN:-}" ]; then
    die "SUPABASE_ACCESS_TOKEN not set. Either:
   - export SUPABASE_ACCESS_TOKEN=<your-pat> in this shell, or
   - add SUPABASE_ACCESS_TOKEN=... to .env.local
   Get a PAT at https://supabase.com/dashboard/account/tokens"
  fi
}

# Run an arbitrary SQL string via Management API. Returns JSON on stdout.
sb_sql() {
  require_token
  local sql="$1"
  curl -sS -X POST \
    -H "Authorization: Bearer ${SUPABASE_ACCESS_TOKEN}" \
    -H "Content-Type: application/json" \
    "https://api.supabase.com/v1/projects/${PROJECT_REF}/database/query" \
    --data "$(jq -nc --arg q "$sql" '{query:$q}')"
}

sb_sql_file() {
  local file="$1"
  [ -f "$file" ] || die "SQL file not found: $file"
  sb_sql "$(cat "$file")"
}

# Generic Management API call. Args: METHOD PATH [JSON_BODY]
sb_mgmt_api() {
  require_token
  local method="$1" path="$2" body="${3:-}"
  if [ -n "$body" ]; then
    curl -sS -X "$method" \
      -H "Authorization: Bearer ${SUPABASE_ACCESS_TOKEN}" \
      -H "Content-Type: application/json" \
      "https://api.supabase.com/v1${path}" --data "$body"
  else
    curl -sS -X "$method" \
      -H "Authorization: Bearer ${SUPABASE_ACCESS_TOKEN}" \
      "https://api.supabase.com/v1${path}"
  fi
}

# Pretty-print JSON if jq is available, raw otherwise.
pretty_json() {
  if command -v jq >/dev/null 2>&1; then jq .; else cat; fi
}
