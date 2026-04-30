#!/usr/bin/env bash
# scripts/sentry-release.sh
# Tags a Sentry release with this Vercel build's commit + uploads source maps.
# Runs after `next build` (see vercel.json buildCommand).
#
# Required env vars in the Vercel build scope:
#   SENTRY_AUTH_TOKEN  (mandatory — the upload won't work without it)
#   SENTRY_ORG=furqan-academy
#   SENTRY_PROJECT=javascript-nextjs-e4
#   VERCEL_GIT_COMMIT_SHA  (Vercel sets this automatically)
#
# The SENTRY_PROJECT slug must match the one in next.config.ts so source-map
# uploads from withSentryConfig and release tags from this script land in
# the same Sentry project. The legacy `javascript-nextjs` project still
# exists in the org but is not the active target anymore.
#
# This script intentionally exits 0 on Sentry-side failures: a Sentry outage
# or token rotation must NOT block a production deploy. All errors are echoed
# so they're visible in Vercel build logs.

set -u  # treat unset vars as errors, but no `-e` — we swallow per-step failures

VERSION="${VERCEL_GIT_COMMIT_SHA:-$(git rev-parse HEAD 2>/dev/null || echo unknown)}"
ENVIRONMENT="${VERCEL_ENV:-production}"

if [ -z "${SENTRY_AUTH_TOKEN:-}" ]; then
  echo "[sentry-release] SENTRY_AUTH_TOKEN not set — skipping release tagging."
  exit 0
fi

if [ "$VERSION" = "unknown" ]; then
  echo "[sentry-release] Could not determine commit SHA — skipping."
  exit 0
fi

echo "[sentry-release] Tagging release $VERSION (env=$ENVIRONMENT)"

# Use @sentry/cli via npx so we don't need a global install. The package is
# bundled as a devDependency for fast cold-cache builds.
SENTRY="npx --yes @sentry/cli"

$SENTRY releases new "$VERSION" || echo "[sentry-release] WARN: releases new failed"

# Try repo-integration commits first; fall back to local git history.
$SENTRY releases set-commits "$VERSION" --auto \
  || $SENTRY releases set-commits "$VERSION" --local \
  || echo "[sentry-release] WARN: set-commits failed (no integration AND no git? skipping)"

# Inject debug IDs into the build output so source maps can be matched.
$SENTRY sourcemaps inject .next || echo "[sentry-release] WARN: sourcemaps inject failed"

# Upload source maps. --strip-prefix shortens absolute paths to be readable.
$SENTRY sourcemaps upload \
  --release "$VERSION" \
  --strip-common-prefix \
  .next \
  || echo "[sentry-release] WARN: sourcemaps upload failed"

$SENTRY releases finalize "$VERSION" || echo "[sentry-release] WARN: finalize failed"

$SENTRY deploys new --release "$VERSION" -e "$ENVIRONMENT" \
  || echo "[sentry-release] WARN: deploys new failed"

echo "[sentry-release] Done."
exit 0
