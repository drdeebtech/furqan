import { test, type Page } from "@playwright/test";
import fs from "node:fs";

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

test.describe("admin tabs visual audit", () => {
  test.skip(!ADMIN_EMAIL || !ADMIN_PASSWORD, "needs creds");

  test("screenshot every tab", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await login(page, ADMIN_EMAIL, ADMIN_PASSWORD);

    await page.goto("/admin/teachers", { waitUntil: "domcontentloaded" });
    const firstDetails = page.locator('a[href^="/admin/teachers/"][href*="-"]').first();
    const href = await firstDetails.getAttribute("href");
    if (!href) throw new Error("no teacher link");
    const teacherId = href.split("/").pop()!;
    console.log("using teacher_id:", teacherId);

    const dir = "test-results/visual-audit";
    fs.mkdirSync(dir, { recursive: true });

    const tabs = ["overview", "account", "profile", "cv", "ijazas", "availability"];
    for (const tab of tabs) {
      const url = tab === "overview" ? `/admin/teachers/${teacherId}` : `/admin/teachers/${teacherId}?tab=${tab}`;
      await page.goto(url, { waitUntil: "domcontentloaded" });
      await page.waitForTimeout(500);
      const path = `${dir}/${tab}.png`;
      await page.screenshot({ path, fullPage: true });
      console.log(`saved: ${path}`);
    }
  });
});
