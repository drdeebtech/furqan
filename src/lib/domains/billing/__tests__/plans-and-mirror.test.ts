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
type EqCall = [column: string, value: unknown];
type SupabaseCallLog = {
  eq: EqCall[];
  inserts: unknown[];
  updates: unknown[];
};
type QueueResult = {
  data?: unknown | ((callLog: SupabaseCallLog) => unknown);
  error?: unknown;
};

function makeSupabaseCallLog(): SupabaseCallLog {
  return { eq: [], inserts: [], updates: [] };
}

function resolveQueuedData(data: QueueResult["data"], callLog: SupabaseCallLog): unknown {
  return typeof data === "function" ? data(callLog) : data;
}

// Chainable builder; terminal single()/maybeSingle()/await pull FIFO from a
// queue of { data, error } results so multi-query flows (read → update/insert)
// can be scripted in call order.
function makeClient(queue: QueueResult[], callLog = makeSupabaseCallLog()) {
  const q = [...queue];
  const next = () => {
    if (q.length === 0) {
      throw new Error("Supabase mock queue exhausted — unexpected extra query");
    }
    const r = q.shift()!;
    const resolvedData = resolveQueuedData(r.data, callLog);
    const data = resolvedData === undefined ? null : resolvedData;
    const error = r.error === undefined ? null : r.error;
    return Promise.resolve({ data, error });
  };
  const qb: Record<string, unknown> = {};
  for (const m of ["select", "lte", "in", "order", "limit"]) {
    qb[m] = () => qb;
  }
  qb.eq = (column: string, value: unknown) => {
    callLog.eq.push([column, value]);
    return qb;
  };
  qb.insert = (value: unknown) => {
    callLog.inserts.push(value);
    return qb;
  };
  qb.update = (value: unknown) => {
    callLog.updates.push(value);
    return qb;
  };
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
    const callLog = makeSupabaseCallLog();
    const client = makeClient([
      { data: { id: "sub-1", last_event_at: "2020-01-01T00:00:00.000Z" } },
      { data: mirrorRow },
    ], callLog);
    const res = await upsertMirror(client as never, snap());
    expect(res).toMatchObject({ id: "sub-1", status: "active", planId: "plan-1" });
    expect(callLog.eq).toEqual(expect.arrayContaining([
      ["provider", "stripe"],
      ["provider_subscription_id", "sub_stripe_1"],
    ]));
  });

  it("inserts a new mirror when none exists", async () => {
    const callLog = makeSupabaseCallLog();
    const client = makeClient([{ data: null }, { data: mirrorRow }], callLog);
    const res = await upsertMirror(client as never, snap());
    expect(res).toMatchObject({ stripeSubscriptionId: "sub_stripe_1" });
    expect(callLog.inserts[0]).toMatchObject({
      provider: "stripe",
      provider_subscription_id: "sub_stripe_1",
      provider_customer_id: "cus_1",
      stripe_subscription_id: "sub_stripe_1",
      stripe_customer_id: "cus_1",
    });
  });

  it("matches the Stripe provider row when a PayPal row has the same provider subscription id and no Stripe id", async () => {
    const callLog = makeSupabaseCallLog();
    const rows = [
      {
        provider: "paypal",
        provider_subscription_id: "sub_stripe_1",
        stripe_subscription_id: null,
        id: "sub-paypal",
        last_event_at: "2020-01-01T00:00:00.000Z",
      },
      {
        provider: "stripe",
        provider_subscription_id: "sub_stripe_1",
        stripe_subscription_id: "sub_stripe_1",
        id: "sub-stripe",
        last_event_at: "2020-01-01T00:00:00.000Z",
      },
    ];
    const client = makeClient([
      {
        data: (log: SupabaseCallLog) => rows.find((row) =>
          log.eq.some(([column, value]: EqCall) => column === "provider" && value === row.provider) &&
          log.eq.some(([column, value]: EqCall) =>
            column === "provider_subscription_id" &&
            value === row.provider_subscription_id,
          ),
        ),
      },
      { data: { ...mirrorRow, id: "sub-stripe" } },
    ], callLog);

    const res = await upsertMirror(client as never, snap());

    expect(res).toMatchObject({ id: "sub-stripe" });
    expect(callLog.eq.slice(0, 2)).toEqual([
      ["provider", "stripe"],
      ["provider_subscription_id", "sub_stripe_1"],
    ]);
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

  it("returns null when the update query fails", async () => {
    const client = makeClient([
      { data: { id: "sub-1", last_event_at: "2020-01-01T00:00:00.000Z" } },
      { data: null, error: { message: "update boom" } },
    ]);
    expect(await upsertMirror(client as never, snap())).toBeNull();
  });

  it("returns null when the insert query fails", async () => {
    const client = makeClient([
      { data: null },
      { data: null, error: { message: "insert boom" } },
    ]);
    expect(await upsertMirror(client as never, snap())).toBeNull();
  });

  it("returns null (caught) when a query throws unexpectedly", async () => {
    // Empty queue → the mock throws inside upsertMirror's try; the outer
    // catch must swallow it and return null (never roll back a committed grant).
    const client = makeClient([]);
    expect(await upsertMirror(client as never, snap())).toBeNull();
  });
});
