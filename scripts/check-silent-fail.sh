#!/usr/bin/env bash
#
# Sprint 1.3 (2026-05-05): silent-fail tripwire.
# Spec 006 (2026-05-09): extended to catch .single() error-drop pattern.
#
# Catches two anti-patterns that propagated across PRs and hid
# infrastructure failures from monitoring:
#
#   (1) Supabase query results defaulted with `?? []` / `?? null`
#       without an explicit `error` check. Hid F1 / F13 / F14 / F15
#       from monitoring for weeks during the 2026-05-05 audit.
#
#   (2) `.single()` / `.maybeSingle()` destructuring that drops the
#       `error` variable: `const { data: x } = await supabase...single()`.
#       This makes RLS regressions / network blips / Postgres restarts
#       surface as "row not found" to users without reaching Sentry.
#       Pattern fixed across PRs 18-20; spec 006 (PR #270) makes it
#       structurally impossible going forward.
#
# Strategy: maintain a baseline file per pattern with the count of
# existing offenders. CI compares the current count to the baseline;
# any increase fails the check. Existing tech debt is grandfathered;
# new debt is blocked at PR time.
#
# Usage:
#   scripts/check-silent-fail.sh           # check against baselines
#   scripts/check-silent-fail.sh --update  # rewrite both baselines

set -euo pipefail

BASELINE_FILE="scripts/.silent-fail-baseline.txt"
SINGLE_BASELINE_FILE="scripts/.single-error-drop-baseline.txt"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"

# Count silent-fail-default patterns: `?? []` or `?? null` on the same
# line as something that looks like Supabase data access. Heuristic —
# false positives are acceptable because the baseline absorbs them;
# only *increases* fail.
count_default_offenders() {
  cd "$ROOT"
  grep -rE '\?\?\s*\[\]|\?\?\s*null' src/ \
    --include='*.ts' \
    --include='*.tsx' \
    2>/dev/null \
    | grep -iE 'supabase|\.from\(|\.data|Res\.' \
    | wc -l \
    | tr -d ' '
}

# Count .single()/.maybeSingle() destructures that drop `error`.
# Pattern matches: `{ data: <var> } = await <chain>.single()` (or
# .maybeSingle()) with no `, error:` capture.
#
# Allowlist (does NOT match by regex shape, but documented for clarity):
#   - { data: x, error: xErr } = ...   — `}` not immediately after var
#   - { data: { user } } = await supabase.auth.getUser()  — different shape
#   - { data: pub } = supabase.storage....getPublicUrl()  — no .single() suffix
count_single_offenders() {
  cd "$ROOT"
  grep -rE '\{\s*data:\s*\w+\s*\}\s*=\s*await\s+.+\.(single|maybeSingle)\(\)' src/ \
    --include='*.ts' \
    --include='*.tsx' \
    2>/dev/null \
    | wc -l \
    | tr -d ' '
}

current_default=$(count_default_offenders)
current_single=$(count_single_offenders)

if [[ "${1:-}" == "--update" ]]; then
  echo "$current_default" > "$BASELINE_FILE"
  echo "$current_single" > "$SINGLE_BASELINE_FILE"
  echo "Baselines updated:"
  echo "  ?? []/null sites:        $current_default"
  echo "  .single() error-drops:   $current_single"
  exit 0
fi

# Initialise baselines on first run.
if [[ ! -f "$BASELINE_FILE" ]]; then
  echo "$current_default" > "$BASELINE_FILE"
  echo "Default-pattern baseline created at $current_default sites."
fi
if [[ ! -f "$SINGLE_BASELINE_FILE" ]]; then
  echo "$current_single" > "$SINGLE_BASELINE_FILE"
  echo ".single() error-drop baseline created at $current_single sites."
  exit 0
fi

baseline_default=$(cat "$BASELINE_FILE")
baseline_single=$(cat "$SINGLE_BASELINE_FILE")
exit_code=0

# ----- Check 1: ?? [] / ?? null defaults -----
if [[ "$current_default" -gt "$baseline_default" ]]; then
  diff=$((current_default - baseline_default))
  cat <<EOF >&2
ERROR: silent-fail-default patterns increased by $diff (baseline=$baseline_default, current=$current_default).

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
  exit_code=1
elif [[ "$current_default" -lt "$baseline_default" ]]; then
  diff=$((baseline_default - current_default))
  echo "✅ silent-fail-default count dropped by $diff (baseline=$baseline_default → current=$current_default)."
  echo "   Run \`scripts/check-silent-fail.sh --update\` to lock in the new lower baseline."
else
  echo "✅ silent-fail-default count steady at $current_default (matches baseline)."
fi

# ----- Check 2: .single() / .maybeSingle() error-drop -----
if [[ "$current_single" -gt "$baseline_single" ]]; then
  diff=$((current_single - baseline_single))
  cat <<EOF >&2
ERROR: .single()/.maybeSingle() error-drop patterns increased by $diff (baseline=$baseline_single, current=$current_single).

A Supabase \`.single()\` or \`.maybeSingle()\` destructure is dropping the
\`error\` variable, e.g.

    const { data: row } = await supabase.from(...).single();

This makes RLS regressions, network blips, or Postgres restarts
surface as "row not found" to users without reaching Sentry — the
exact anti-pattern fixed in PRs 18-20 and made structurally impossible
by spec 006 (PR #270).

Fix: capture both \`data\` and \`error\`, then route via the framework
helper \`notFoundOrInfra\`:

    const { data: row, error: rowErr } = await supabase.from(...).single();
    if (rowErr || !row) throw notFoundOrInfra(rowErr, "<friendly Arabic>");

Import \`notFoundOrInfra\` from \`@/lib/actions/loud\`.

If the new occurrences are genuinely safe (e.g. \`supabase.auth.getUser()\`
shape, storage \`getPublicUrl()\`, or a vetted test fixture), update the
baseline:
  scripts/check-silent-fail.sh --update

See spec 006: specs/006-loud-action-phase-2-finish/contracts/tripwire-contract.md
EOF
  exit_code=1
elif [[ "$current_single" -lt "$baseline_single" ]]; then
  diff=$((baseline_single - current_single))
  echo "✅ .single() error-drop count dropped by $diff (baseline=$baseline_single → current=$current_single)."
  echo "   Run \`scripts/check-silent-fail.sh --update\` to lock in the new lower baseline."
else
  echo "✅ .single() error-drop count steady at $current_single (matches baseline)."
fi

exit $exit_code
