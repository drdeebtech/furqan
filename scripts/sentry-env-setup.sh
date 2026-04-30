#!/usr/bin/env bash
# scripts/sentry-env-setup.sh
# Adds Sentry's source-map upload + release tagging env vars to Vercel
# (both production and preview scopes). Pipes the values via stdin so
# Vercel's interactive prompt is skipped — no "Make it sensitive?" or
# git-branch confusion.
#
# This script is one-shot: run it once after the Sentry GitHub integration
# is wired and the local .env.sentry-build-plugin file exists. After it
# completes, push any commit and the next Vercel build will upload source
# maps and tag releases via the @sentry/nextjs withSentryConfig plugin
# (configured in next.config.ts).
#
# Re-runnable safely: existing env entries error out gracefully and the
# script continues. If you need to overwrite an existing env, run
# `npx vercel env rm NAME production` first.

set -uo pipefail  # not -e — we want to keep going if one entry already exists

TOKEN_FILE=".env.sentry-build-plugin"
if [ ! -f "$TOKEN_FILE" ]; then
  echo "ERROR: $TOKEN_FILE not found. The Sentry wizard generates this with"
  echo "       SENTRY_AUTH_TOKEN. Run: npx @sentry/wizard@latest -i nextjs"
  exit 1
fi

TOKEN=$(grep -E '^SENTRY_AUTH_TOKEN=' "$TOKEN_FILE" | head -1 | cut -d= -f2-)
if [ -z "$TOKEN" ]; then
  echo "ERROR: could not extract SENTRY_AUTH_TOKEN from $TOKEN_FILE"
  exit 1
fi

ORG="furqan-academy"
PROJECT="javascript-nextjs-e4"

add_env() {
  local name="$1"
  local value="$2"
  local target="$3"
  echo ""
  echo "→ adding $name to $target"
  if printf '%s' "$value" | npx --yes vercel env add "$name" "$target" 2>&1; then
    echo "  ✓ $name in $target"
  else
    echo "  ⚠ $name in $target may already exist (continuing)"
  fi
}

echo "=== Adding Sentry build envs to Vercel ==="
echo "Scope:    production + preview"
echo "Source:   $TOKEN_FILE (token) + script defaults (org, project)"
echo ""

add_env SENTRY_AUTH_TOKEN "$TOKEN"             production
add_env SENTRY_AUTH_TOKEN "$TOKEN"             preview
add_env SENTRY_ORG        "$ORG"               production
add_env SENTRY_ORG        "$ORG"               preview
add_env SENTRY_PROJECT    "$PROJECT"           production
add_env SENTRY_PROJECT    "$PROJECT"           preview

echo ""
echo "=== Done. Verify with: ==="
echo "  npx vercel env ls | grep -i sentry"
echo ""
echo "Next: push any commit to trigger a deploy. The @sentry/nextjs plugin"
echo "(next.config.ts) will pick up the envs and upload source maps + tag"
echo "the release. Verify with:"
echo "  ~/.local/bin/sentry release list --limit 3"
