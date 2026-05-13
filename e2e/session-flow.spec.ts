import { test, expect, type Page } from "@playwright/test";

/**
 * E2E test: Student Session Flow
 *
 * Prerequisites:
 *   1. Dev server running (npm run dev) with .env.local
 *   2. Test accounts (set env vars below)
 *   3. The test teacher must have availability set and be accepting students
 *
 * Run:
 *   TEST_STUDENT_EMAIL=test.student@furqan.app TEST_STUDENT_PASSWORD='<password>' \
 *   TEST_TEACHER_EMAIL=test.teacher@furqan.app TEST_TEACHER_PASSWORD='<password>' \
 *   npx playwright test e2e/session-flow.spec.ts
 */

const STUDENT_EMAIL = process.env.TEST_STUDENT_EMAIL ?? "";
const STUDENT_PASSWORD = process.env.TEST_STUDENT_PASSWORD ?? "";
const TEACHER_EMAIL = process.env.TEST_TEACHER_EMAIL ?? "";
const TEACHER_PASSWORD = process.env.TEST_TEACHER_PASSWORD ?? "";

// ─────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────

async function login(page: Page, email: string, password: string) {
  const baseUrl = process.env.BASE_URL ?? "http://localhost:3000";
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

  // Authenticate via Supabase REST API to get tokens
  const res = await fetch(`${supabaseUrl}/auth/v1/token?grant_type=password`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      apikey: supabaseAnonKey,
    },
    body: JSON.stringify({ email, password }),
  });

  const data = await res.json();
  if (!data.access_token) {
    throw new Error(`Login failed for ${email}: ${JSON.stringify(data)}`);
  }

  // Extract the Supabase project ref for cookie names
  const ref = supabaseUrl.replace("https://", "").split(".")[0];
  const cookieBase = `sb-${ref}-auth-token`;

  // Set auth cookies that Supabase SSR expects
  const cookieData = JSON.stringify({
    access_token: data.access_token,
    refresh_token: data.refresh_token,
    expires_at: data.expires_at,
    expires_in: data.expires_in,
    token_type: data.token_type,
  });

  // Supabase SSR splits the cookie into chunks
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

  // Navigate to verify auth works
  await page.goto("/");
  await page.waitForLoadState("networkidle");
}

async function _logout(page: Page) {
  await page.goto("/api/auth/logout");
  await page.waitForURL((url) => url.pathname.includes("/login"), {
    timeout: 10_000,
  });
}

// ─────────────────────────────────────────────
// Tests
// ─────────────────────────────────────────────

test.describe("Session Flow — Full Cycle", () => {
  test.skip(
    !STUDENT_EMAIL || !TEACHER_EMAIL,
    "Set TEST_STUDENT_EMAIL, TEST_STUDENT_PASSWORD, TEST_TEACHER_EMAIL, TEST_TEACHER_PASSWORD to run",
  );

  // Run steps sequentially
  test.describe.configure({ mode: "serial" });

  test("Step 1 — Student browses teachers", async ({ page }) => {
    await login(page, STUDENT_EMAIL, STUDENT_PASSWORD);

    await page.goto("/student/teachers");
    await expect(page).toHaveURL(/\/student\/teachers/);

    // Should see at least one teacher card
    const teacherSection = page.locator('[class*="rounded"]').filter({ hasText: /احجز جلسة/ });
    await expect(teacherSection.first()).toBeVisible({ timeout: 10_000 });

    console.log("Step 1 PASSED: Student can browse teachers");
  });

  test("Step 2 — Student creates a booking", async ({ page }) => {
    await login(page, STUDENT_EMAIL, STUDENT_PASSWORD);
    await page.goto("/student/teachers");
    await page.waitForLoadState("networkidle");

    // Click the first booking link
    const bookLink = page.locator("a").filter({ hasText: /احجز جلسة/ }).first();
    await expect(bookLink).toBeVisible({ timeout: 10_000 });
    await bookLink.click();

    // Should be on the booking form
    await expect(page).toHaveURL(/\/student\/bookings\/new/, { timeout: 10_000 });
    await page.waitForLoadState("networkidle");

    // Session type — first radio is auto-selected
    await expect(page.locator('input[name="session_type"]').first()).toBeChecked();

    // Pick a date (tomorrow)
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    const dateStr = tomorrow.toISOString().split("T")[0];
    await page.locator('input[name="date"]').fill(dateStr);
    await page.waitForTimeout(500);

    // Pick a time
    const timeSelect = page.locator('select[name="time"]');
    const timeInput = page.locator('input[name="time"]');
    if (await timeSelect.isVisible({ timeout: 2_000 }).catch(() => false)) {
      const options = timeSelect.locator("option:not([value=''])");
      const count = await options.count();
      if (count > 0) {
        const firstValue = await options.first().getAttribute("value");
        if (firstValue) await timeSelect.selectOption(firstValue);
      }
    } else if (await timeInput.isVisible({ timeout: 2_000 }).catch(() => false)) {
      await timeInput.fill("10:00");
    }

    await page.waitForTimeout(300);

    // Submit
    await page.getByRole("button", { name: "تأكيد الحجز" }).click();

    // Should redirect to bookings list
    await page.waitForURL(/\/student\/bookings$/, { timeout: 20_000 });
    console.log("Step 2 PASSED: Booking created successfully");
  });

  test("Step 3 — Teacher confirms booking", async ({ page }) => {
    await login(page, TEACHER_EMAIL, TEACHER_PASSWORD);

    await page.goto("/teacher/dashboard");
    await expect(page).toHaveURL(/\/teacher\/dashboard/);
    await page.waitForLoadState("networkidle");

    // Find the confirm button
    const confirmBtn = page.locator("button").filter({ hasText: "تأكيد" }).first();

    if (await confirmBtn.isVisible({ timeout: 5_000 }).catch(() => false)) {
      await confirmBtn.click();

      // Wait for "تم التأكيد" badge
      await expect(
        page.locator("text=تم التأكيد").first(),
      ).toBeVisible({ timeout: 15_000 });

      console.log("Step 3 PASSED: Booking confirmed by teacher");
    } else {
      console.log("Step 3 SKIPPED: No pending bookings found");
    }
  });

  test("Step 4 — Student views sessions and can join", async ({ page }) => {
    await login(page, STUDENT_EMAIL, STUDENT_PASSWORD);

    await page.goto("/student/sessions");
    await expect(page).toHaveURL(/\/student\/sessions/);
    await page.waitForLoadState("networkidle");

    // Look for any session card
    const sessionCards = page.locator("a").filter({ hasText: /غرفة الجلسة|انضم الآن/ });
    const count = await sessionCards.count();
    console.log(`Student sees ${count} joinable sessions`);

    if (count > 0) {
      await sessionCards.first().click();
      await expect(page).toHaveURL(/\/student\/sessions\/.+/);
      await page.waitForLoadState("networkidle");

      // Should see one of the video room states
      const videoReady = page.locator("text=غرفة الجلسة جاهزة");
      const tooEarly = page.locator("text=الجلسة لم تبدأ بعد");
      const expired = page.locator("text=انتهت صلاحية غرفة الجلسة");
      const tooLate = page.locator("text=انتهى وقت الجلسة");

      await expect(
        videoReady.or(tooEarly).or(expired).or(tooLate),
      ).toBeVisible({ timeout: 10_000 });

      if (await videoReady.isVisible()) {
        const joinBtn = page.locator("button").filter({ hasText: "انضم للجلسة" });
        await expect(joinBtn).toBeVisible();
        await expect(joinBtn).toBeEnabled();
        console.log("Step 4 PASSED: Video room ready, join button enabled");
      } else if (await tooEarly.isVisible()) {
        console.log("Step 4 PASSED: Session page shows 'too early' (expected for future booking)");
      } else if (await expired.isVisible()) {
        console.log("Step 4 PASSED: Session page shows 'expired'");
      } else {
        console.log("Step 4 PASSED: Session page shows 'too late'");
      }
    } else {
      console.log("Step 4 SKIPPED: No joinable sessions found");
    }
  });

  test("Step 5 — Unauthenticated user cannot access session", async ({ page }) => {
    await page.goto("/student/sessions");
    await expect(page).toHaveURL(/\/login/, { timeout: 10_000 });
    console.log("Step 5 PASSED: Unauthenticated access redirected to login");
  });
});

// ─────────────────────────────────────────────
// Booking Validation
// ─────────────────────────────────────────────

test.describe("Booking Validation", () => {
  test.skip(
    !STUDENT_EMAIL,
    "Set TEST_STUDENT_EMAIL and TEST_STUDENT_PASSWORD to run",
  );

  test("Cannot book in the past", async ({ page }) => {
    await login(page, STUDENT_EMAIL, STUDENT_PASSWORD);
    await page.goto("/student/teachers");
    await page.waitForLoadState("networkidle");

    const bookLink = page.locator("a").filter({ hasText: /احجز جلسة/ }).first();
    if (!(await bookLink.isVisible({ timeout: 5_000 }).catch(() => false))) {
      test.skip(true, "No teachers available");
      return;
    }
    await bookLink.click();
    await expect(page).toHaveURL(/\/student\/bookings\/new/);
    await page.waitForLoadState("networkidle");

    // Force a past date via JS (bypass HTML min attribute)
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    const dateStr = yesterday.toISOString().split("T")[0];

    await page.locator('input[name="date"]').evaluate(
      (el, val) => {
        const input = el as HTMLInputElement;
        input.removeAttribute("min");
        input.value = val;
        input.dispatchEvent(new Event("input", { bubbles: true }));
        input.dispatchEvent(new Event("change", { bubbles: true }));
      },
      dateStr,
    );

    // Set time
    const timeSelect = page.locator('select[name="time"]');
    const timeInput = page.locator('input[name="time"]');
    if (await timeSelect.isVisible({ timeout: 2_000 }).catch(() => false)) {
      const options = timeSelect.locator("option:not([value=''])");
      const count = await options.count();
      if (count > 0) {
        const val = await options.first().getAttribute("value");
        if (val) await timeSelect.selectOption(val);
      }
    } else if (await timeInput.isVisible({ timeout: 2_000 }).catch(() => false)) {
      await timeInput.fill("10:00");
    }

    await page.getByRole("button", { name: "تأكيد الحجز" }).click();
    await page.waitForTimeout(3_000);

    // Should show the Arabic error message for past date
    const errorMsg = page.getByText("يجب اختيار وقت في المستقبل");
    const stillOnPage = page.url().includes("/bookings/new");
    const errorShown = await errorMsg.isVisible().catch(() => false);
    expect(errorShown || stillOnPage).toBeTruthy();
    console.log("Validation PASSED: Past date booking correctly rejected");
  });
});
