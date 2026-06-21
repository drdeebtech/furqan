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
        // Extracted body of the (already-excluded) Stripe webhook route. It
        // parses raw Stripe invoice/subscription event shapes and needs the
        // full Stripe runtime — same "no meaningful unit surface" property as
        // src/app/api/**, where this code lived before the refactor. (markEvent
        // + the subscription-lifecycle handlers ARE unit-tested in
        // __tests__/webhook-handlers.test.ts; those tests still run.)
        "src/lib/domains/billing/webhook-handlers.ts",
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
