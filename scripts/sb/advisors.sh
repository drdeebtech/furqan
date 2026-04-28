#!/usr/bin/env bash
# scripts/sb/advisors.sh — run Supabase's built-in security + performance advisors.
# Equivalent to Studio → Advisors page, but from CLI.
#
# Usage:
#   bash scripts/sb/advisors.sh           # both security + performance
#   bash scripts/sb/advisors.sh security
#   bash scripts/sb/advisors.sh performance

set -euo pipefail
source "$(dirname "$0")/_lib.sh"

KIND="${1:-all}"

run_kind() {
  local k="$1"
  echo ""
  echo "═══ ${k^^} ADVISORS ═══"
  npx supabase db advisors --linked --type "$k" 2>&1 | head -200
}

case "$KIND" in
  all)         run_kind security; run_kind performance ;;
  security)    run_kind security ;;
  performance) run_kind performance ;;
  *) die "Unknown kind: $KIND (use security|performance|all)" ;;
esac
