#!/usr/bin/env bash
# scripts/generate-baseline.sh — generate the migration baseline for issue #353.
#
# Run this ONCE on a machine with Docker installed (Mac mini or local Mac).
# The output is committed to supabase/migrations/00000000000000_baseline.sql
# which makes the repo self-contained from zero (DR restore / fresh-apply CI).
#
# Prerequisites:
#   - Docker running
#   - Supabase CLI installed (brew install supabase/tap/supabase or npm: npx supabase)
#   - SUPABASE_ACCESS_TOKEN set (export or pass inline)
#
# Usage:
#   SUPABASE_ACCESS_TOKEN=sbp_xxx bash scripts/generate-baseline.sh
#   # or if already logged in via `supabase login`:
#   bash scripts/generate-baseline.sh

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
OUT="${REPO_ROOT}/supabase/migrations/00000000000000_baseline.sql"

if [ -f "$OUT" ]; then
  echo "Baseline already exists at $OUT"
  echo "Delete it first if you want to regenerate."
  exit 1
fi

echo "→ Dumping schema from remote DB (requires Docker)..."
supabase db dump --linked -f "$OUT"

if [ ! -s "$OUT" ]; then
  echo "✗ Dump produced an empty file. Check Docker is running and you are linked."
  rm -f "$OUT"
  exit 1
fi

LINES=$(wc -l < "$OUT" | tr -d ' ')
echo "✓ Baseline written: $OUT ($LINES lines)"
echo ""
echo "Next steps:"
echo "  git add supabase/migrations/00000000000000_baseline.sql"
echo "  git commit -m 'fix(353): add migration baseline for fresh-apply DR guard'"
echo "  git push"
echo ""
echo "The migrations-fresh-apply CI job will go green once this lands on main."
