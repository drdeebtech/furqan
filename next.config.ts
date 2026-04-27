import type { NextConfig } from "next";
import { withBotId } from "botid/next/config";
import bundleAnalyzer from "@next/bundle-analyzer";
import { withSentryConfig } from "@sentry/nextjs";

const withBundleAnalyzer = bundleAnalyzer({
  enabled: process.env.ANALYZE === "true",
});

const nextConfig: NextConfig = {
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
 */
export default withSentryConfig(wrapped, {
  silent: true,
  org: process.env.SENTRY_ORG,
  project: process.env.SENTRY_PROJECT,
  authToken: process.env.SENTRY_AUTH_TOKEN,
  widenClientFileUpload: true,
  tunnelRoute: "/monitoring",
  release: {
    setCommits: { auto: true, ignoreMissingRepository: true },
    deploy: { env: process.env.VERCEL_ENV ?? "development" },
  },
});
