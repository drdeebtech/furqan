#!/bin/bash
# Status line for Claude Code — model, git branch, token usage

set -o pipefail

CYAN='\033[36m'
GREEN='\033[32m'
YELLOW='\033[33m'
RED='\033[31m'
RESET='\033[0m'

INPUT=$(cat)

CURRENT_DIR=$(echo "$INPUT" | jq -r '.workspace.current_dir // .cwd // empty')
MODEL_NAME=$(echo "$INPUT" | jq -r '.model.display_name // .model.name // .model.id // empty')
TRANSCRIPT_PATH=$(echo "$INPUT" | jq -r '.transcript_path // empty')

# Token usage from transcript
CURRENT_TOKENS=0
if [ -n "$TRANSCRIPT_PATH" ] && [ -f "$TRANSCRIPT_PATH" ]; then
    CURRENT_TOKENS=$(tail -n 100 "$TRANSCRIPT_PATH" 2>/dev/null | \
        jq -s 'map(select(.type == "assistant" and .message.usage and (.isSidechain // false) == false)) |
               if length > 0 then last | .message.usage |
               (.input_tokens // 0) + (.output_tokens // 0) +
               (.cache_creation_input_tokens // 0) + (.cache_read_input_tokens // 0)
               else 0 end' 2>/dev/null || echo "0")
fi

BUDGET=160000
CURRENT_K=$(( CURRENT_TOKENS / 1000 ))
PERCENTAGE=$(( BUDGET > 0 ? CURRENT_TOKENS * 100 / BUDGET : 0 ))

if [ "$PERCENTAGE" -ge 90 ]; then
    TOKEN_COLOR="$RED"
elif [ "$PERCENTAGE" -ge 80 ]; then
    TOKEN_COLOR="$YELLOW"
else
    TOKEN_COLOR="$CYAN"
fi
TOKEN_DISPLAY="${TOKEN_COLOR}${CURRENT_K}k (${PERCENTAGE}%)${RESET}"

# Git info
GIT_ROOT=$(git rev-parse --show-toplevel 2>/dev/null)
BRANCH=""
DIRTY=""
REQ_CONTEXT=""
if [ -n "$GIT_ROOT" ]; then
    BRANCH=$(git rev-parse --abbrev-ref HEAD 2>/dev/null || echo "")
    git diff --quiet 2>/dev/null || DIRTY="*"
    # deebgrind: show active REQ from sentinel if present
    DEEBGRIND_DIR="${HOME}/.deebgrind/$(basename "$GIT_ROOT")"
    SENTINEL="${DEEBGRIND_DIR}/temp/build-active.local"
    if [ -f "$SENTINEL" ]; then
        REQ_ID=$(cat "$SENTINEL" 2>/dev/null | tr -d '[:space:]')
        [ -n "$REQ_ID" ] && REQ_CONTEXT=" [${YELLOW}${REQ_ID}${RESET}]"
    fi
fi

DISPLAY_DIR=$(echo "$CURRENT_DIR" | sed "s|^$HOME|~|")

# Line 1: model + dir + tokens
LINE1=""
[ -n "$MODEL_NAME" ] && LINE1="${CYAN}${MODEL_NAME}${RESET} · "
LINE1="${LINE1}${DISPLAY_DIR} · ctx: ${TOKEN_DISPLAY}"
[ -n "$MODEL_NAME" ] || LINE1="ctx: ${TOKEN_DISPLAY}"

# Line 2: branch + deebgrind context
LINE2=""
if [ -n "$BRANCH" ]; then
    LINE2="${GREEN}${BRANCH}${DIRTY}${RESET}${REQ_CONTEXT}"
fi

echo -e "$LINE1"
[ -n "$LINE2" ] && echo -e "$LINE2"
