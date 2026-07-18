/**
 * Spec 040 Phase 5 — E2E: the FULL teacher-payout money loop over real HTTP,
 * against the local stack (Supabase on 127.0.0.1:54322 + `next dev`), with
 * ZERO live Stripe calls.
 *
 * Journey (one serial spec, pure-HTTP request API — same idiom as
 * daily-webhook-idempotency.spec.ts):
 *   1. SEED (psql, service-side): teacher on the MANUAL payout rail
 *      (`teacher_profiles.payout_method='manual'`, hourly_rate=20), accepted
 *      agreement v1, armed cutover (set_connect_cutover_date '2026-01-01'),
 *      and one charge-funded chain: completed booking → session → succeeded
 *      stripe payment (pi_e2e_*) → session_delivery (60 min @ $20/h,
 *      delivered 60 days ago, past the 14-day hold).
 *   2. ADMIN SWEEP: real session via POST /api/auth/test-login (role admin),
 *      then POST /api/admin/payouts/sweep. The sweep materializes the ledger
 *      entry (amount_cents=2000, funding_charge_id=pi_*, agreement_version=1,
 *      transfer_group='delivery_'||id) and — manual rail — claims it and
 *      settles it to status='manual_due' WITHOUT any Stripe API call.
 *   3. REFUND CLAWBACK: POST /api/stripe/webhook with a charge.refunded event
 *      signed locally (t=..,v1=HMAC-SHA256(`${t}.${body}`, STRIPE_WEBHOOK_SECRET
 *      — a dummy whsec_e2e_local_dummy in gitignored .env.local)). A FULL
 *      refund of the whole charge against an UNSETTLED manual_due entry with
 *      zero prior clawbacks is a clean full reclaim: connect_clawback_apply
 *      (20260807000000_connect_clawback.sql) returns outcome='voided' — the
 *      entry flips to status='voided' and NO kind='clawback' debt row is
 *      written, so the FR-014 outstanding-debt formula stays 0.
 *   4. REPLAY: the SAME signed body again → 200 duplicate:true (billing_events
 *      UNIQUE(stripe_event_id) terminal-status dedup), no second effect.
 *
 * Why the manual rail: it exercises the entire money loop (materialization,
 * agreement gate, hold window, atomic claim, debt netting, clawback/void,
 * webhook idempotency) while `settleEntry` short-circuits before any
 * stripe.transfers.* call — so the run needs no Stripe account. What this
 * deliberately does NOT cover — and the owner's Stripe-CLI smoke still must —
 * is the LIVE Stripe rail: transfers.create → transfer.created reconciliation,
 * and the reserve→createReversal→confirm loop for settled-entry clawbacks.
 *
 * Seed hygiene: every identifier is unique per run (runId suffix) and all
 * emails are @furqan.test. Rows are NOT deleted afterwards — the ledger is
 * append-only by design (earning_entries_no_delete trigger); uniqueness makes
 * re-runs safe on a shared local DB, and `supabase db reset` wipes everything.
 *
 * Preconditions to run locally:
 *   - supabase start (DB at postgresql://postgres:postgres@127.0.0.1:54322)
 *   - .env.local: ALLOW_TEST_LOGIN=true, TEST_LOGIN_SECRET, STRIPE_SECRET_KEY
 *     (any non-empty value), STRIPE_WEBHOOK_SECRET=whsec_e2e_local_dummy —
 *     and the dev server started AFTER those were set.
 *   - npx playwright test e2e/connect-payout-journey.spec.ts --project=chromium
 */

import { test, expect, request as pwRequest, type APIRequestContext } from "@playwright/test";
import { createHmac } from "node:crypto";
import { execFileSync } from "node:child_process";

// ── Config ────────────────────────────────────────────────────────────────────

const BASE_URL = process.env.BASE_URL ?? "http://localhost:3000";
const DB_URL = "postgresql://postgres:postgres@127.0.0.1:54322/postgres";
const TEST_LOGIN_SECRET = process.env.TEST_LOGIN_SECRET ?? "";
const WEBHOOK_SECRET = process.env.STRIPE_WEBHOOK_SECRET ?? "";

// Unique identifiers, re-minted at the top of the seed test so a serial-mode
// retry (which re-runs the whole group in the same worker) never collides with
// a half-seeded prior attempt.
let RUN_ID: string;
let PI_ID: string;
let CHARGE_ID: string;
let REFUND_ID: string;
let EVENT_ID: string;
function mintRunIds(): void {
  RUN_ID = `${Date.now().toString(36)}${Math.floor(Math.random() * 1e6).toString(36)}`;
  PI_ID = `pi_e2e_${RUN_ID}`;
  CHARGE_ID = `ch_e2e_${RUN_ID}`;
  REFUND_ID = `re_e2e_${RUN_ID}`;
  EVENT_ID = `evt_e2e_${RUN_ID}`;
}

/** psql one-liner: returns trimmed stdout (-tA). Throws on SQL error. */
function sql(query: string): string {
  return execFileSync(
    "psql",
    [DB_URL, "-X", "-q", "-tA", "-v", "ON_ERROR_STOP=1", "-c", query],
    { encoding: "utf8" },
  ).trim();
}

/** Stripe webhook signature: t=<unix>,v1=hmac_sha256(`${t}.${body}`, secret). */
function stripeSign(body: string): string {
  const t = Math.floor(Date.now() / 1000);
  const v1 = createHmac("sha256", WEBHOOK_SECRET).update(`${t}.${body}`).digest("hex");
  return `t=${t},v1=${v1}`;
}

// The exact charge shape handleChargeRefunded reads: currency, payment_intent,
// amount (the ORIGINAL charge total, cents), refunds.data[] with per-refund
// id + amount (this refund's own amount, NOT cumulative) + metadata.
function chargeRefundedEventBody(): string {
  return JSON.stringify({
    id: EVENT_ID,
    object: "event",
    api_version: "2026-06-24.dahlia",
    created: Math.floor(Date.now() / 1000),
    livemode: false,
    pending_webhooks: 1,
    request: { id: null, idempotency_key: null },
    type: "charge.refunded",
    data: {
      object: {
        id: CHARGE_ID,
        object: "charge",
        amount: 2000, // $20 student charge
        amount_refunded: 2000, // full refund
        currency: "usd",
        payment_intent: PI_ID,
        metadata: {},
        refunded: true,
        refunds: {
          object: "list",
          data: [
            {
              id: REFUND_ID,
              object: "refund",
              amount: 2000, // full 2000 — clean full reclaim → entry voided
              currency: "usd",
              charge: CHARGE_ID,
              payment_intent: PI_ID,
              status: "succeeded",
              metadata: {},
            },
          ],
          has_more: false,
        },
      },
    },
  });
}

// ── State threaded through the serial steps ───────────────────────────────────

let api: APIRequestContext; // carries the ADMIN session cookie after seeding
let teacherId: string;
let deliveryId: string;
let entryId: string;
// Frozen signed payload: the replay step must send the byte-identical body.
let signedBody: string;
let signature: string;

test.describe.configure({ mode: "serial" });

test.describe("Spec 040 Phase 5 — Connect payout journey (manual rail, no live Stripe)", () => {
  test.beforeAll(async () => {
    if (!TEST_LOGIN_SECRET) throw new Error("TEST_LOGIN_SECRET env var required (see .env.local)");
    if (!WEBHOOK_SECRET) throw new Error("STRIPE_WEBHOOK_SECRET env var required (see .env.local)");
    api = await pwRequest.newContext({ baseURL: BASE_URL });
  });

  test.afterAll(async () => {
    await api?.dispose();
  });

  test("1. seed: manual-rail teacher, armed cutover, charge-funded delivery", async () => {
    test.setTimeout(180_000); // first hit compiles the route in dev mode
    mintRunIds();

    // Real auth users + profiles via the test-only login endpoint (creates
    // auth.users + profiles atomically — never hand-craft auth rows).
    const login = async (role: "teacher" | "student" | "admin", email: string) => {
      const res = await api.post("/api/auth/test-login", {
        headers: { "x-test-login-secret": TEST_LOGIN_SECRET },
        data: { role, email },
        timeout: 120_000,
      });
      expect(res.status(), `test-login ${role}`).toBe(200);
      const json = await res.json();
      expect(json.ok).toBe(true);
      return json.userId as string;
    };

    teacherId = await login("teacher", `e2e-connect-teacher-${RUN_ID}@furqan.test`);
    const studentId = await login("student", `e2e-connect-student-${RUN_ID}@furqan.test`);
    // Admin LAST: this context keeps the admin cookies for the sweep call.
    await login("admin", `e2e-connect-admin-${RUN_ID}@furqan.test`);

    // Manual payout rail + accepted agreement v1 (matches the platform_settings
    // default teacher_agreement_current_version='1'). Upsert: the
    // t_ensure_teacher_profile trigger on profiles already auto-created a
    // teacher_profiles row when test-login stamped role='teacher'. Direct-DB
    // (NULL jwt) is a trusted payout_method writer per
    // guard_teacher_profiles_payout_columns.
    sql(`INSERT INTO teacher_profiles (teacher_id, hourly_rate, payout_method)
         VALUES ('${teacherId}', 20, 'manual')
         ON CONFLICT (teacher_id) DO UPDATE SET hourly_rate = 20, payout_method = 'manual'`);
    sql(`INSERT INTO teacher_agreement_acceptances (teacher_id, agreement_version, accepted_by)
         VALUES ('${teacherId}', '1', '${teacherId}')
         ON CONFLICT (teacher_id, agreement_version) DO NOTHING`);

    // Arm the system. Once-only setter: 'applied' on a fresh DB, soft
    // 'rejected: already set' on re-runs — both leave the system armed.
    const armed = sql(`SELECT set_connect_cutover_date('2026-01-01')`);
    expect(["applied", "rejected: already set"]).toContain(armed);

    // Charge-funded chain. bookings has UNIQUE(teacher_id, scheduled_at) — the
    // per-run teacher makes it collision-free. delivered_at 60 days ago is
    // past the 14-day payout hold AND after the 2026-01-01 cutover.
    const bookingId = sql(
      `INSERT INTO bookings (student_id, teacher_id, scheduled_at, duration_min, status, rate_snapshot, amount_usd)
       VALUES ('${studentId}', '${teacherId}', now() - interval '60 days', 60, 'completed', 20, 20)
       RETURNING id`,
    );
    const sessionId = sql(
      `INSERT INTO sessions (booking_id, room_name, room_url)
       VALUES ('${bookingId}', 'e2e-connect-${RUN_ID}', 'https://example.daily.co/e2e-connect-${RUN_ID}')
       RETURNING id`,
    );
    sql(
      `INSERT INTO payments (student_id, booking_id, provider, stripe_payment_intent, amount_usd, amount_before_tax, status)
       VALUES ('${studentId}', '${bookingId}', 'stripe', '${PI_ID}', 20, 20, 'succeeded')`,
    );
    deliveryId = sql(
      `INSERT INTO session_deliveries (session_id, teacher_id, duration_minutes, hourly_rate_usd, delivered_at, payroll_period_month)
       VALUES ('${sessionId}', '${teacherId}', 60, 20, now() - interval '60 days', date_trunc('month', now() - interval '60 days')::date)
       RETURNING id`,
    );
    expect(deliveryId).toMatch(/^[0-9a-f-]{36}$/);
  });

  test("2. admin sweep: materializes the entry and settles it manual_due (no Stripe call)", async () => {
    test.setTimeout(180_000);

    const res = await api.post("/api/admin/payouts/sweep", { timeout: 120_000 });
    expect(res.status(), await res.text()).toBe(200);
    const json = await res.json();
    expect(json.ok).toBe(true);
    expect(json.materialized).toBeGreaterThanOrEqual(1);
    expect(json.manualDue).toBeGreaterThanOrEqual(1);

    // The ledger row: FR-006 amount (60min × $20/h = 2000¢), FR-009 funding
    // ref = the PaymentIntent id, FR-030a stamped version, FR-026 manual_due.
    const row = sql(
      `SELECT id, amount_cents, status, funding_charge_id, agreement_version, transfer_group
         FROM teacher_earning_entries
        WHERE session_delivery_id = '${deliveryId}' AND kind = 'session'`,
    );
    const [id, amount, status, fundingRef, version, group] = row.split("|");
    entryId = id;
    expect(amount).toBe("2000");
    expect(status).toBe("manual_due");
    expect(fundingRef).toBe(PI_ID);
    expect(version).toBe("1");
    expect(group).toBe(`delivery_${deliveryId}`);

    // Manual rail = the sweep wrote NO Stripe transfer row for this entry.
    expect(sql(`SELECT count(*) FROM teacher_transfers WHERE entry_id = '${entryId}'`)).toBe("0");
  });

  test("3. signed charge.refunded: full refund voids the unsettled manual_due entry", async () => {
    test.setTimeout(180_000);

    signedBody = chargeRefundedEventBody();
    signature = stripeSign(signedBody);

    const res = await api.post("/api/stripe/webhook", {
      headers: { "content-type": "application/json", "stripe-signature": signature },
      data: signedBody,
      timeout: 120_000,
    });
    expect(res.status(), await res.text()).toBe(200);
    const json = await res.json();
    expect(json.received).toBe(true);
    expect(json.duplicate).toBeUndefined();

    // Expected outcome derived from connect_clawback_apply (20260807 migration):
    // manual_due is 'unsettled' (no stripe transfer), zero prior clawbacks, and
    // the requested claw (full proportional share = 2000¢) >= amount_cents →
    // outcome 'voided': terminal never-pays, NO negative clawback row.
    expect(
      sql(`SELECT status FROM teacher_earning_entries WHERE id = '${entryId}'`),
    ).toBe("voided");
    expect(
      sql(
        `SELECT count(*) FROM teacher_earning_entries
          WHERE kind = 'clawback' AND clawback_of_entry_id = '${entryId}'`,
      ),
    ).toBe("0");

    // FR-014 outstanding-debt formula (the ONE definition, ledger migration
    // header): a clean void creates no debt — the teacher owes nothing.
    expect(
      sql(
        `SELECT GREATEST(0, -1 * COALESCE(SUM(amount_cents), 0))
           FROM teacher_earning_entries
          WHERE teacher_id = '${teacherId}'
            AND kind IN ('clawback', 'debt_recovery', 'debt_recovery_reversal')`,
      ),
    ).toBe("0");

    // The idempotency ledger recorded the event as terminally processed.
    expect(
      sql(`SELECT status FROM billing_events WHERE stripe_event_id = '${EVENT_ID}'`),
    ).toBe("processed");
  });

  test("4. replay: byte-identical signed body is a 200 no-op (billing_events dedup)", async () => {
    test.setTimeout(180_000);

    const res = await api.post("/api/stripe/webhook", {
      headers: { "content-type": "application/json", "stripe-signature": signature },
      data: signedBody,
      timeout: 120_000,
    });
    expect(res.status(), await res.text()).toBe(200);
    const json = await res.json();
    expect(json.received).toBe(true);
    expect(json.duplicate).toBe(true);

    // No second ledger event, no clawback row appeared, entry still voided.
    expect(
      sql(`SELECT count(*) FROM billing_events WHERE stripe_event_id = '${EVENT_ID}'`),
    ).toBe("1");
    expect(
      sql(
        `SELECT count(*) FROM teacher_earning_entries
          WHERE kind = 'clawback' AND clawback_of_entry_id = '${entryId}'`,
      ),
    ).toBe("0");
    expect(
      sql(`SELECT status FROM teacher_earning_entries WHERE id = '${entryId}'`),
    ).toBe("voided");
  });
});
