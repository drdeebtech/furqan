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
 * Sentry wraps the outermost config. When SENTRY_DSN is not set, we skip the
 * wrapper entirely so there is zero build-time or runtime cost and no source
 * maps are uploaded. Flip the env var on to activate Sentry — no code changes
 * required. `silent: true` keeps build logs clean when it is active without a
 * configured auth token.
 */
const shouldEnableSentry = Boolean(process.env.SENTRY_DSN);

export default shouldEnableSentry
  ? withSentryConfig(wrapped, {
      silent: true,
      org: process.env.SENTRY_ORG,
      project: process.env.SENTRY_PROJECT,
      authToken: process.env.SENTRY_AUTH_TOKEN,
    })
  : wrapped;
