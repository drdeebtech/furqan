#!/usr/bin/env bash
#
# specs-index-cron.sh — nightly n8n cron wrapper for the specs/INDEX.md
# generator. Runs at 03:00 UTC on the Mac mini per CLAUDE.md cron policy.
#
# Per spec specs/002-specs-index-generator/, FR-005 + FR-010:
# - Author: existing drdeebtech@gmail.com git identity (Vercel deploy gate).
# - Commit subject prefix: [index-bot] for git log filterability.
# - Pushes directly to main (no PR — drift correction is mechanical).
# - On gh CLI failure: exit non-zero so n8n's self-healing retries on next tick.
#
# Invocation: n8n SSHes to the Mac mini and runs:
#   bash /path/to/furqan/automation/workflows/specs-index-cron.sh
#
# Repository URL is provided via environment variable FURQAN_REPO_PATH;
# defaults to a sensible path if unset.

set -euo pipefail

REPO_PATH="${FURQAN_REPO_PATH:-/Users/drdeeb/furqan}"

cd "$REPO_PATH"

# Pull latest main (FF-only — fail loud if there's local divergence)
git fetch origin main
git checkout main
git pull --ff-only

# Run the generator (exit 2 on hard error per contract)
if ! npx tsx scripts/generate-specs-index.ts; then
  echo "[index-bot] generate-specs-index.ts exited non-zero" >&2
  exit 1
fi

# If INDEX.md changed, commit + push
if ! git diff --quiet specs/INDEX.md; then
  git add specs/INDEX.md
  git commit -m "[index-bot] regenerate specs/INDEX.md (cron drift correction)"
  git push origin main
  echo "[index-bot] drift corrected"
else
  echo "[index-bot] INDEX.md current; no commit"
fi
