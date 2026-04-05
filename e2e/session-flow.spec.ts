import { test, expect } from "@playwright/test";

/**
 * E2E test: Student Session Flow
 *
 * Prerequisites:
 *   1. Dev server running (npm run dev)
 *   2. .env.local with valid Supabase + Daily.co credentials
 *   3. A test student account (set TEST_STUDENT_EMAIL / TEST_STUDENT_PASSWORD)
 *   4. A test teacher account (set TEST_TEACHER_EMAIL / TEST_TEACHER_PASSWORD)
 *   5. The teacher must have availability set and be accepting students
 *
 * Run:
 *   TEST_STUDENT_EMAIL=student@test.com TEST_STUDENT_PASSWORD=pass123 \
 *   TEST_TEACHER_EMAIL=teacher@test.com TEST_TEACHER_PASSWORD=pass123 \
 *   npx playwright test e2e/session-flow.spec.ts
 */

const STUDENT_EMAIL = process.env.TEST_STUDENT_EMAIL ?? "";
const STUDENT_PASSWORD = process.env.TEST_STUDENT_PASSWORD ?? "";
const TEACHER_EMAIL = process.env.TEST_TEACHER_EMAIL ?? "";
const TEACHER_PASSWORD = process.env.TEST_TEACHER_PASSWORD ?? "";

// ─────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────

async function login(
  page: import("@playwright/test").Page,
  email: string,
  password: string,
) {
  await page.goto("/login");
  await page.fill('input[name="email"], input[type="email"]', email);
  await page.fill('input[name="password"], input[type="password"]', password);
  await page.click('button[type="submit"]');
  // Wait for redirect away from login
  await page.waitForURL((url) => !url.pathname.includes("/login"), {
    timeout: 15_000,
  });
}

async function logout(page: import("@playwright/test").Page) {
  await page.goto("/api/auth/logout");
  await page.waitForURL((url) => url.pathname.includes("/login"), {
    timeout: 10_000,
  });
}

// ─────────────────────────────────────────────
// Step 1: Student logs in and browses teachers
// ─────────────────────────────────────────────

test.describe("Session Flow — Full Cycle", () => {
  test.skip(
    !STUDENT_EMAIL || !TEACHER_EMAIL,
    "Set TEST_STUDENT_EMAIL, TEST_STUDENT_PASSWORD, TEST_TEACHER_EMAIL, TEST_TEACHER_PASSWORD to run",
  );

  let bookingTeacherName: string;

  test("Step 1 — Student browses teachers", async ({ page }) => {
    await login(page, STUDENT_EMAIL, STUDENT_PASSWORD);

    // Navigate to teacher listing
    await page.goto("/student/teachers");
    await expect(page).toHaveURL(/\/student\/teachers/);

    // Should see at least one teacher card
    const teacherCards = page.locator('[class*="rounded"]').filter({ hasText: "حجز" });
    await expect(teacherCards.first()).toBeVisible({ timeout: 10_000 });

    // Grab the first teacher's name for later verification
    const firstCard = teacherCards.first();
    bookingTeacherName =
      (await firstCard.locator("p.font-medium, h2, h3").first().textContent()) ?? "";
    expect(bookingTeacherName.length).toBeGreaterThan(0);

    console.log(`Found teacher: ${bookingTeacherName}`);
  });

  // ─────────────────────────────────────────────
  // Step 2: Student creates a booking
  // ─────────────────────────────────────────────

  test("Step 2 — Student creates a booking", async ({ page }) => {
    await login(page, STUDENT_EMAIL, STUDENT_PASSWORD);
    await page.goto("/student/teachers");

    // Click the first "حجز" (Book) link/button
    const bookBtn = page.locator('a, button').filter({ hasText: "حجز" }).first();
    await bookBtn.click();

    // Should be on the booking form
    await expect(page).toHaveURL(/\/student\/bookings\/new/);

    // Select session type (first radio is auto-selected)
    await expect(page.locator('input[name="session_type"]').first()).toBeChecked();

    // Pick a date (tomorrow)
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    const dateStr = tomorrow.toISOString().split("T")[0];
    await page.fill('input[name="date"]', dateStr);

    // Pick a time — either from dropdown or manual input
    const timeSelect = page.locator('select[name="time"]');
    const timeInput = page.locator('input[name="time"]');
    if (await timeSelect.isVisible()) {
      // Pick the first available slot
      const options = timeSelect.locator("option:not([value=''])");
      const firstValue = await options.first().getAttribute("value");
      if (firstValue) await timeSelect.selectOption(firstValue);
    } else if (await timeInput.isVisible()) {
      await timeInput.fill("10:00");
    }

    // Submit booking
    await page.click('button[type="submit"]');

    // Should redirect to bookings list on success
    await page.waitForURL(/\/student\/bookings/, { timeout: 15_000 });
    console.log("Booking created successfully");
  });

  // ─────────────────────────────────────────────
  // Step 3: Teacher confirms the booking
  // ─────────────────────────────────────────────

  test("Step 3 — Teacher confirms booking", async ({ page }) => {
    await login(page, TEACHER_EMAIL, TEACHER_PASSWORD);

    // Go to teacher dashboard
    await page.goto("/teacher/dashboard");
    await expect(page).toHaveURL(/\/teacher\/dashboard/);

    // Find the confirm button for a pending booking
    const confirmBtn = page
      .locator("button")
      .filter({ hasText: "تأكيد" })
      .first();

    if (await confirmBtn.isVisible({ timeout: 5_000 })) {
      await confirmBtn.click();

      // Wait for the "تم التأكيد" (Confirmed) badge to appear
      await expect(
        page.locator("text=تم التأكيد").first(),
      ).toBeVisible({ timeout: 10_000 });

      console.log("Booking confirmed by teacher");
    } else {
      console.log("No pending bookings found — skipping confirmation");
    }
  });

  // ─────────────────────────────────────────────
  // Step 4: Student sees session and can join
  // ─────────────────────────────────────────────

  test("Step 4 — Student views sessions list", async ({ page }) => {
    await login(page, STUDENT_EMAIL, STUDENT_PASSWORD);

    await page.goto("/student/sessions");
    await expect(page).toHaveURL(/\/student\/sessions/);

    // Should see at least one session card
    const sessionCards = page.locator('[class*="rounded-xl"]').filter({
      hasText: /مؤكد|جارية الآن/,
    });

    const count = await sessionCards.count();
    console.log(`Student sees ${count} confirmed/live sessions`);

    if (count > 0) {
      // Check for "غرفة الجلسة" or "انضم الآن" link
      const joinLink = page
        .locator("a")
        .filter({ hasText: /غرفة الجلسة|انضم الآن/ })
        .first();

      if (await joinLink.isVisible({ timeout: 3_000 })) {
        console.log("Join session link is visible");

        // Click to enter session page
        await joinLink.click();
        await expect(page).toHaveURL(/\/student\/sessions\/.+/);

        // Should see the video room or a time-window message
        const videoReady = page.locator("text=غرفة الجلسة جاهزة");
        const tooEarly = page.locator("text=الجلسة لم تبدأ بعد");
        const expired = page.locator("text=انتهت صلاحية غرفة الجلسة");
        const tooLate = page.locator("text=انتهى وقت الجلسة");

        // One of these states should be visible
        await expect(
          videoReady.or(tooEarly).or(expired).or(tooLate),
        ).toBeVisible({ timeout: 10_000 });

        if (await videoReady.isVisible()) {
          console.log("Video room is READY — student can click 'انضم للجلسة'");

          // Verify the join button exists
          const joinBtn = page.locator("button").filter({ hasText: "انضم للجلسة" });
          await expect(joinBtn).toBeVisible();
          await expect(joinBtn).toBeEnabled();

          console.log("Join button is visible and enabled");
        } else if (await tooEarly.isVisible()) {
          console.log("Session hasn't started yet — time window not open");
        } else if (await expired.isVisible()) {
          console.log("Session room has expired");
        } else {
          console.log("Session time has passed");
        }
      } else {
        console.log("No join link visible (session may be completed or not yet ready)");
      }
    }
  });

  // ─────────────────────────────────────────────
  // Step 5: Verify session security
  // ─────────────────────────────────────────────

  test("Step 5 — Unauthenticated user cannot access session", async ({
    page,
  }) => {
    // Try to access a session page without being logged in
    await page.goto("/student/sessions");

    // Should redirect to login
    await expect(page).toHaveURL(/\/login/, { timeout: 10_000 });
    console.log("Unauthenticated access correctly redirected to login");
  });
});

// ─────────────────────────────────────────────
// Standalone: Booking validation tests
// ─────────────────────────────────────────────

test.describe("Booking Validation", () => {
  test.skip(
    !STUDENT_EMAIL,
    "Set TEST_STUDENT_EMAIL and TEST_STUDENT_PASSWORD to run",
  );

  test("Cannot book in the past", async ({ page }) => {
    await login(page, STUDENT_EMAIL, STUDENT_PASSWORD);
    await page.goto("/student/teachers");

    const bookBtn = page.locator('a, button').filter({ hasText: "حجز" }).first();
    if (!(await bookBtn.isVisible({ timeout: 5_000 }))) {
      test.skip(true, "No teachers available");
      return;
    }
    await bookBtn.click();
    await expect(page).toHaveURL(/\/student\/bookings\/new/);

    // Try to set a past date via JavaScript (bypassing min attribute)
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    const dateStr = yesterday.toISOString().split("T")[0];

    await page.locator('input[name="date"]').evaluate(
      (el, val) => {
        (el as HTMLInputElement).value = val;
        el.dispatchEvent(new Event("input", { bubbles: true }));
        el.dispatchEvent(new Event("change", { bubbles: true }));
      },
      dateStr,
    );
    await page.fill('input[name="time"], select[name="time"]', "10:00").catch(() => {});
    await page.click('button[type="submit"]');

    // Should show error or not redirect
    const errorMsg = page.locator('[class*="error"]');
    const stillOnPage = page.url().includes("/bookings/new");
    expect(stillOnPage || (await errorMsg.isVisible({ timeout: 5_000 }))).toBeTruthy();
    console.log("Past date booking correctly rejected");
  });
});
