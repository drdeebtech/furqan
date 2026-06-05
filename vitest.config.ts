import { defineConfig } from "vitest/config";
import { resolve } from "node:path";

export default defineConfig({
  resolve: {
    alias: {
      "@": resolve(__dirname, "./src"),
    },
  },
  test: {
    environment: "node",
    include: ["src/**/*.test.ts", "scripts/**/*.test.ts", "evals/**/*.eval.ts"],
    // Exclude Playwright E2E — they run under a different harness
    exclude: ["e2e/**", "node_modules/**", ".next/**"],
    coverage: {
      provider: "v8",
      reporter: ["text", "lcov"],
      exclude: [
        "**/*.config.*",
        "src/types/**",
        "**/__tests__/**",
        "e2e/**",
        // Next.js route handlers and SSR files require the full Next.js
        // runtime (cookies(), headers(), Response streaming) and cannot be
        // meaningfully unit-tested outside the framework.
        "src/lib/supabase/server.ts",
        "src/app/api/**",
        // Vercel / Edge Config runtime — env-dependent, no unit test surface.
        "src/lib/edge-config.ts",
        "src/lib/settings.ts",
      ],
      thresholds: {
        lines: 80,
        functions: 72,
        branches: 72,
        statements: 77,
      },
    },
  },
});
