import { test, expect, type Page } from "@playwright/test";

/**
 * E2E: Student booking flow (issue #554).
 *
 * Drives the real /student/bookings/new form (booking-form.tsx) end-to-end:
 * pick session type → date → time → review → confirm, then asserts both the
 * UI confirmation (redirect to /student/dashboard?booked=1) AND the bookings
 * row in the DB (service-role REST read, mirroring daily-webhook-reconciliation).
 *
 * ── Auth mechanism ──────────────────────────────────────────────────────────
 * Uses the project's TEST-ONLY login route at POST /api/auth/test-login (see
 * src/app/api/auth/test-login/route.ts). That route is purpose-built for
 * Playwright/TestSprite: it upserts a `@furqan.test` user + profile and mints
 * a real Supabase session cookie directly through the SSR client — so the
 * cookies land in the response Set-Cookie headers and Playwright's request
 * context stores them automatically. No manual cookie chunking needed.
 *
 * The route is DISABLED in production/preview by four independent gates
 * (NODE_ENV, VERCEL env, ALLOW_TEST_LOGIN, TEST_LOGIN_SECRET) — see route.ts.
 * It can ONLY run locally (or in a CI box without VERCEL set + opt-in env).
 *
 * ── Why not the password-grant helper used by session-flow.spec.ts? ─────────
 * Those specs authenticate pre-provisioned `@furqan.app` accounts. The
 * #554 contract requires `@furqan.test` accounts (never production), and the
 * test-login route is the only mechanism in this repo that creates and
 * authenticates `@furqan.test` users. So this spec uses the route directly.
 *
 * ── Required env (skipped otherwise, like session-flow/retention-smoke) ─────
 *   TEST_LOGIN_SECRET          — shared secret sent via x-test-login-secret
 *   FURQAN_TEST_TEACHER_ID     — UUID of a teacher whose teacher_profiles row
 *                                has is_accepting=true, is_archived=false
 *   SUPABASE_URL               — project URL (for the DB assertion)
 *   SUPABASE_SERVICE_ROLE_KEY  — bypasses RLS for the read-only DB check
 *
 * The dev server must have ALLOW_TEST_LOGIN=true (the route 404s otherwise,
 * which surfaces as a clear test failure rather than a silent skip).
 */

const TEST_LOGIN_SECRET = process.env.TEST_LOGIN_SECRET ?? "";
const TEACHER_ID = process.env.FURQAN_TEST_TEACHER_ID ?? "";
const SUPABASE_URL = process.env.SUPABASE_URL ?? "";
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";

const hasFullEnv =
  !!TEST_LOGIN_SECRET && !!TEACHER_ID && !!SUPABASE_URL && !!SUPABASE_KEY;

// ─────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────

interface TestLoginResponse {
  ok?: boolean;
  userId?: string;
  email?: string;
  role?: string;
  error?: string;
}

/**
 * Logs in a @furqan.test student via the test-login route. Cookies are set on
 * the route's HTTP response and land in `page`'s context automatically because
 * `page.request` shares the BrowserContext cookie jar.
 *
 * Returns the student's userId (used for the DB assertion).
 */
async function loginAsTestStudent(page: Page): Promise<string> {
  const baseURL = process.env.BASE_URL ?? "http://localhost:3000";
  const res = await page.request.post(`${baseURL}/api/auth/test-login`, {
    headers: {
      "content-type": "application/json",
      "x-test-login-secret": TEST_LOGIN_SECRET,
    },
    data: { role: "student" },
  });

  expect(res.ok(), `test-login failed: HTTP ${res.status()}`).toBe(true);
  const body = (await res.json()) as TestLoginResponse;
  expect(body.ok, `test-login returned non-ok: ${JSON.stringify(body)}`).toBe(true);
  expect(body.userId).toBeTruthy();
  return body.userId as string;
}

interface BookingRow {
  id: string;
  status: string;
  session_type: string;
  teacher_id: string;
}

/** Read-only service-role SELECT (mirrors daily-webhook-reconciliation.spec.ts). */
async function fetchLatestBookingForStudent(studentId: string): Promise<BookingRow | null> {
  const url =
    `${SUPABASE_URL}/rest/v1/bookings` +
    `?student_id=eq.${encodeURIComponent(studentId)}` +
    `&teacher_id=eq.${encodeURIComponent(TEACHER_ID)}` +
    `&select=id,status,session_type,teacher_id` +
    `&order=created_at.desc&limit=1`;
  const res = await fetch(url, {
    headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` },
  });
  const rows = (await res.json()) as BookingRow[];
  return rows[0] ?? null;
}

// ─────────────────────────────────────────────
// Tests
// ─────────────────────────────────────────────

test.describe("Student booking flow — /student/bookings/new", () => {
  test.skip(
    !hasFullEnv,
    "Set TEST_LOGIN_SECRET, FURQAN_TEST_TEACHER_ID, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY to run",
  );

  test("student selects teacher + session type and creates a booking", async ({ page }) => {
    const studentId = await loginAsTestStudent(page);

    // searchParams.teacher is required by the page (redirects otherwise).
    await page.goto(`/student/bookings/new?teacher=${TEACHER_ID}`);
    await page.waitForLoadState("networkidle");

    // ── Session type ──
    // First option is selected by default (useState(sessionTypes[0])). When
    // more than one session type is offered, click a NON-DEFAULT option so
    // the aria-pressed assertion proves the selection wiring actually flips
    // (the default already passes aria-pressed="true" even on regression),
    // and the DB assertion proves the chosen session_type was persisted.
    // Selector source: src/app/student/bookings/new/booking-form.tsx →
    //   data-testid={`session-type-option-${s}`} where `s` is the SessionType
    //   string value (hifz, tajweed, muraja, tilawa, qiraat, tafsir,
    //   combined, other) — stable regardless of teacher-dependent labels.
    const sessionTypeOptions = page.locator("[data-testid^='session-type-option-']");
    const optionCount = await sessionTypeOptions.count();
    expect(optionCount, "expected at least one session-type option").toBeGreaterThan(0);

    // Pick the second option when available (non-default), else the only one.
    const chosenIndex = optionCount > 1 ? 1 : 0;
    const sessionTypeBtn = sessionTypeOptions.nth(chosenIndex);
    await expect(sessionTypeBtn).toBeVisible({ timeout: 10_000 });

    // Derive the session_type value from the testid suffix so the DB
    // assertion can compare against the exact value that was clicked.
    const chosenTestId = await sessionTypeBtn.getAttribute("data-testid");
    const chosenSessionType =
      chosenTestId?.replace(/^session-type-option-/, "") ?? "";
    expect(chosenSessionType, "could not derive session_type from testid").toBeTruthy();
    if (optionCount > 1) {
      const firstTestId = await sessionTypeOptions.nth(0).getAttribute("data-testid");
      const firstSessionType = firstTestId?.replace(/^session-type-option-/, "") ?? "";
      // Sanity: the chosen non-default option must differ from the default.
      expect(chosenSessionType).not.toBe(firstSessionType);
    }

    await sessionTypeBtn.click();
    await expect(sessionTypeBtn).toHaveAttribute("aria-pressed", "true");
    if (optionCount > 1) {
      // Default must release — proves aria-pressed flipped, not just stayed.
      await expect(sessionTypeOptions.nth(0)).toHaveAttribute("aria-pressed", "false");
    }

    // ── Date ──
    // Date buttons render client-side after the mount gate (useSyncExternalStore).
    // Selector source: booking-form.tsx → aria-label="تاريخ {label} - متاح"
    // (unavailable ones end with "- غير متاح", so /- متاح$/ is unique to available).
    const availableDate = page.getByRole("button", { name: / - متاح$/ }).first();
    await expect(availableDate).toBeVisible({ timeout: 10_000 });
    await availableDate.click();

    // ── Time ──
    // Two branches in booking-form.tsx:
    //   (a) teacher has availability → time-slot buttons with aria-label="الوقت HH:MM"
    //   (b) no availability → <input type="time"> (unique on the page)
    const timeSlot = page.getByRole("button", { name: /^الوقت / });
    const timeInput = page.locator('input[type="time"]');
    if (await timeSlot.first().isVisible({ timeout: 3_000 }).catch(() => false)) {
      await timeSlot.first().click();
    } else {
      await expect(timeInput).toBeVisible({ timeout: 3_000 });
      await timeInput.fill("10:00");
    }

    // ── Review step ──
    // Selector source: booking-form.tsx → <button>التالي — مراجعة الحجز</button>
    await page.getByRole("button", { name: "التالي — مراجعة الحجز" }).click();

    // Confirmation panel mounts; the final submit lives inside the <form> that
    // fires the createBooking server action. Selector source: booking-form.tsx
    // → <button type="submit">…تأكيد الحجز</button>
    const confirmBtn = page.getByRole("button", { name: "تأكيد الحجز" });
    await expect(confirmBtn).toBeVisible({ timeout: 10_000 });

    // Capture booking count before submit so the DB assertion is robust against
    // pre-existing rows for this student/teacher pair.
    const before = await fetchLatestBookingForStudent(studentId);

    await confirmBtn.click();

    // ── UI assertion: redirect to dashboard with booked=1 ──
    // Selector source: src/app/student/bookings/new/actions.ts → redirect(...).
    // The action redirects to "/student/dashboard?booked=1" on success.
    await page.waitForURL(/\/student\/dashboard\?booked=1/, { timeout: 30_000 });
    expect(page.url()).toContain("booked=1");

    // ── DB assertion: bookings row exists for this student+teacher ──
    // Poll briefly: the redirect fires after the row is committed, but a CI
    // read-replica lag is a real failure mode we don't want to flake on.
    await expect
      .poll(async () => {
        const row = await fetchLatestBookingForStudent(studentId);
        return row?.id ?? null;
      }, { timeout: 10_000, intervals: [500, 1_000, 2_000] })
      .not.toBe(before?.id ?? null);

    const row = await fetchLatestBookingForStudent(studentId);
    expect(row, "expected a bookings row for the test student+teacher").not.toBeNull();
    expect(row?.teacher_id).toBe(TEACHER_ID);
    expect(row?.session_type, "persisted session_type must match the clicked option").toBe(chosenSessionType);
    expect(typeof row?.id).toBe("string");
  });
});
