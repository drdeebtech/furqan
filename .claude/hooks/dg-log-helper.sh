#!/bin/bash
# Shared structured logging for deebgrind hooks.
# Source this file: source "$(dirname "$0")/dg-log-helper.sh"

DEEBGRIND_DIR="${HOME}/.deebgrind/$(basename "${CLAUDE_PROJECT_DIR:-.}")"
LOG_FILE="${DEEBGRIND_DIR}/temp/dg-hook.log"

# Ensure temp dir exists before writing logs
mkdir -p "${DEEBGRIND_DIR}/temp" 2>/dev/null || true

log_event() {
    local level="$1" hook="$2" event="$3" detail="${4:-}"
    local ts
    ts=$(date '+%H:%M:%S')
    printf '%s [%-5s] %s | %s | %s\n' "$ts" "$level" "$hook" "$event" "$detail" \
        >> "$LOG_FILE" 2>/dev/null || true
}
