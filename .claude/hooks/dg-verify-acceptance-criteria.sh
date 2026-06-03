#!/bin/bash
# Stop hook: prevent session exit while acceptance criteria remain unchecked.
# Only active during /dg-build sessions (sentinel present).
# Reads the verification state file frontmatter (iteration/max_iterations) and
# re-injects the verify prompt until every "- []" line becomes "- [x]" with proof.

set -euo pipefail

source "$(dirname "$0")/dg-log-helper.sh"
HOOK="dg-verify-acceptance-criteria"
log_err() { printf '%s\n' "$1" | tee -a "$LOG_FILE" >&2; }

SENTINEL="${DEEBGRIND_DIR}/temp/build-active.local"
[ ! -f "$SENTINEL" ] && exit 0

REQ_ID=$(cat "$SENTINEL" 2>/dev/null | tr -d '[:space:]')
if [ -n "$REQ_ID" ]; then
    STATE_FILE="${DEEBGRIND_DIR}/temp/${REQ_ID}-build-verification.local.md"
    PREV_UNCHECKED="${DEEBGRIND_DIR}/temp/${REQ_ID}-verify-prev-unchecked.local"
else
    STATE_FILE="${DEEBGRIND_DIR}/temp/build-verification.local.md"
    PREV_UNCHECKED="${DEEBGRIND_DIR}/temp/verify-prev-unchecked.local"
fi

cleanup() {
    rm -f "$STATE_FILE" "$SENTINEL" "${STATE_FILE}.tmp.$$" 2>/dev/null || true
}
trap 'cleanup; exit 0' ERR SIGINT SIGTERM

log_event "INFO" "$HOOK" "start" "state_file=$(basename "$STATE_FILE")"

# No active verification loop → allow exit
if [ ! -f "$STATE_FILE" ]; then
    rm -f "$SENTINEL" 2>/dev/null || true
    exit 0
fi

# Parse YAML frontmatter (strip \r for safety)
FRONTMATTER=$(sed -n '/^---$/,/^---$/{ /^---$/d; p; }' "$STATE_FILE" | tr -d '\r')
ACTIVE=$(echo "$FRONTMATTER"     | grep '^active:'         | sed 's/active: *//')
ITERATION=$(echo "$FRONTMATTER"  | grep '^iteration:'      | sed 's/iteration: *//')
MAX_ITER=$(echo "$FRONTMATTER"   | grep '^max_iterations:' | sed 's/max_iterations: *//')
CRITERIA_FILE=$(echo "$FRONTMATTER" | grep '^criteria_file:' | sed 's/criteria_file: *//')

# Not active → clean up and allow exit
if [ "$ACTIVE" != "true" ]; then
    cleanup
    exit 0
fi

# Read criteria file
if [ ! -f "$CRITERIA_FILE" ]; then
    log_event "WARN" "$HOOK" "no_criteria_file" "criteria_file=$CRITERIA_FILE"
    cleanup
    exit 0
fi

UNCHECKED=$(grep -c '^- \[\]' "$CRITERIA_FILE" 2>/dev/null || echo "0")
log_event "INFO" "$HOOK" "check" "unchecked=$UNCHECKED iteration=$ITERATION max=$MAX_ITER"

# All done → allow exit
if [ "$UNCHECKED" -eq 0 ]; then
    log_event "INFO" "$HOOK" "complete" "all criteria verified"
    cleanup
    rm -f "$PREV_UNCHECKED" 2>/dev/null || true
    exit 0
fi

# Max iterations reached → warn and allow exit to avoid infinite loop
if [ -n "$MAX_ITER" ] && [ "$ITERATION" -ge "$MAX_ITER" ]; then
    log_event "WARN" "$HOOK" "max_iterations" "iteration=$ITERATION max=$MAX_ITER unchecked=$UNCHECKED"
    log_err "⚠️  deebgrind: max verification iterations ($MAX_ITER) reached with $UNCHECKED criteria still unchecked. Allowing exit."
    cleanup
    exit 0
fi

# Check for stuck loop (no progress since last iteration)
PREV_COUNT=""
[ -f "$PREV_UNCHECKED" ] && PREV_COUNT=$(cat "$PREV_UNCHECKED" 2>/dev/null | tr -d '[:space:]')
if [ -n "$PREV_COUNT" ] && [ "$PREV_COUNT" = "$UNCHECKED" ] && [ "$ITERATION" -gt 0 ]; then
    STUCK=$(( ${STUCK_COUNT:-0} + 1 ))
    if [ "$STUCK" -ge 3 ]; then
        log_event "WARN" "$HOOK" "stuck" "no progress for 3 iterations, allowing exit"
        log_err "⚠️  deebgrind: verification loop stuck (no progress). Allowing exit. Check $CRITERIA_FILE manually."
        cleanup
        exit 0
    fi
fi
echo "$UNCHECKED" > "$PREV_UNCHECKED"

# Increment iteration in frontmatter
NEW_ITER=$(( ITERATION + 1 ))
sed -i "s/^iteration: *[0-9]*/iteration: $NEW_ITER/" "$STATE_FILE"

# Emit the re-injection prompt to stdout — Claude Code reads this and re-enters the session
BODY=$(sed -n '/^---$/{n;/^---$/!{:a;N;/^---$/!ba;p}}' "$STATE_FILE" | sed '/^---$/d')
printf '%s\n\n%s unchecked criteria remain. Do not stop until all show [x] with Proof:.\n' \
    "$BODY" "$UNCHECKED"

log_event "INFO" "$HOOK" "reinjected" "iteration=$NEW_ITER unchecked=$UNCHECKED"
exit 1
