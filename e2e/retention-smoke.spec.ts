import { test, expect, type Page } from "@playwright/test";

/**
 * Smoke test: Retention surface
 *
 * Verifies the pages built in Phases 9–20 render for an admin without
 * crashing. Does NOT assert on data content (the scorer may not have
 * run yet) — only that the pages load and the expected structure exists.
 *
 * Run:
 *   TEST_ADMIN_EMAIL=admin@furqan.today TEST_ADMIN_PASSWORD='...' \
 *   npx playwright test e2e/retention-smoke.spec.ts
 */

const ADMIN_EMAIL = process.env.TEST_ADMIN_EMAIL ?? "";
const ADMIN_PASSWORD = process.env.TEST_ADMIN_PASSWORD ?? "";

async function loginAsAdmin(page: Page) {
  const baseUrl = process.env.BASE_URL ?? "http://localhost:3000";
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

  const res = await fetch(`${supabaseUrl}/auth/v1/token?grant_type=password`, {
    method: "POST",
    headers: { "Content-Type": "application/json", apikey: supabaseAnonKey },
    body: JSON.stringify({ email: ADMIN_EMAIL, password: ADMIN_PASSWORD }),
  });
  const data = await res.json();
  if (!data.access_token) throw new Error(`Admin login failed: ${JSON.stringify(data)}`);

  const ref = supabaseUrl.replace("https://", "").split(".")[0];
  const cookieBase = `sb-${ref}-auth-token`;
  const cookieData = JSON.stringify({
    access_token: data.access_token,
    refresh_token: data.refresh_token,
    expires_at: data.expires_at,
    expires_in: data.expires_in,
    token_type: data.token_type,
  });

  const chunkSize = 3180;
  const chunks: string[] = [];
  for (let i = 0; i < cookieData.length; i += chunkSize) {
    chunks.push(cookieData.slice(i, i + chunkSize));
  }

  const domain = new URL(baseUrl).hostname;
  const cookies = chunks.map((chunk, i) => ({
    name: chunks.length === 1 ? cookieBase : `${cookieBase}.${i}`,
    value: chunk,
    domain,
    path: "/",
    httpOnly: false,
    secure: false,
    sameSite: "Lax" as const,
  }));

  await page.context().addCookies(cookies);
  await page.goto("/");
  await page.waitForLoadState("networkidle");
}

test.describe("Retention Smoke", () => {
  test.skip(
    !ADMIN_EMAIL || !ADMIN_PASSWORD,
    "Set TEST_ADMIN_EMAIL and TEST_ADMIN_PASSWORD to run",
  );

  test.beforeEach(async ({ page }) => {
    await loginAsAdmin(page);
  });

  test("/admin/retention loads with header + Run Scorer button", async ({ page }) => {
    await page.goto("/admin/retention");
    await expect(page.getByRole("heading", { name: "إشارات البقاء" })).toBeVisible();
    await expect(page.getByText("تشغيل الآن")).toBeVisible();
  });

  test("/admin/retention shows filter controls", async ({ page }) => {
    await page.goto("/admin/retention");
    await expect(page.getByLabel("تصفية حسب مستوى الخطر")).toBeVisible();
    await expect(page.getByLabel("تصفية حسب حالة الباقة")).toBeVisible();
    await expect(page.getByLabel("تصفية حسب التواصل")).toBeVisible();
  });

  test("/admin/retention filter changes URL params", async ({ page }) => {
    await page.goto("/admin/retention");
    await page.getByLabel("تصفية حسب مستوى الخطر").selectOption("critical");
    await page.waitForURL(/risk=critical/);
    expect(page.url()).toContain("risk=critical");
  });

  test("/admin/control-tower includes retention widget", async ({ page }) => {
    await page.goto("/admin/control-tower");
    await expect(page.getByText("طلاب في خطر التسرب")).toBeVisible();
  });

  test("/admin/users list renders with retention column header", async ({ page }) => {
    await page.goto("/admin/users");
    await expect(page.getByText("خطر التسرب", { exact: false })).toBeVisible();
  });
});
