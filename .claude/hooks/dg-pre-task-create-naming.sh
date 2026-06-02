#!/bin/bash
# PreToolUse(TaskCreate): enforce TASK N: type: description naming convention.
# Only active during /dg-build sessions (sentinel present).

source "$(dirname "$0")/dg-log-helper.sh"
HOOK="dg-pre-task-create-naming"

SENTINEL="${DEEBGRIND_DIR}/temp/build-active.local"
[ ! -f "$SENTINEL" ] && exit 0

input=$(cat)
subject=$(echo "$input" | jq -r '.tool_input.subject // empty')
[ -z "$subject" ] && exit 0

log_event "INFO" "$HOOK" "start" "subject=$subject"

# Allow: TASK N: type[(scope)]: description [(blocked by N,...)]
if echo "$subject" | grep -qE '^TASK [0-9]+: (feat|fix|docs|style|refactor|perf|test|chore)(\([^)]+\))?: .+'; then
    log_event "INFO" "$HOOK" "allow" "subject=$subject"
    jq -n '{
        "decision": "allow",
        "additionalContext": "Sequential numbering: N must be the next number (1, 2, 3 ...).\nExamples:\n  TASK 1: feat: add login endpoint\n  TASK 2: fix: handle null session\n  TASK 3: feat(auth): add OAuth (blocked by 1,2)\nCommit hash is appended via TaskUpdate after committing."
    }'
    exit 0
fi

log_event "WARN" "$HOOK" "deny" "subject=$subject"
jq -n \
    --arg s "$subject" \
    '{
        "decision": "deny",
        "reason": ("Task subject must be: TASK N: type: description\nValid types: feat, fix, docs, style, refactor, perf, test, chore\nOptional scope: type(scope)\nOptional suffix: (blocked by 1,2)\nGot: " + $s)
    }'
exit 0
