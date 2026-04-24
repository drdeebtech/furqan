import { test, expect, type Page } from "@playwright/test";

/**
 * Diagnostic: log in as admin, open the first teacher's detail page,
 * and report what's actually rendered — especially whether the tab bar exists.
 */

const ADMIN_EMAIL = process.env.TEST_ADMIN_EMAIL ?? "";
const ADMIN_PASSWORD = process.env.TEST_ADMIN_PASSWORD ?? "";

async function login(page: Page, email: string, password: string) {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

  const res = await fetch(`${supabaseUrl}/auth/v1/token?grant_type=password`, {
    method: "POST",
    headers: { "Content-Type": "application/json", apikey: supabaseAnonKey },
    body: JSON.stringify({ email, password }),
  });
  const data = await res.json();
  if (!data.access_token) throw new Error(`Login failed: ${JSON.stringify(data)}`);

  const ref = supabaseUrl.replace("https://", "").split(".")[0];
  const cookieBase = `sb-${ref}-auth-token`;
  const baseUrl = process.env.BASE_URL ?? "http://localhost:3000";
  const url = new URL(baseUrl);

  const payload = {
    access_token: data.access_token,
    refresh_token: data.refresh_token,
    expires_at: Math.floor(Date.now() / 1000) + data.expires_in,
    expires_in: data.expires_in,
    token_type: "bearer",
    user: data.user,
  };
  const cookieValue = `base64-${Buffer.from(JSON.stringify(payload)).toString("base64")}`;

  await page.context().addCookies([
    { name: cookieBase, value: cookieValue, domain: url.hostname, path: "/" },
  ]);
}

test.describe("admin tabs diagnostic", () => {
  test.skip(!ADMIN_EMAIL || !ADMIN_PASSWORD, "needs TEST_ADMIN_EMAIL + TEST_ADMIN_PASSWORD");

  test("report what renders on /admin/teachers/[first] + tab presence", async ({ page }) => {
    await login(page, ADMIN_EMAIL, ADMIN_PASSWORD);

    // Step 1: /admin/teachers list
    await page.goto("/admin/teachers", { waitUntil: "networkidle" });
    console.log("Step 1: on /admin/teachers — URL:", page.url());
    console.log("Step 1: title:", await page.title());

    // Find the first "Details" link → that gives us /admin/teachers/<UUID>
    const firstDetails = page.locator('a[href^="/admin/teachers/"][href*="-"]').first();
    const href = await firstDetails.getAttribute("href");
    console.log("Step 1: first teacher detail href:", href);
    expect(href).toBeTruthy();

    // Step 2: navigate there
    await page.goto(href!, { waitUntil: "networkidle" });
    console.log("Step 2: on teacher detail — URL:", page.url());

    // Step 3: dump page HTML title + first H1
    const h1 = await page.locator("h1").first().textContent().catch(() => null);
    console.log("Step 3: first H1 text:", h1);

    // Step 4: check for each tab label
    const expectedTabs = [
      { ar: "نظرة عامة", en: "Overview" },
      { ar: "الحساب", en: "Account" },
      { ar: "بيانات المعلم", en: "Teacher profile" },
      { ar: "السيرة الذاتية", en: "CV" },
      { ar: "الإجازات", en: "Ijazas" },
      { ar: "التوفر", en: "Availability" },
    ];

    for (const tab of expectedTabs) {
      const count = await page.locator(`a:has-text("${tab.ar}"), a:has-text("${tab.en}")`).count();
      console.log(`Step 4: tab "${tab.ar} / ${tab.en}" found: ${count > 0 ? "YES" : "NO"} (count=${count})`);
    }

    // Step 5: list all links that look like tab nav
    const tabLinks = await page.locator(`a[href*="/admin/teachers/"][href*="?tab="]`).allTextContents();
    console.log("Step 5: tab-style href links on page:", JSON.stringify(tabLinks));

    // Step 6: take a screenshot
    await page.screenshot({ path: "test-results/admin-tabs-diagnostic.png", fullPage: true });
    console.log("Step 6: screenshot saved to test-results/admin-tabs-diagnostic.png");

    // Dump visible body text to capture debug errors
    const bodyText = await page.locator("body").innerText();
    console.log("=== FULL PAGE BODY TEXT ===");
    console.log(bodyText.slice(0, 2000));
    console.log("=== END BODY TEXT ===");

    // Final assertion: the tab bar should have at least 4 tab links
    expect(tabLinks.length).toBeGreaterThanOrEqual(4);
  });
});
