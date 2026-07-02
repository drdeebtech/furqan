import { test, expect } from "@playwright/test";

/**
 * Wave 0 compliance (decision 43): the terms/privacy clickwrap gates BOTH
 * signup paths on /register — the email form's submit button AND the Google
 * OAuth button stay disabled until the consent checkbox is ticked.
 *
 * Server-side enforcement (consent field absent/false → reject) is covered by
 * src/lib/auth/register-schema.test.ts; this spec covers the UI layer.
 */
test.describe("register consent gate", () => {
  test("consent checkbox is unchecked by default and gates both signup paths", async ({ page }) => {
    await page.goto("/register");

    const consent = page.locator("#consent");
    await expect(consent).toBeVisible();
    await expect(consent).not.toBeChecked();

    // Both paths disabled pre-consent.
    const googleButton = page.getByRole("button", { name: /جوجل|Google/ });
    const submitButton = page.locator('form#register-form button[type="submit"]');
    await expect(googleButton).toBeDisabled();
    await expect(submitButton).toBeDisabled();

    // Terms + privacy links present inside the consent label.
    await expect(page.locator('label[for="consent"] a[href="/terms"]').first()).toBeVisible();
    await expect(page.locator('label[for="consent"] a[href="/privacy"]').first()).toBeVisible();

    // Ticking the box enables both paths.
    await consent.check();
    await expect(googleButton).toBeEnabled();
    await expect(submitButton).toBeEnabled();
  });

  test("login page shows the continue-implies-agreement notice for Google", async ({ page }) => {
    await page.goto("/login");
    await expect(page.getByText(/بالمتابعة بحساب جوجل/)).toBeVisible();
    // Login's Google button is NOT disabled — notice consent, not clickwrap.
    await expect(page.getByRole("button", { name: /جوجل|Google/ })).toBeEnabled();
  });
});
