#!/bin/bash
# TaskCompleted hook: enforce commit-before-complete during /dg-build sessions.
# Blocks completion if there are staged/unstaged changes or the subject lacks a commit hash.

source "$(dirname "$0")/dg-log-helper.sh"
HOOK="dg-task-completed-validate"

SENTINEL="${DEEBGRIND_DIR}/temp/build-active.local"
[ ! -f "$SENTINEL" ] && exit 0

input=$(cat)
subject=$(echo "$input" | jq -r '.task.subject // empty')
[ -z "$subject" ] && exit 0

log_event "INFO" "$HOOK" "start" "subject=$subject"

if ! git diff --cached --quiet 2>/dev/null; then
    log_event "WARN" "$HOOK" "deny" "staged uncommitted changes"
    echo "Task cannot be completed: staged changes are uncommitted. Commit them first." >&2
    exit 2
fi

if ! git diff --quiet 2>/dev/null; then
    log_event "WARN" "$HOOK" "deny" "unstaged changes to tracked files"
    echo "Task cannot be completed: unstaged changes to tracked files. Stage and commit first." >&2
    exit 2
fi

# Subject must include a commit hash: TASK N (abc1234): type: description
if ! echo "$subject" | grep -qE '^TASK [0-9]+ \([a-f0-9]+\): '; then
    log_event "WARN" "$HOOK" "deny" "missing commit hash subject=$subject"
    echo "Task subject is missing the commit hash. Update subject to: 'TASK N (HASH): type: description' where HASH = \$(git rev-parse --short HEAD)." >&2
    exit 2
fi

log_event "INFO" "$HOOK" "allow" "subject=$subject"
exit 0
