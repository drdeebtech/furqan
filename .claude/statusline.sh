#!/bin/bash
# Status line for Claude Code — model, git branch, token usage, ruflo

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

# Ruflo status (fast — reads state file directly, no daemon query)
RUFLO_DISPLAY=""
RUFLO_STATE="${GIT_ROOT}/.claude-flow/daemon-state.json"
if [ -f "$RUFLO_STATE" ] && command -v python3 >/dev/null 2>&1; then
    RUFLO_DISPLAY=$(python3 - "$RUFLO_STATE" 2>/dev/null <<'PYEOF'
import json, sys, time, calendar
# lastRun values are UTC ('...Z'). Time-since-daemon-idle past this many
# seconds is treated as "stale": the running flag may be set but no worker
# has fired, so the live dot is dimmed to amber rather than green.
STALE_SECS = 3600
try:
    with open(sys.argv[1]) as f:
        d = json.load(f)
    running = d.get('running', False)
    workers = d.get('workers', {})
    active_names = [n for n, w in workers.items() if w.get('isRunning')]
    total_runs = sum(w.get('runCount', 0) for w in workers.values())
    # Last completed worker + elapsed (parse as UTC, compare to UTC epoch)
    last_run_ago = ''
    last_ts = 0
    last_name = ''
    for n, w in workers.items():
        ts_str = w.get('lastRun', '')
        if ts_str:
            try:
                ts = calendar.timegm(time.strptime(ts_str[:19], '%Y-%m-%dT%H:%M:%S'))
                if ts > last_ts:
                    last_ts = ts
                    last_name = n
            except Exception:
                pass
    now = time.time()
    # Liveness: the running flag is persisted, not a heartbeat. Green when a
    # worker is active right now, or the last run is recent, or nothing has run
    # yet (freshly started daemon — trust the flag). Amber only when we KNOW
    # activity has gone stale: running claimed, nothing currently active, and
    # the last worker fired over STALE_SECS ago — a likely dead/wedged daemon.
    if not running:
        dot = '\033[31m○\033[0m'
    elif not active_names and last_ts and now - last_ts > STALE_SECS:
        dot = '\033[33m●\033[0m'
    else:
        dot = '\033[32m●\033[0m'
    if last_ts:
        ago = int(now - last_ts)
        if ago < 60:
            last_run_ago = f'{ago}s'
        elif ago < 3600:
            last_run_ago = f'{ago//60}m'
        elif ago < 86400:
            last_run_ago = f'{ago//3600}h'
        else:
            last_run_ago = f'{ago//86400}d'
    parts = [f'ruflo {dot}']
    if active_names:
        parts.append('\033[33m' + '+'.join(active_names) + '\033[0m')
    else:
        parts.append(f'{total_runs}r')
    if last_name and last_run_ago:
        parts.append(f'\033[36m{last_name} {last_run_ago} ago\033[0m')
    print(' '.join(parts))
except Exception:
    pass
PYEOF
)
fi

# Line 2: branch + deebgrind context + ruflo
LINE2=""
if [ -n "$BRANCH" ]; then
    LINE2="${GREEN}${BRANCH}${DIRTY}${RESET}${REQ_CONTEXT}"
fi
[ -n "$RUFLO_DISPLAY" ] && LINE2="${LINE2:+${LINE2} · }${RUFLO_DISPLAY}"

echo -e "$LINE1"
[ -n "$LINE2" ] && echo -e "$LINE2"
