#!/usr/bin/env bash
# scripts/sentry-env-setup.sh
# Prints the exact `vercel env add` commands needed to enable Sentry source-map
# upload + release tagging during the Vercel build. Run when the Vercel project
# build is missing one or more of: SENTRY_AUTH_TOKEN, SENTRY_ORG, SENTRY_PROJECT.
#
# This script is interactive on purpose — `vercel env add` prompts for values
# via stdin and won't accept secrets via flags. We print the commands and the
# values to paste; do NOT auto-pipe the token, that's how it ends up in shell
# history.

set -euo pipefail

if ! command -v vercel >/dev/null 2>&1 && ! npx --yes vercel --version >/dev/null 2>&1; then
  echo "Vercel CLI not available. Install with: npm i -g vercel"
  exit 1
fi

TOKEN_FILE=".env.sentry-build-plugin"
if [ ! -f "$TOKEN_FILE" ]; then
  echo "ERROR: $TOKEN_FILE not found. Sentry wizard generates this file with"
  echo "       the SENTRY_AUTH_TOKEN. Re-run: npx @sentry/wizard@latest -i nextjs"
  exit 1
fi

TOKEN=$(grep -E '^SENTRY_AUTH_TOKEN=' "$TOKEN_FILE" | head -1 | cut -d= -f2-)
if [ -z "$TOKEN" ]; then
  echo "ERROR: could not extract SENTRY_AUTH_TOKEN from $TOKEN_FILE"
  exit 1
fi

echo "============================================================"
echo "  Sentry build envs to set in Vercel"
echo "============================================================"
echo ""
echo "Run these three commands. Each will prompt for a value (paste"
echo "the value shown after the arrow). Pick environments: production"
echo "AND preview when prompted."
echo ""
echo "  1)  npx vercel env add SENTRY_AUTH_TOKEN production preview"
echo "      → $TOKEN"
echo ""
echo "  2)  npx vercel env add SENTRY_ORG production preview"
echo "      → furqan-academy"
echo ""
echo "  3)  npx vercel env add SENTRY_PROJECT production preview"
echo "      → javascript-nextjs"
echo ""
echo "After all three, push any commit to trigger a redeploy. The"
echo "build's scripts/sentry-release.sh step will pick them up and"
echo "start uploading source maps + tagging releases with commits."
echo ""
echo "Verify with:"
echo "  npx vercel env ls"
echo "  ~/.local/bin/sentry release list --limit 3"
