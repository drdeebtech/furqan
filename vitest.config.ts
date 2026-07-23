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
    // Cap the fork pool to one worker at a time. The CI unit-test job runs on a
    // resource-constrained `medium` executor (2 vCPU / 4 GB) and this suite has a
    // heavy module graph (import ~6x test-exec time), so the default (one fork per
    // CPU) can load two full graphs at once and OOM-kill a worker — an intermittent,
    // test-agnostic failure. One fork keeps peak memory low; per-file isolation stays
    // ON (default), so this does NOT reintroduce cross-file state leakage.
    poolOptions: { forks: { minForks: 1, maxForks: 1 } },
    // Auto-clear mock call history before every test. Without this, module-level
    // vi.fn() mocks accumulate calls across tests in a file, so a `.not.toHaveBeenCalled()`
    // assertion passes only in written order and breaks under any reordering. Clears
    // history only, not implementations — factory-defined mock behavior survives.
    clearMocks: true,
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
        // Public certificate page requires Next.js Server Component runtime
        // (notFound, generateMetadata) — same exclusion rationale as src/app/api/**
        "src/app/certificates/**",
        // Public parent-portal page is a Server Component using headers()/getT()
        // and generateMetadata — same Next-runtime exclusion as certificates.
        // Its data layer (parent-portal/tokens.ts) IS unit-tested.
        "src/app/parent/**",
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
