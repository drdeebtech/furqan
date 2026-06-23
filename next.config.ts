import type { NextConfig } from "next";
import { withBotId } from "botid/next/config";
import bundleAnalyzer from "@next/bundle-analyzer";
import { withSentryConfig } from "@sentry/nextjs";

const withBundleAnalyzer = bundleAnalyzer({
  enabled: process.env.ANALYZE === "true",
});

const nextConfig: NextConfig = {
  // Pin the Turbopack workspace root to THIS repo. Stray manifests above the
  // repo (e.g. ~/package.json from Cursor/claude-flow tooling) otherwise make
  // Next infer a parent workspace root, which corrupts relative `@import`
  // resolution (Tailwind's `@import "../styles/glass.css"` climbed into
  // /home/<user>/ and 404'd). Vercel is unaffected (root is already the repo).
  turbopack: { root: __dirname },
  experimental: {
    optimizePackageImports: ["lucide-react"],
  },
  images: {
    minimumCacheTTL: 31536000,
    remotePatterns: [
      {
        protocol: "https",
        hostname: "xyqscjnqfeusgrhmwjts.supabase.co",
        pathname: "/storage/v1/object/public/**",
      },
    ],
  },
};

const wrapped = withBundleAnalyzer(withBotId(nextConfig));

/**
 * Sentry always wraps the outermost config so client-side instrumentation
 * (replay, transaction tracing, error boundary glue) ships on every build.
 * When SENTRY_AUTH_TOKEN is missing the plugin no-ops on the upload side,
 * so it is safe to run unconditionally.
 *
 * The plugin owns source-map generation + upload + release tagging end-to-end.
 * Earlier we tried to do uploads in scripts/sentry-release.sh and set
 * `sourcemaps.disable: true` here — but that flag also disables MAP GENERATION
 * (not just upload), which left .next/ without any maps to upload. Result:
 * zero artifacts in release 7ec22762. Letting the plugin do everything is
 * simpler and actually works.
 *
 * `tunnelRoute: "/monitoring"` proxies browser events through this app's
 * own origin, side-stepping ad-blockers and tightening CSP exposure.
 *
 * `release.setCommits.auto: true` makes the plugin tag the release with the
 * commit list since the previous release (drives suspect-commit detection
 * + the GitHub integration's PR comments).
 *
 * Release creation is gated on `VERCEL_ENV === "production"`. Preview
 * deploys (~100/day during active sprints) were generating one Sentry
 * release each, almost all carrying zero events — pure noise on the
 * release timeline + quota burn. Source maps still upload for previews
 * because the plugin uploads them irrespective of the release lifecycle
 * (they're attached by `release.name` once a release with the matching
 * commit SHA exists, which production builds will create).
 */
const isProductionDeploy = process.env.VERCEL_ENV === "production";

export default withSentryConfig(wrapped, {
  silent: true,
  org: process.env.SENTRY_ORG ?? "furqan-academy",
  project: process.env.SENTRY_PROJECT ?? "javascript-nextjs-e4",
  authToken: process.env.SENTRY_AUTH_TOKEN,
  widenClientFileUpload: true,
  tunnelRoute: "/monitoring",
  release: {
    create: isProductionDeploy,
    finalize: isProductionDeploy,
    // `ignoreMissingRepository` is a real sentry-cli flag but the
    // @sentry/nextjs v10.49 type defs haven't surfaced it yet. The plugin
    // forwards it to sentry-cli unchanged at runtime — cast through unknown
    // so TS doesn't reject it while we wait on a type-only update.
    setCommits: { auto: true, ignoreMissingRepository: true } as unknown as { auto: true },
    deploy: { env: process.env.VERCEL_ENV ?? "development" },
  },
  webpack: {
    automaticVercelMonitors: true,
    treeshake: {
      removeDebugLogging: true,
    },
  },
});
