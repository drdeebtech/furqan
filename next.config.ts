import type { NextConfig } from "next";
import { withBotId } from "botid/next/config";
import bundleAnalyzer from "@next/bundle-analyzer";

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

export default withBundleAnalyzer(withBotId(nextConfig));
