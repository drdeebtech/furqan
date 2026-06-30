#!/usr/bin/env bash
# Migration safety guard — enforces the expand/contract rule (AGENTS.md §4).
#
# On a push to main, supabase-migrate.yml applies the migration and Vercel ships
# the new build CONCURRENTLY with no ordering gate. A breaking schema change can
# therefore take down the still-running old build (or the new build can hit the
# old schema) for a brief window. This guard fails a PR whose ADDED migration
# lines contain destructive DDL, so breaking changes are caught at review time.
#
# Deliberate contract-phase drops (the code that used the old shape is already
# gone from production) are allowed: add a line
#     -- expand-contract-ok: <reason>
# to the migration. The marker is a conscious acknowledgment, not a bypass.
#
# Usage:  scripts/check-migration-safety.sh [BASE_REF]   (default: origin/main)
set -euo pipefail

BASE="${1:-origin/main}"
MIG_GLOB="supabase/migrations"

# Added lines (excluding the +++ file header) in changed migration files.
# --unified=0 keeps context out so we only see genuinely added SQL.
added="$(git diff --unified=0 "${BASE}...HEAD" -- "${MIG_GLOB}" \
          | grep -E '^\+' | grep -vE '^\+\+\+' | sed 's/^\+//' || true)"

if [ -z "${added}" ]; then
  echo "✓ No added migration lines vs ${BASE} — migration-safety guard skipped."
  exit 0
fi

# Strip SQL line comments so a comment mentioning "drop column" doesn't trip it.
code="$(printf '%s\n' "${added}" | sed -E 's/--.*$//')"

# High-signal single-statement breakers that void the running build.
BREAKERS='drop[[:space:]]+table|drop[[:space:]]+column|rename[[:space:]]+column|rename[[:space:]]+to|set[[:space:]]+not[[:space:]]+null|drop[[:space:]]+default'

hits="$(printf '%s\n' "${code}" | grep -inE "${BREAKERS}" || true)"

if [ -z "${hits}" ]; then
  echo "✓ No breaking DDL in added migration lines."
  exit 0
fi

# Acknowledged contract-phase change? The marker must appear in the added lines.
if printf '%s\n' "${added}" | grep -qiE 'expand-contract-ok:'; then
  echo "⚠ Breaking DDL found but acknowledged via 'expand-contract-ok:' — allowed."
  printf '%s\n' "${hits}"
  exit 0
fi

echo "✗ Breaking DDL in this migration (expand/contract violation — AGENTS.md §4):"
printf '%s\n' "${hits}"
cat <<'EOF'

Migrations and the Vercel deploy run concurrently with no ordering gate, so this
can break the currently-running build. Options:
  1. Make it backward-compatible (expand): add the new column/table additively,
     migrate code to it, and DROP/RENAME the old shape in a LATER PR (contract).
  2. If this IS the contract phase (old shape no longer read by production code),
     add a line to the migration:  -- expand-contract-ok: <why it is safe now>
EOF
exit 1
