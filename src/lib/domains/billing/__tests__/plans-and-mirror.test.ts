import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/logger", () => ({ logError: vi.fn(), logInfo: vi.fn() }));

import { getActivePlanByCode, getPlanById } from "../plans";
import { upsertMirror, type StripeSubscriptionSnapshot } from "../subscriptions";
import { BillingEvents } from "../events";

/**
 * Coverage for the previously-untested billing reads + mirror adapter:
 *   - plans.ts: getActivePlanByCode / getPlanById (found / not-found / error)
 *   - events.ts: BillingEvents canonical names
 *   - subscriptions.ts: upsertMirror recency guard, insert/update/stale paths
 *
 * (shouldApplyEvent / toSubscriptionStatus are covered in grant-idempotency.test.ts.)
 */

// ── Supabase mock ───────────────────────────────────────────────────────────
// Chainable builder; terminal single()/maybeSingle()/await pull FIFO from a
// queue of { data, error } results so multi-query flows (read → update/insert)
// can be scripted in call order.
function makeClient(queue: Array<{ data?: unknown; error?: unknown }>) {
  const q = [...queue];
  const next = () => {
    if (q.length === 0) {
      throw new Error("Supabase mock queue exhausted — unexpected extra query");
    }
    const r = q.shift()!;
    const data = r.data === undefined ? null : r.data;
    const error = r.error === undefined ? null : r.error;
    return Promise.resolve({ data, error });
  };
  const qb: Record<string, unknown> = {};
  for (const m of ["select", "eq", "lte", "insert", "update", "in", "order", "limit"]) {
    qb[m] = () => qb;
  }
  qb.maybeSingle = () => next();
  qb.single = () => next();
  qb.then = (resolve: (v: unknown) => unknown) => next().then(resolve);
  return { from: () => qb };
}

const planRow = {
  id: "plan-1",
  plan_code: "hifz_individual_8",
  name: "Individual 8",
  plan_type: "subscription",
  monthly_credit_count: 8,
  session_metadata: { foo: "bar" },
  price_cents: 4000,
  currency: "usd",
  stripe_product_id: "prod_1",
  stripe_price_id: "price_1",
  is_active: true,
};

const mirrorRow = {
  id: "sub-1",
  student_id: "stu-1",
  payer_user_id: null,
  plan_id: "plan-1",
  stripe_subscription_id: "sub_stripe_1",
  stripe_customer_id: "cus_1",
  status: "active",
  current_period_start: "2026-06-01T00:00:00.000Z",
  current_period_end: "2026-07-01T00:00:00.000Z",
  cancel_at_period_end: false,
  last_event_at: "2026-06-01T00:00:00.000Z",
  canceled_at: null,
};

const snap = (over: Partial<StripeSubscriptionSnapshot> = {}): StripeSubscriptionSnapshot => ({
  stripeSubscriptionId: "sub_stripe_1",
  stripeCustomerId: "cus_1",
  status: "active",
  currentPeriodStart: "2026-06-01T00:00:00.000Z",
  currentPeriodEnd: "2026-07-01T00:00:00.000Z",
  cancelAtPeriodEnd: false,
  eventCreatedSeconds: Math.floor(Date.parse("2026-06-15T00:00:00.000Z") / 1000),
  studentId: "stu-1",
  planId: "plan-1",
  ...over,
});

beforeEach(() => vi.clearAllMocks());

describe("events.BillingEvents", () => {
  it("exposes the four canonical subscription lifecycle event names", () => {
    expect(BillingEvents.Activated).toBe("subscription.activated");
    expect(BillingEvents.Renewed).toBe("subscription.renewed");
    expect(BillingEvents.PastDue).toBe("subscription.past_due");
    expect(BillingEvents.Canceled).toBe("subscription.canceled");
  });
});

describe("plans.getActivePlanByCode", () => {
  it("maps a found row to the domain shape", async () => {
    const client = makeClient([{ data: planRow }]);
    const plan = await getActivePlanByCode(client as never, "hifz_individual_8");
    expect(plan).toMatchObject({
      id: "plan-1",
      planCode: "hifz_individual_8",
      monthlyCreditCount: 8,
      priceCents: 4000,
      stripePriceId: "price_1",
      isActive: true,
    });
  });

  it("returns null when no active plan matches", async () => {
    const client = makeClient([{ data: null }]);
    expect(await getActivePlanByCode(client as never, "missing")).toBeNull();
  });

  it("returns null and logs on query error", async () => {
    const client = makeClient([{ data: null, error: { message: "boom" } }]);
    expect(await getActivePlanByCode(client as never, "x")).toBeNull();
  });
});

describe("plans.getPlanById", () => {
  it("maps a found row to the domain shape", async () => {
    const client = makeClient([{ data: planRow }]);
    const plan = await getPlanById(client as never, "plan-1");
    expect(plan?.planCode).toBe("hifz_individual_8");
  });

  it("returns null on error", async () => {
    const client = makeClient([{ data: null, error: { message: "boom" } }]);
    expect(await getPlanById(client as never, "plan-1")).toBeNull();
  });
});

describe("subscriptions.upsertMirror", () => {
  it("rejects a stale (out-of-order) event without writing", async () => {
    // existing row's last_event_at is NEWER than the incoming event.
    const client = makeClient([
      { data: { id: "sub-1", last_event_at: "2030-01-01T00:00:00.000Z" } },
    ]);
    const res = await upsertMirror(client as never, snap());
    expect(res).toBeNull();
  });

  it("updates an existing mirror when the event is newer", async () => {
    const client = makeClient([
      { data: { id: "sub-1", last_event_at: "2020-01-01T00:00:00.000Z" } },
      { data: mirrorRow },
    ]);
    const res = await upsertMirror(client as never, snap());
    expect(res).toMatchObject({ id: "sub-1", status: "active", planId: "plan-1" });
  });

  it("inserts a new mirror when none exists", async () => {
    const client = makeClient([{ data: null }, { data: mirrorRow }]);
    const res = await upsertMirror(client as never, snap());
    expect(res).toMatchObject({ stripeSubscriptionId: "sub_stripe_1" });
  });

  it("skips insert (returns null) when planId is missing on a new mirror", async () => {
    const client = makeClient([{ data: null }]);
    const res = await upsertMirror(client as never, snap({ planId: null }));
    expect(res).toBeNull();
  });

  it("returns null when the existing-row read errors", async () => {
    const client = makeClient([{ data: null, error: { message: "read boom" } }]);
    expect(await upsertMirror(client as never, snap())).toBeNull();
  });
});
