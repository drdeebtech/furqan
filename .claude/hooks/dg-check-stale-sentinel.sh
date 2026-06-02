#!/bin/bash
# SessionStart hook: clean up a stale build sentinel left by a crashed session.

source "$(dirname "$0")/dg-log-helper.sh"
HOOK="dg-check-stale-sentinel"

SENTINEL="${DEEBGRIND_DIR}/temp/build-active.local"
[ ! -f "$SENTINEL" ] && exit 0

REQ_ID=$(cat "$SENTINEL" 2>/dev/null | tr -d '[:space:]')
if [ -n "$REQ_ID" ]; then
    VERIFY_STATE="${DEEBGRIND_DIR}/temp/${REQ_ID}-build-verification.local.md"
else
    VERIFY_STATE="${DEEBGRIND_DIR}/temp/build-verification.local.md"
fi

# If verification state is present, build is legitimately active
[ -f "$VERIFY_STATE" ] && exit 0

log_event "INFO" "$HOOK" "cleanup" "stale sentinel, cleaning temp dir"
rm -f "${DEEBGRIND_DIR}"/temp/* 2>/dev/null || true
exit 0
