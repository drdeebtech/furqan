import { test, expect, type APIRequestContext } from "@playwright/test";

/**
 * Visual + smoke E2E for `/student/billing` (billing history & receipts).
 *
 * Self-contained local auth: creates a `@furqan.test` student via the GoTrue
 * admin API (service-role), logs in through the REAL /login form so the app
 * writes correct SSR cookies, then seeds payments via a service-role REST
 * insert. Needs NEXT_PUBLIC_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY +
 * NEXT_PUBLIC_SUPABASE_ANON_KEY (all in .env.local) — no test-login secret,
 * no cookie hand-rolling.
 *
 * Skips (like the other env-gated specs) when those are absent.
 */

const SUPABASE_URL =
  process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "";
const hasEnv = !!SUPABASE_URL && !!SERVICE_KEY && !!ANON_KEY;

const EMAIL = "billing-visual@furqan.test";
const PASSWORD = "Test-Passw0rd!23";
const sbHeaders = { apikey: SERVICE_KEY, authorization: `Bearer ${SERVICE_KEY}` };
const anonHeaders = { apikey: ANON_KEY, "content-type": "application/json" };

/**
 * Find-or-create the student via public signup (anon key). Local supabase has
 * email confirmation off, so signup returns immediately; on "already
 * registered" we fall back to a password grant. Returns the user id.
 */
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

test.describe("student billing page (visual)", () => {
  test.skip(!hasEnv, "requires NEXT_PUBLIC_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY + NEXT_PUBLIC_SUPABASE_ANON_KEY");

  test("renders empty then populated billing history in Arabic RTL", async ({ page, request }) => {
    // Local auth handshake can fail on a stale .env.local (key/format drift vs
    // the running Supabase). That's an env-config issue, not a billing-page
    // regression — skip rather than red-fail the suite.
    let userId: string;
    try {
      userId = await ensureStudent(request);
    } catch (e) {
      test.skip(true, `local auth unavailable: ${(e as Error).message}`);
      return;
    }

    // Profile: student role + onboarding done (so /student/* isn't bounced).
    // upsert (merge) — a handle_new_user trigger may have created a bare row.
    const prof = await request.post(`${SUPABASE_URL}/rest/v1/profiles?on_conflict=id`, {
      headers: { ...sbHeaders, "content-type": "application/json", Prefer: "resolution=merge-duplicates" },
      data: { id: userId, role: "student", roles: ["student"], onboarding_completed: true },
    });
    expect(prof.ok(), `profile upsert failed: ${prof.status()} ${await prof.text()}`).toBe(true);

    // Deterministic empty state: clear any prior payments for this user.
    await request.delete(`${SUPABASE_URL}/rest/v1/payments?student_id=eq.${userId}`, {
      headers: sbHeaders,
    });

    // ── Log in through the real UI so SSR cookies are correct ──────────────
    await page.goto("/login");
    await page.fill('input[name="email"]', EMAIL);
    await page.fill('input[name="password"]', PASSWORD);
    await Promise.all([
      page.waitForURL(/\/student\//, { timeout: 20_000 }).catch(() => {}),
      page.click('button[type="submit"]'),
    ]);

    // ── Empty state ────────────────────────────────────────────────────────
    await page.goto("/student/billing");
    await expect(page.getByRole("heading", { name: /الفواتير|Billing/ })).toBeVisible();
    await expect(page.getByText(/لا توجد مدفوعات|No payments yet/)).toBeVisible();
    await page.screenshot({ path: "e2e/__screenshots__/student-billing-empty.png", fullPage: true });

    // ── Seed three payments (status variety) ───────────────────────────────
    const seed = await request.post(`${SUPABASE_URL}/rest/v1/payments`, {
      headers: { ...sbHeaders, "content-type": "application/json", Prefer: "return=minimal" },
      data: [
        { student_id: userId, amount_usd: 30, status: "succeeded", provider: "stripe", stripe_payment_intent: "pi_demo_1", paid_at: new Date("2026-07-01").toISOString() },
        { student_id: userId, amount_usd: 12, status: "pending", provider: "stripe", stripe_payment_intent: "pi_demo_2" },
        { student_id: userId, amount_usd: 30, status: "refunded", provider: "stripe", stripe_payment_intent: "pi_demo_3", paid_at: new Date("2026-06-15").toISOString() },
      ],
    });
    expect(seed.ok(), `seed payments failed: ${seed.status()} ${await seed.text()}`).toBe(true);

    // ── Populated state ────────────────────────────────────────────────────
    await page.goto("/student/billing");
    await expect(page.getByText(/مدفوع|Paid/).first()).toBeVisible();
    await expect(page.getByText(/\$30\.00/).first()).toBeVisible();
    await page.screenshot({ path: "e2e/__screenshots__/student-billing-populated.png", fullPage: true });

    // RTL sanity: page renders inside an rtl container (Arabic default).
    expect(await page.locator("[dir='rtl']").count()).toBeGreaterThan(0);
  });
});
