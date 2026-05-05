#!/usr/bin/env bash
#
# Sprint 1.3 (2026-05-05): silent-fail tripwire.
#
# Catches new sites where Supabase query results get `?? []` or `?? null`
# defaults without an explicit `error` check upstream. This is the
# pattern that hid F1 / F13 / F14 / F15 from monitoring for weeks.
#
# Strategy: maintain a baseline file
# (`scripts/.silent-fail-baseline.txt`) with the count of existing
# offenders. CI compares the current count to the baseline; any
# increase fails the check. Existing tech debt is grandfathered;
# new debt is blocked at PR time.
#
# Usage:
#   scripts/check-silent-fail.sh        # check against baseline
#   scripts/check-silent-fail.sh --update  # rewrite baseline (use after migrating sites)

set -euo pipefail

BASELINE_FILE="scripts/.silent-fail-baseline.txt"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"

# Count silent-fail patterns: `?? []` or `?? null` on the same line as
# something that looks like Supabase data access. Heuristic — false
# positives are acceptable because the baseline absorbs them; only
# *increases* fail.
count_offenders() {
  cd "$ROOT"
  grep -rE '\?\?\s*\[\]|\?\?\s*null' src/ \
    --include='*.ts' \
    --include='*.tsx' \
    2>/dev/null \
    | grep -iE 'supabase|\.from\(|\.data|Res\.' \
    | wc -l \
    | tr -d ' '
}

current=$(count_offenders)

if [[ "${1:-}" == "--update" ]]; then
  echo "$current" > "$BASELINE_FILE"
  echo "Baseline updated to $current silent-fail sites."
  exit 0
fi

if [[ ! -f "$BASELINE_FILE" ]]; then
  echo "$current" > "$BASELINE_FILE"
  echo "Baseline created at $current silent-fail sites."
  exit 0
fi

baseline=$(cat "$BASELINE_FILE")

if [[ "$current" -gt "$baseline" ]]; then
  diff=$((current - baseline))
  cat <<EOF >&2
ERROR: silent-fail patterns increased by $diff (baseline=$baseline, current=$current).

A Supabase query result is being defaulted to \`?? []\` or \`?? null\`
without an explicit \`error\` check. This is the pattern that hid
F1, F13, F14, and F15 from monitoring for weeks during the 2026-05-05
audit.

To fix: either
  - Wrap the action with \`loudAction\` from src/lib/actions/loud.ts, OR
  - Destructure { data, error } and surface error via <ActionFeedback>.

See CLAUDE.md "No Silent Failures Policy" for the full pattern.

If the new occurrences are genuinely safe (e.g. test fixtures or a
validated edge case), update the baseline:
  scripts/check-silent-fail.sh --update
EOF
  exit 1
fi

if [[ "$current" -lt "$baseline" ]]; then
  diff=$((baseline - current))
  echo "✅ silent-fail count dropped by $diff (baseline=$baseline → current=$current)."
  echo "   Run \`scripts/check-silent-fail.sh --update\` to lock in the new lower baseline."
  exit 0
fi

echo "✅ silent-fail count steady at $current (matches baseline)."
exit 0
