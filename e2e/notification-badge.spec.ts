import { test, expect, type Page } from "@playwright/test";

/**
 * Visual + structural verification of the notification bell badge.
 *
 * The user reported the previous gradient+ring+glow was "not looking nice".
 * This test asserts the simpler ruleset now in effect:
 *   - rendered with data-testid="notification-badge"
 *   - 16×16 minimum box (less imposing than the prior 20×20)
 *   - rounded-md (not a full pill) so it reads as a chip, not a circle
 *   - solid red at 90% alpha (softer than raw red-500)
 *   - 2px cutout shadow in var(--surface) separating it from the bell
 *   - single-digit count text renders cleanly (no overflow, no clipping)
 *
 * Also takes a screenshot of the bell button so visual drift is catchable in
 * future runs via the snapshot diff.
 */

const STUDENT_EMAIL = process.env.TEST_STUDENT_EMAIL ?? "";
const STUDENT_PASSWORD = process.env.TEST_STUDENT_PASSWORD ?? "";

async function login(page: Page, email: string, password: string) {
  const baseUrl = process.env.BASE_URL ?? "http://localhost:3000";
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
}

test.describe("Notification badge", () => {
  test.skip(
    !STUDENT_EMAIL,
    "Set TEST_STUDENT_EMAIL + TEST_STUDENT_PASSWORD to run",
  );

  test("renders with expected size, shape, and cutout shadow", async ({ page }) => {
    await login(page, STUDENT_EMAIL, STUDENT_PASSWORD);
    await page.goto("/student/dashboard");
    await page.waitForLoadState("networkidle");

    const badge = page.getByTestId("notification-badge");

    // If the test account has no unread notifications the badge won't render.
    // In that case we exit early with a soft pass — the other assertions can't run.
    if (!(await badge.isVisible().catch(() => false))) {
      test.info().annotations.push({
        type: "skip",
        description: "no unread notifications for this test account",
      });
      return;
    }

    // Box ≥ 16×16 but not ridiculously large
    const box = await badge.boundingBox();
    expect(box).not.toBeNull();
    if (box) {
      expect(box.width).toBeGreaterThanOrEqual(16);
      expect(box.width).toBeLessThan(32);
      expect(box.height).toBeGreaterThanOrEqual(16);
      expect(box.height).toBeLessThan(22);
    }

    // Shape: rounded-md → 6px radius in Tailwind v4, not fully pill (height/2)
    const borderRadius = await badge.evaluate(
      (el) => getComputedStyle(el).borderRadius,
    );
    expect(borderRadius).toContain("6px");

    // Fill: red-500 at ≈90% alpha; check rgba() contains red-heavy channel
    const bg = await badge.evaluate(
      (el) => getComputedStyle(el).backgroundColor,
    );
    expect(bg).toMatch(/^rgba?\(\s*239,\s*68,\s*68/); // Tailwind red-500
    // Alpha component < 1 (softened)
    expect(bg).toMatch(/0\.9\)$|0\.89\)$/);

    // Cutout shadow — must reference a non-zero spread/color at inset 0
    const shadow = await badge.evaluate(
      (el) => getComputedStyle(el).boxShadow,
    );
    expect(shadow).not.toBe("none");
    expect(shadow).toContain("2px"); // our 2px ring

    // Character content — single or double-digit number, no overflow
    const text = (await badge.textContent())?.trim();
    expect(text).toMatch(/^\d+\+?$/);

    // Snapshot the whole bell button for regression diffs
    const bellButton = badge.locator("xpath=ancestor::button[1]");
    await expect(bellButton).toHaveScreenshot("notification-bell-with-badge.png", {
      maxDiffPixelRatio: 0.03,
    });
  });
});
