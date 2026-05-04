import { test, expect } from "@playwright/test";

/**
 * Cred-free smoke test for the auth flow's user-facing pages.
 *
 * Catches the bug class that broke production for 10 hours on 2026-05-04:
 * a tightened CSP silently blocked Next.js's inline RSC streaming chunks
 * on every authenticated page. Symptoms were "spinner forever" with no
 * exception thrown — invisible to Sentry, only catchable via a real
 * browser actually executing the page.
 *
 * What this test verifies on each auth route:
 *   - HTTP 200
 *   - Renders the login form (proves SSR worked)
 *   - Zero CSP violations in the browser console (proves inline scripts
 *     aren't being blocked by the policy)
 *   - Zero meaningful console errors (catches hydration failures, missing
 *     chunks, etc.)
 *
 * Note on local vs CI: vercel.json security headers (including CSP) only
 * apply on Vercel deployments, not local `next dev`. To catch CSP
 * regressions in CI, run this test against a Vercel preview URL:
 *
 *   BASE_URL=https://furqan-<deployment>.vercel.app npx playwright test e2e/auth-smoke.spec.ts
 *
 * The grep for "Content Security Policy" in console errors is a no-op
 * locally (no CSP enforced) and the actual signal in preview/prod runs.
 */

const AUTH_ROUTES = ["/login", "/register", "/forgot-password"];

test.describe("Auth pages smoke", () => {
  for (const route of AUTH_ROUTES) {
    test(`${route} loads + hydrates without CSP violations or console errors`, async ({ page }) => {
      const allErrors: string[] = [];
      page.on("pageerror", (err) => allErrors.push(`pageerror: ${err.message}`));
      page.on("console", (msg) => {
        if (msg.type() === "error" || msg.type() === "warning") {
          allErrors.push(`${msg.type()}: ${msg.text()}`);
        }
      });

      const response = await page.goto(route);
      expect(response?.status(), `${route} should return 200`).toBe(200);

      await page.waitForLoadState("networkidle");

      // The form mounts on the client — proves React hydrated. If hydration
      // failed (the 2026-05-04 CSP failure mode), the form would be in the
      // server-rendered HTML but the React event handlers wouldn't be wired.
      // Checking for the input being editable confirms client took over.
      const emailInput = page.locator('input[name="email"]').first();
      await expect(emailInput).toBeVisible({ timeout: 10000 });
      await emailInput.fill("smoke-test@example.invalid");
      await expect(emailInput).toHaveValue("smoke-test@example.invalid");

      // Hard-fail on any CSP violation — this is the regression class we
      // care most about. Only matters when running against a deployment
      // that actually enforces CSP (Vercel preview / prod).
      const cspViolations = allErrors.filter((e) =>
        /content security policy|csp|violates the following/i.test(e),
      );
      expect(
        cspViolations,
        `${route}: CSP violations detected:\n${cspViolations.join("\n")}`,
      ).toHaveLength(0);

      // Generic console-error gate — same noise filter as public-smoke.
      // Tolerates Next.js dev-mode false positives + extension noise that
      // can leak in when Playwright reuses a profile.
      const meaningfulErrors = allErrors.filter(
        (e) =>
          !e.includes("Fast Refresh") &&
          !e.includes("Download the React DevTools") &&
          !e.includes("Using DEFAULT root logger") &&
          !e.includes("preloaded using link preload but not used") &&
          // Dev-only BotID notice — see actions.ts notes
          !e.includes("developmentOptions.bypass"),
      );
      expect(
        meaningfulErrors,
        `${route}: meaningful console errors:\n${meaningfulErrors.join("\n")}`,
      ).toHaveLength(0);
    });
  }
});
