import { test, expect, type APIRequestContext } from "@playwright/test";

/**
 * Visual + behavioural E2E for the booking paywall across BOTH teacher surfaces.
 *
 * Guards the defect this spec was written for: the teachers LIST gated its
 * "Book" button on "has an active subscription", while the teacher DETAIL page
 * did not gate its CTA at all — so a student with no credit was walked into the
 * booking form and only rejected at submit. Worse, "active subscription" is
 * narrower than createBooking's real precondition, so a student holding a
 * prepaid-hours wallet (no subscription) was shown a subscribe paywall despite
 * having paid.
 *
 * Both surfaces now read `hasBookableCredit` (src/lib/domains/package/ledger.ts).
 * This spec asserts they agree, in both directions, and captures Arabic-RTL
 * screenshots for the vision check the repo contract requires on UI changes.
 *
 * Self-contained local auth, matching student-billing-visual.spec.ts: create a
 * `@furqan.test` student via public signup (anon key), log in through the REAL
 * /login form so SSR cookies are correct, then seed/clear packages via a
 * service-role REST call. Skips when the local Supabase env is absent.
 */

// Use the URL the APP itself reads, NOT `SUPABASE_URL`. In a normal .env.local
// those are DIFFERENT projects: NEXT_PUBLIC_SUPABASE_URL is the local stack the
// dev server talks to, while SUPABASE_URL can still hold the hosted project
// (it does today). Seeding through the hosted one would both write to a real
// database and leave the page under test reading rows that were never created.
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "";

// Hard stop: this spec CREATES users and seeds packages. It may only ever run
// against a loopback Supabase. If the env points anywhere else we refuse to
// run rather than risk writing to a real project.
function isLoopback(url: string): boolean {
  try {
    const { hostname } = new URL(url);
    return hostname === "127.0.0.1" || hostname === "localhost" || hostname === "[::1]";
  } catch {
    return false;
  }
}

const hasEnv = !!SUPABASE_URL && !!SERVICE_KEY && !!ANON_KEY && isLoopback(SUPABASE_URL);

const EMAIL = "booking-paywall-visual@furqan.test";
const PASSWORD = "Test-Passw0rd!23";
const sbHeaders = { apikey: SERVICE_KEY, authorization: `Bearer ${SERVICE_KEY}` };
const anonHeaders = { apikey: ANON_KEY, "content-type": "application/json" };

/** Find-or-create the student; returns the user id. */
async function ensureStudent(api: APIRequestContext): Promise<string> {
  const signup = await api.post(`${SUPABASE_URL}/auth/v1/signup`, {
    headers: anonHeaders,
    data: { email: EMAIL, password: PASSWORD },
  });
  if (signup.ok()) {
    const b = (await signup.json()) as { id?: string; user?: { id?: string } };
    const id = b.id ?? b.user?.id;
    if (id) return id;
  }
  const tok = await api.post(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
    headers: anonHeaders,
    data: { email: EMAIL, password: PASSWORD },
  });
  expect(tok.ok(), `password grant failed: ${tok.status()} ${await tok.text()}`).toBe(true);
  const tb = (await tok.json()) as { user: { id: string } };
  return tb.user.id;
}

/** A teacher the student surfaces actually render (same filter both pages use). */
async function firstVisibleTeacherId(api: APIRequestContext): Promise<string> {
  const res = await api.get(
    `${SUPABASE_URL}/rest/v1/teacher_profiles` +
      `?select=teacher_id&is_archived=eq.false&is_accepting=eq.true&cv_status=eq.approved&limit=1`,
    { headers: sbHeaders },
  );
  expect(res.ok(), `teacher lookup failed: ${res.status()} ${await res.text()}`).toBe(true);
  const rows = (await res.json()) as { teacher_id: string }[];
  expect(rows.length, "local DB has no bookable teacher to render").toBeGreaterThan(0);
  return rows[0].teacher_id;
}

test.describe("booking paywall parity (list + detail)", () => {
  test.skip(
    !hasEnv,
    "requires a LOOPBACK NEXT_PUBLIC_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY + NEXT_PUBLIC_SUPABASE_ANON_KEY (this spec writes data, so it never runs against a remote project)",
  );

  test("list and detail agree, with and without a spendable credit", async ({ page, request }) => {
    let userId: string;
    try {
      userId = await ensureStudent(request);
    } catch (e) {
      test.skip(true, `local auth unavailable: ${(e as Error).message}`);
      return;
    }
    const teacherId = await firstVisibleTeacherId(request);

    const prof = await request.post(`${SUPABASE_URL}/rest/v1/profiles?on_conflict=id`, {
      headers: {
        ...sbHeaders,
        "content-type": "application/json",
        Prefer: "resolution=merge-duplicates",
      },
      data: { id: userId, role: "student", roles: ["student"], onboarding_completed: true },
    });
    expect(prof.ok(), `profile upsert failed: ${prof.status()} ${await prof.text()}`).toBe(true);

    // Deterministic "no credit" starting point.
    await request.delete(`${SUPABASE_URL}/rest/v1/student_packages?student_id=eq.${userId}`, {
      headers: sbHeaders,
    });

    await page.goto("/login");
    await page.fill('input[name="email"]', EMAIL);
    await page.fill('input[name="password"]', PASSWORD);
    await Promise.all([
      page.waitForURL(/\/student\//, { timeout: 20_000 }).catch(() => {}),
      page.click('button[type="submit"]'),
    ]);

    // ── No credit: BOTH surfaces show the paywall ──────────────────────────
    await page.goto("/student/teachers");
    await expect(page.getByRole("link", { name: /اشترك للحجز|Subscribe to Book/ }).first()).toBeVisible();
    await expect(page.getByRole("link", { name: /^احجز جلسة$|^Book Session$/ })).toHaveCount(0);
    await page.screenshot({
      path: "e2e/__screenshots__/booking-paywall-list-locked.png",
      fullPage: true,
    });

    await page.goto(`/student/teachers/${teacherId}`);
    // The regression: this CTA used to be an ungated link into the booking form.
    const lockedCta = page.getByRole("link", { name: /اشترك للحجز|Subscribe to Book/ });
    await expect(lockedCta.first()).toBeVisible();
    await expect(lockedCta.first()).toHaveAttribute("href", "/pricing");
    await page.screenshot({
      path: "e2e/__screenshots__/booking-paywall-detail-locked.png",
      fullPage: true,
    });

    // ── Prepaid-hours wallet, NO subscription ──────────────────────────────
    // The second half of the defect: this student has paid and holds spendable
    // credit, so the old subscription-only check wrongly showed them a paywall.
    const seed = await request.post(`${SUPABASE_URL}/rest/v1/student_packages`, {
      headers: { ...sbHeaders, "content-type": "application/json", Prefer: "return=minimal" },
      data: [
        {
          student_id: userId,
          sessions_total: 4,
          sessions_used: 0,
          status: "active",
          product_type: "prepaid_hours",
        },
      ],
    });
    expect(seed.ok(), `seed package failed: ${seed.status()} ${await seed.text()}`).toBe(true);

    await page.goto("/student/teachers");
    await expect(page.getByRole("link", { name: /احجز جلسة|Book Session/ }).first()).toBeVisible();
    await expect(page.getByRole("link", { name: /اشترك للحجز|Subscribe to Book/ })).toHaveCount(0);
    await page.screenshot({
      path: "e2e/__screenshots__/booking-paywall-list-unlocked.png",
      fullPage: true,
    });

    await page.goto(`/student/teachers/${teacherId}`);
    const openCta = page.getByRole("link", { name: /احجز جلسة|Book a session/ }).first();
    await expect(openCta).toBeVisible();
    await expect(openCta).toHaveAttribute("href", `/student/bookings/new?teacher=${teacherId}`);
    await page.screenshot({
      path: "e2e/__screenshots__/booking-paywall-detail-unlocked.png",
      fullPage: true,
    });

    // The pay-per-session form is the path for a student holding no package —
    // it must never be hidden by the paywall branch.
    await request.delete(`${SUPABASE_URL}/rest/v1/student_packages?student_id=eq.${userId}`, {
      headers: sbHeaders,
    });
    await page.goto(`/student/teachers/${teacherId}`);
    await expect(
      page.getByText(/اختر موعد الجلسة|Choose a session time|لا توجد مواعيد متاحة|No times available/),
    ).toBeVisible();

    // RTL sanity: Arabic is the default direction on these surfaces.
    expect(await page.locator("[dir='rtl']").count()).toBeGreaterThan(0);
  });
});
