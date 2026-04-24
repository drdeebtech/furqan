import { test, expect, type Page } from "@playwright/test";

/**
 * E2E: Admin can view + edit a teacher's CV from the teacher management pages.
 *
 * Prerequisites:
 *   1. Dev server running (npm run dev) or BASE_URL pointing at a live deploy.
 *   2. Env vars:
 *      - TEST_ADMIN_EMAIL / TEST_ADMIN_PASSWORD — an admin account
 *      - TEST_TEACHER_ID — the teacher_id to edit (UUID in teacher_profiles)
 *      - NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY
 *
 * Run:
 *   TEST_ADMIN_EMAIL=... TEST_ADMIN_PASSWORD=... TEST_TEACHER_ID=... \
 *   npx playwright test e2e/admin-cv-edit.spec.ts
 */

const ADMIN_EMAIL = process.env.TEST_ADMIN_EMAIL ?? "";
const ADMIN_PASSWORD = process.env.TEST_ADMIN_PASSWORD ?? "";
const TEACHER_ID = process.env.TEST_TEACHER_ID ?? "";

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

test.describe("admin teacher CV edit flow", () => {
  test.skip(
    !ADMIN_EMAIL || !ADMIN_PASSWORD || !TEACHER_ID,
    "needs TEST_ADMIN_EMAIL, TEST_ADMIN_PASSWORD, TEST_TEACHER_ID",
  );

  test("CV link on list page, button on detail page, form saves", async ({ page }) => {
    await login(page, ADMIN_EMAIL, ADMIN_PASSWORD);

    // 1. List page has a CV column + link per row
    await page.goto("/admin/teachers");
    await expect(page.getByRole("columnheader", { name: /CV|السيرة/i })).toBeVisible();
    const cvLinkInRow = page.locator(`a[href="/admin/teachers/cv/${TEACHER_ID}"]`).first();
    await expect(cvLinkInRow).toBeVisible();

    // 2. Detail page has the "View & edit CV" button linking to the CV page
    await page.goto(`/admin/teachers/${TEACHER_ID}`);
    const cvButton = page.locator(`a[href="/admin/teachers/cv/${TEACHER_ID}"]`);
    await expect(cvButton).toBeVisible();

    // 3. Click into CV page and verify the edit form is rendered with fields
    await cvButton.click();
    await page.waitForURL(`**/admin/teachers/cv/${TEACHER_ID}`);
    await expect(page.locator("#bio")).toBeVisible();
    await expect(page.locator("#bio_en")).toBeVisible();
    await expect(page.locator("#specialties")).toBeVisible();
    await expect(page.locator("#languages")).toBeVisible();
    await expect(page.locator("#recitation_standards")).toBeVisible();
    await expect(page.locator("#intro_video_url")).toBeVisible();

    // 4. Edit a field and save — success banner should appear
    const stamp = `E2E ${Date.now()}`;
    await page.locator("#bio").fill(stamp);
    await page.getByRole("button", { name: /حفظ التعديلات|Save changes/i }).click();
    await expect(page.getByText(/تم حفظ التعديلات بنجاح|saved/i)).toBeVisible({
      timeout: 10_000,
    });

    // 5. Reload and verify the saved value persisted
    await page.reload();
    await expect(page.locator("#bio")).toHaveValue(stamp);
  });
});
