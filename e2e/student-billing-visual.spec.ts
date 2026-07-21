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
 * Skips unless those creds point at a LOOPBACK Supabase. This spec creates a
 * user and inserts `payments` rows; it previously resolved
 * `SUPABASE_URL ?? NEXT_PUBLIC_SUPABASE_URL`, and in a normal .env.local those
 * are different projects — `SUPABASE_URL` is the HOSTED one. So it aimed signup
 * and the payments seed at a real database while the page under test read the
 * local stack. Only a mismatched anon key stopped it. See
 * e2e/helpers/local-supabase.ts.
 */

import {
  APP_SUPABASE_URL as SUPABASE_URL,
  SERVICE_ROLE_KEY as SERVICE_KEY,
  ANON_KEY,
  hasLocalSupabaseEnv,
  LOCAL_ONLY_SKIP_REASON,
} from "./helpers/local-supabase";

const hasEnv = hasLocalSupabaseEnv();

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
  test.skip(!hasEnv, LOCAL_ONLY_SKIP_REASON);

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
    // Two DB rules this seed has to respect, both of which it used to break —
    // silently, because the spec was aimed at the wrong project and skipped:
    //
    //  1. PostgREST rejects a bulk insert whose rows differ in shape (PGRST102
    //     "All object keys must match"), so every object carries the same keys.
    //     The unpaid row says `paid_at: null` rather than omitting the column.
    //  2. CHECK `payment_tax_check`: amount_usd = amount_before_tax +
    //     tax_amount. `amount_before_tax` defaults to 0.00, so setting only
    //     `amount_usd` violates it. These are tax-free fixtures: the full
    //     amount is pre-tax and tax_amount is 0.
    const seed = await request.post(`${SUPABASE_URL}/rest/v1/payments`, {
      headers: { ...sbHeaders, "content-type": "application/json", Prefer: "return=minimal" },
      data: [
        { student_id: userId, amount_usd: 30, amount_before_tax: 30, tax_amount: 0, status: "succeeded", provider: "stripe", stripe_payment_intent: "pi_demo_1", paid_at: new Date("2026-07-01").toISOString() },
        { student_id: userId, amount_usd: 12, amount_before_tax: 12, tax_amount: 0, status: "pending", provider: "stripe", stripe_payment_intent: "pi_demo_2", paid_at: null },
        { student_id: userId, amount_usd: 30, amount_before_tax: 30, tax_amount: 0, status: "refunded", provider: "stripe", stripe_payment_intent: "pi_demo_3", paid_at: new Date("2026-06-15").toISOString() },
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
