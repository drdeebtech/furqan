#!/usr/bin/env bash
# Migration safety guard — enforces the expand/contract rule (AGENTS.md §4).
#
# On a push to main, supabase-migrate.yml applies the migration and Vercel ships
# the new build CONCURRENTLY with no ordering gate. A breaking schema change can
# therefore take down the still-running old build (or the new build can hit the
# old schema) for a brief window. This guard fails a PR whose ADDED migration
# lines contain destructive DDL, so breaking changes are caught at review time.
#
# Each changed migration file is evaluated INDEPENDENTLY: a deliberate
# contract-phase drop opts out with a line
#     -- expand-contract-ok: <reason>
# in THAT SAME file (the marker never authorizes breakers in another file).
#
# Scope: this catches structural breakers it can detect statically. The semantic
# case in AGENTS.md — removing a value/row still read by live code — cannot be
# linted from DDL alone and remains the author's responsibility per the rule.
#
# Usage:  scripts/check-migration-safety.sh [BASE_REF]   (default: origin/main)
set -euo pipefail

BASE="${1:-origin/main}"
MIG_GLOB="supabase/migrations"

# High-signal single-statement breakers that void the running build.
BREAKERS='drop[[:space:]]+table|drop[[:space:]]+column|rename[[:space:]]+column|rename[[:space:]]+to|set[[:space:]]+not[[:space:]]+null|drop[[:space:]]+default|alter[[:space:]]+column[[:space:]]+[a-z0-9_"]+[[:space:]]+(set[[:space:]]+data[[:space:]]+)?type[[:space:]]'

violations=0
checked=0

# Process each changed migration file on its own so an acknowledgment in one
# file can never authorize a breaker in another.
while IFS= read -r f; do
  [ -z "${f}" ] && continue
  checked=$((checked + 1))

  added="$(git diff --unified=0 "${BASE}...HEAD" -- "${f}" \
            | grep -E '^\+' | grep -vE '^\+\+\+' | sed 's/^\+//' || true)"
  [ -z "${added}" ] && continue

  # Strip SQL line comments so a comment mentioning a keyword doesn't trip it.
  code="$(printf '%s\n' "${added}" | sed -E 's/--.*$//')"
  hits="$(printf '%s\n' "${code}" | grep -inE "${BREAKERS}" || true)"
  [ -z "${hits}" ] && continue

  # Acknowledged in THIS file's added lines?
  if printf '%s\n' "${added}" | grep -qiE 'expand-contract-ok:'; then
    echo "⚠ ${f}: breaking DDL acknowledged via 'expand-contract-ok:' — allowed."
    printf '   %s\n' "${hits}"
    continue
  fi

  echo "✗ ${f}: breaking DDL (expand/contract violation — AGENTS.md §4):"
  printf '   %s\n' "${hits}"
  violations=1
done < <(git diff --name-only "${BASE}...HEAD" -- "${MIG_GLOB}")

if [ "${checked}" -eq 0 ]; then
  echo "✓ No changed migration files vs ${BASE} — migration-safety guard skipped."
  exit 0
fi

if [ "${violations}" -eq 0 ]; then
  echo "✓ No unacknowledged breaking DDL across ${checked} changed migration file(s)."
  exit 0
fi

cat <<'EOF'

Migrations and the Vercel deploy run concurrently with no ordering gate, so this
can break the currently-running build. Options:
  1. Make it backward-compatible (expand): add the new column/table additively,
     migrate code to it, and DROP/RENAME the old shape in a LATER PR (contract).
  2. If this IS the contract phase (old shape no longer read by production code),
     add a line to the migration:  -- expand-contract-ok: <why it is safe now>
EOF
exit 1
