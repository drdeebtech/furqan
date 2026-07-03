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

    // Terms + privacy links live in a sibling <LegalLinks> block rendered
    // outside (below) the consent label — never nested inside it, so the
    // label wraps no interactive content. Targeted by its legal-links testid.
    const legalLinks = page.getByTestId("legal-links");
    await expect(legalLinks.getByRole("link", { name: "الشروط والأحكام" })).toBeVisible();
    await expect(legalLinks.getByRole("link", { name: "Privacy Policy" })).toBeVisible();

    // Ticking the box enables both paths.
    await consent.check();
    await expect(googleButton).toBeEnabled();
    await expect(submitButton).toBeEnabled();
  });

  test("register consent block renders in RTL with correct layout and links", async ({
    page,
    context,
    baseURL,
  }) => {
    // Pin Arabic before hydration — Playwright's English browser locale would
    // otherwise flip furqan-lang to en on first visit (spec 035 FR-010).
    const { hostname } = new URL(baseURL ?? "http://localhost:3000");
    await context.addCookies([
      { name: "furqan-lang", value: "ar", domain: hostname, path: "/" },
    ]);

    await page.goto("/register");

    // Readiness via a web-first, auto-retrying assertion — not networkidle,
    // which is discouraged and can hang on noisy background requests.
    await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
    // Target a stable hook (data-testid) rather than a Tailwind-class selector,
    // and verify the auth shell itself renders RTL.
    await expect(page.getByTestId("auth-shell")).toHaveAttribute("dir", "rtl");

    const consent = page.locator("#consent");
    const label = page.locator('label[for="consent"]');
    await expect(page.getByText("أوافق على الشروط والأحكام وسياسة الخصوصية")).toBeVisible();
    await expect(page.getByText("I agree to the Terms and Privacy Policy")).toBeVisible();
    await expect(
      page.getByText("يرجى الموافقة أولاً لتفعيل التسجيل · Agree first to enable sign-up"),
    ).toBeVisible();

    const legalLinks = page.getByTestId("legal-links");
    await expect(legalLinks).toBeVisible();
    await expect(legalLinks.getByRole("link", { name: "الشروط والأحكام" })).toHaveAttribute("href", "/terms");
    await expect(legalLinks.getByRole("link", { name: "سياسة الخصوصية" })).toHaveAttribute("href", "/privacy");
    await expect(legalLinks.getByRole("link", { name: "Terms", exact: true })).toHaveAttribute("href", "/terms");
    await expect(legalLinks.getByRole("link", { name: "Privacy Policy" })).toHaveAttribute("href", "/privacy");

    const checkboxBox = await consent.boundingBox();
    const labelBox = await label.boundingBox();
    expect(checkboxBox).toBeTruthy();
    expect(labelBox).toBeTruthy();
    // RTL invariant: the checkbox is the label's flex first-child, so it renders
    // at the inline-start = the RIGHT side. Its center must therefore sit to the
    // right of the label's center (LTR would invert this). No magic ratio.
    const checkboxCenterX = checkboxBox!.x + checkboxBox!.width / 2;
    const labelCenterX = labelBox!.x + labelBox!.width / 2;
    expect(checkboxCenterX).toBeGreaterThan(labelCenterX);

    // `ps-6` is a logical inline-start padding; under RTL it must resolve to the
    // physical RIGHT side. Assert that mapping directly — a bare
    // paddingInlineStart > 0 would pass in LTR too and prove nothing about RTL.
    const { paddingLeft, paddingRight } = await legalLinks.evaluate((el) => {
      const s = getComputedStyle(el);
      return { paddingLeft: parseFloat(s.paddingLeft), paddingRight: parseFloat(s.paddingRight) };
    });
    expect(paddingRight).toBeGreaterThan(0);
    expect(paddingRight).toBeGreaterThan(paddingLeft);

    await expect(legalLinks.getByRole("link")).toHaveCount(4);
  });

  test("login page shows the continue-implies-agreement notice for Google", async ({ page }) => {
    await page.goto("/login");
    await expect(page.getByText(/بالمتابعة بحساب جوجل/)).toBeVisible();
    await expect(page.getByTestId("legal-links")).toBeVisible();
    // Login's Google button is NOT disabled — notice consent, not clickwrap.
    await expect(page.getByRole("button", { name: /جوجل|Google/ })).toBeEnabled();
  });
});
