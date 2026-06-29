import { test, expect, type Page } from "@playwright/test";

/**
 * E2E: Teacher ḥifẓ progress capture (issue #554).
 *
 * Drives the ProgressCaptureForm rendered on a completed session page
 * (src/app/teacher/sessions/[id]/page.tsx → PostSessionForm → ProgressCaptureForm)
 * and asserts that a validated `student_progress` row exists after submit.
 *
 * ── Auth mechanism ──────────────────────────────────────────────────────────
 * Same as student-booking-flow.spec.ts: POST /api/auth/test-login with
 * role=teacher. The route upserts `test-teacher@furqan.test`, mints a real
 * Supabase session cookie via the SSR client, and the cookies land in `page`'s
 * context automatically. See that spec + src/app/api/auth/test-login/route.ts.
 *
 * ── Ayah range ──────────────────────────────────────────────────────────────
 * Al-Fātihah (sūrah 1) has 7 āyāt (src/lib/quran/ayah-counts.ts). The form
 * defaults to surahFrom=1, ayahFrom=1, surahTo=1, ayahTo=1, so we only need to
 * set ayahTo=7. This range passes validateRange() (src/lib/domains/progress/
 * validation.ts) and the DB trigger `validate_student_progress_range`
 * (the hard guard behind the `record_student_progress` RPC).
 *
 * ── Idempotency ─────────────────────────────────────────────────────────────
 * The `record_student_progress` RPC upserts on (student_id, booking_id) —
 * see supabase/migrations/20260613150000_cap_record_student_progress_errors.sql
 * — so re-running this test against the same fixture session updates the row
 * instead of failing the unique constraint. The assertion is presence + values.
 *
 * ── Required env (skipped otherwise) ────────────────────────────────────────
 *   TEST_LOGIN_SECRET                       — x-test-login-secret header value
 *   FURQAN_TEST_COMPLETED_SESSION_ID        — UUID of a session whose row has
 *                                             ended_at set, whose booking is
 *                                             owned by test-teacher@furqan.test
 *   SUPABASE_URL                            — project URL (DB assertion)
 *   SUPABASE_SERVICE_ROLE_KEY               — bypasses RLS for the read
 */

const TEST_LOGIN_SECRET = process.env.TEST_LOGIN_SECRET ?? "";
const COMPLETED_SESSION_ID = process.env.FURQAN_TEST_COMPLETED_SESSION_ID ?? "";
const SUPABASE_URL = process.env.SUPABASE_URL ?? "";
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";

const hasFullEnv =
  !!TEST_LOGIN_SECRET &&
  !!COMPLETED_SESSION_ID &&
  !!SUPABASE_URL &&
  !!SUPABASE_KEY;

// Al-Fātihah bounds (canonical — src/lib/quran/ayah-counts.ts, index 1 = 7).
const SURAH_FROM = 1;
const AYAH_FROM = 1;
const SURAH_TO = 1;
const AYAH_TO = 7;

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

/** Logs in a @furqan.test teacher via the test-login route. */
async function loginAsTestTeacher(page: Page): Promise<void> {
  const baseURL = process.env.BASE_URL ?? "http://localhost:3000";
  const res = await page.request.post(`${baseURL}/api/auth/test-login`, {
    headers: {
      "content-type": "application/json",
      "x-test-login-secret": TEST_LOGIN_SECRET,
    },
    data: { role: "teacher" },
  });

  expect(res.ok(), `test-login failed: HTTP ${res.status()}`).toBe(true);
  const body = (await res.json()) as TestLoginResponse;
  expect(body.ok, `test-login returned non-ok: ${JSON.stringify(body)}`).toBe(true);
  expect(body.userId).toBeTruthy();
}

/** Resolve a session UUID → its booking_id (service-role REST read). */
async function resolveBookingId(sessionId: string): Promise<string> {
  const url =
    `${SUPABASE_URL}/rest/v1/sessions` +
    `?id=eq.${encodeURIComponent(sessionId)}` +
    `&select=booking_id&limit=1`;
  const res = await fetch(url, {
    headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` },
  });
  const rows = (await res.json()) as { booking_id: string }[];
  const row = rows[0];
  expect(row?.booking_id, `session ${sessionId} has no booking_id`).toBeTruthy();
  return row.booking_id;
}

interface ProgressRow {
  surah_from: number | null;
  ayah_from: number | null;
  surah_to: number | null;
  ayah_to: number | null;
  progress_type: string | null;
}

async function fetchProgressForBooking(bookingId: string): Promise<ProgressRow | null> {
  const url =
    `${SUPABASE_URL}/rest/v1/student_progress` +
    `?booking_id=eq.${encodeURIComponent(bookingId)}` +
    `&select=surah_from,ayah_from,surah_to,ayah_to,progress_type` +
    `&limit=1`;
  const res = await fetch(url, {
    headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` },
  });
  // Narrow the REST payload through `unknown` + Array.isArray so the cast to
  // ProgressRow[] is provably sound under TS strict (Supabase returns either
  // a row array on 2xx or a `{ code, message }` object on error; the type
  // guard rejects the error shape before we treat it as rows).
  const payload: unknown = await res.json();
  const rows: ProgressRow[] = Array.isArray(payload)
    ? (payload as ProgressRow[])
    : [];
  return rows[0] ?? null;
}

// ─────────────────────────────────────────────
// Tests
// ─────────────────────────────────────────────

test.describe("Teacher progress capture — Al-Fātihah 1:1–1:7", () => {
  test.skip(
    !hasFullEnv,
    "Set TEST_LOGIN_SECRET, FURQAN_TEST_COMPLETED_SESSION_ID, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY to run",
  );

  test("teacher records a validated ḥifẓ range on a completed session", async ({ page }) => {
    await loginAsTestTeacher(page);
    const bookingId = await resolveBookingId(COMPLETED_SESSION_ID);

    await page.goto(`/teacher/sessions/${COMPLETED_SESSION_ID}`);
    await page.waitForLoadState("networkidle");

    // Sanity: the page must be the COMPLETED-session branch — only then does
    // page.tsx render <PostSessionForm>, which embeds <ProgressCaptureForm>.
    // Selector source: progress-capture-form.tsx → header span text.
    await expect(page.getByText("ماذا حفظ الطالب اليوم؟")).toBeVisible({ timeout: 10_000 });

    // ── RTL assertion ──
    // The completed-session flow is Arabic-first; the root <html> must carry
    // dir="rtl" (matches public-smoke.spec.ts's RTL contract check). Guards
    // against a lang/dir regression silently rendering the progress form LTR.
    const dir = await page.locator("html").getAttribute("dir");
    expect(dir, "completed-session page must render inside an RTL container").toBe("rtl");

    // The form defaults to progressType="new" (needsRange=true) with surahFrom
    // = ayahFrom = surahTo = ayahTo = 1, so the "From" end is already 1:1 and
    // surahTo is already Al-Fātihah. We only need to raise ayahTo 1 → 7.
    //
    // Selector source: progress-capture-form.tsx, RangeEnd "To" →
    //   <input type="number" aria-label="إلى ayah (1-${max})">
    // `max` = ayahCount(surahTo) = 7 for Al-Fātihah. Prefix-match the aria-label
    // so the assertion doesn't hard-code the (correct) max of 7.
    const ayahToInput = page.locator('input[aria-label^="إلى ayah"]').first();
    await expect(ayahToInput).toBeVisible({ timeout: 10_000 });
    await ayahToInput.fill(String(AYAH_TO));

    // Submit. Selector source: progress-capture-form.tsx →
    //   <button onClick={handleSave}>…تسجيل الحفظ…</button>
    const recordBtn = page.getByRole("button", { name: "تسجيل الحفظ" });
    await expect(recordBtn).toBeVisible();
    await recordBtn.click();

    // ── UI assertion: success feedback ──
    // handleSave() sets `saved=true` on success → ActionFeedback shows the
    // "تم تسجيل الحفظ" message (progress-capture-form.tsx).
    await expect(page.getByText("تم تسجيل الحفظ")).toBeVisible({ timeout: 15_000 });

    // ── DB assertion: student_progress row exists with the validated range ──
    // The RPC upserts on (student_id, booking_id); we assert the merged row.
    await expect
      .poll(async () => {
        const row = await fetchProgressForBooking(bookingId);
        return row
          ? `${row.surah_from}:${row.ayah_from}-${row.surah_to}:${row.ayah_to}`
          : null;
      }, { timeout: 10_000, intervals: [500, 1_000, 2_000] })
      .toBe(`${SURAH_FROM}:${AYAH_FROM}-${SURAH_TO}:${AYAH_TO}`);

    const row = await fetchProgressForBooking(bookingId);
    expect(row, "expected a student_progress row for the test booking").not.toBeNull();
    expect(row?.surah_from).toBe(SURAH_FROM);
    expect(row?.ayah_from).toBe(AYAH_FROM);
    expect(row?.surah_to).toBe(SURAH_TO);
    expect(row?.ayah_to).toBe(AYAH_TO);
  });
});
