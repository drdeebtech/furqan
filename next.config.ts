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
 * Source-map upload is owned by `scripts/sentry-release.sh` (see vercel.json
 * buildCommand). The plugin's auto-upload is disabled here to avoid
 * double-uploading.
 *
 * `tunnelRoute: "/monitoring"` proxies browser events through this app's
 * own origin, side-stepping ad-blockers and tightening CSP exposure.
 */
export default withSentryConfig(wrapped, {
  silent: true,
  org: process.env.SENTRY_ORG,
  project: process.env.SENTRY_PROJECT,
  authToken: process.env.SENTRY_AUTH_TOKEN,
  widenClientFileUpload: true,
  tunnelRoute: "/monitoring",
  sourcemaps: { disable: true },
});
