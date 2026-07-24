import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/logger", () => ({ logError: vi.fn(), logInfo: vi.fn() }));

const {
  mockIsConfigured,
  mockVerify,
  mockGetPayPalSubscription,
  mockCancelPayPalSubscription,
  mockGrant,
  mockSingleSessionGrant,
  mockParseRefundCaptureId,
  mockCreateAdminClient,
  mockParseSubscriptionCustomId,
  mockGetActivePlanByCode,
  mockGrantCycle,
  mockBuildCycleKey,
  mockUpsertMirror,
  mockEmitEvent,
} = vi.hoisted(() => ({
  mockIsConfigured: vi.fn(),
  mockVerify: vi.fn(),
  mockGetPayPalSubscription: vi.fn(),
  mockCancelPayPalSubscription: vi.fn(),
  mockGrant: vi.fn(),
  mockSingleSessionGrant: vi.fn(),
  mockParseRefundCaptureId: vi.fn(),
  mockCreateAdminClient: vi.fn(),
  mockParseSubscriptionCustomId: vi.fn(),
  mockGetActivePlanByCode: vi.fn(),
  mockGrantCycle: vi.fn(),
  mockBuildCycleKey: vi.fn(),
  mockUpsertMirror: vi.fn(),
  mockEmitEvent: vi.fn(),
}));

vi.mock("@/lib/paypal/client", () => ({
  isPayPalWebhookConfigured: mockIsConfigured,
  verifyPayPalWebhookSignature: mockVerify,
  getPayPalSubscription: mockGetPayPalSubscription,
  cancelPayPalSubscription: mockCancelPayPalSubscription,
}));

vi.mock("@/lib/paypal/grant", () => ({
  grantPaypalPrepaidCapture: mockGrant,
  grantPaypalSingleSessionCapture: mockSingleSessionGrant,
  parseRefundCaptureId: mockParseRefundCaptureId,
}));

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: mockCreateAdminClient,
}));

vi.mock("@/lib/paypal/subscription-custom-id", () => ({
  parseSubscriptionCustomId: mockParseSubscriptionCustomId,
}));

vi.mock("@/lib/domains/billing/plans", () => ({
  getActivePlanByCode: mockGetActivePlanByCode,
}));

vi.mock("@/lib/domains/billing/orchestrate", () => ({
  buildCycleKey: mockBuildCycleKey,
  grantCycle: mockGrantCycle,
}));

vi.mock("@/lib/domains/billing/subscriptions", async () => {
  const actual = await vi.importActual<typeof import("@/lib/domains/billing/subscriptions")>(
    "@/lib/domains/billing/subscriptions",
  );
  return {
    ...actual,
    upsertMirror: mockUpsertMirror,
  };
});

vi.mock("@/lib/automation/emit", () => ({
  emitEvent: mockEmitEvent,
}));

import { POST } from "./route";

type EqCall = [column: string, value: unknown];
type DbCall = {
  op: "insert" | "update" | "upsert";
  table: string;
  payload: unknown;
  eq: EqCall[];
};

interface TestMirror {
  id: string;
  student_id: string;
  plan_id: string;
  last_event_at: string;
  provider_subscription_id?: string | null;
  status?: string;
}

interface TestAdminOptions {
  insertError?: { code?: string; message?: string } | null;
  duplicateRow?: { id: string; status: string } | null;
  profile?: { id: string; role: string | null } | null;
  profileError?: { message: string } | null;
  mirror?: TestMirror | null;
  mirrorById?: { provider_subscription_id: string | null; status: string } | null;
  payment?: { amount_usd: number } | null;
  grant?: { subscription_id: string | null } | null;
}

let dbCalls: DbCall[] = [];

function hasEq(eqs: EqCall[], column: string, value: unknown): boolean {
  return eqs.some(([c, v]) => c === column && v === value);
}

function makeAdmin(opts: TestAdminOptions = {}) {
  const {
    insertError = null,
    duplicateRow = null,
    profile = { id: STUDENT_ID, role: "student" },
    profileError = null,
    mirror = {
      id: "mirror-1",
      student_id: STUDENT_ID,
      plan_id: "plan-1",
      last_event_at: "2026-01-01T00:00:00.000Z",
      provider_subscription_id: "I-SUB-1",
      status: "active",
    },
    mirrorById = { provider_subscription_id: "I-SUB-1", status: "active" },
    payment = null,
    grant = null,
  } = opts;

  function terminal(table: string, mode: "insert" | "update" | "upsert" | "select", payload: unknown, eq: EqCall[]) {
    if (mode === "insert" && table === "billing_events") {
      return Promise.resolve({
        data: insertError ? null : { id: "new-row-1" },
        error: insertError,
      });
    }
    if (mode === "update" || mode === "upsert") {
      return Promise.resolve({ data: null, error: null });
    }
    if (table === "billing_events") {
      return Promise.resolve({ data: duplicateRow, error: null });
    }
    if (table === "profiles") {
      return Promise.resolve({ data: profile, error: profileError });
    }
    if (table === "subscriptions") {
      if (hasEq(eq, "id", "mirror-1")) {
        return Promise.resolve({ data: mirrorById, error: null });
      }
      if (
        hasEq(eq, "provider", "paypal") &&
        (hasEq(eq, "provider_subscription_id", "I-SUB-1") ||
          hasEq(eq, "provider_subscription_id", "I-AGREE-1"))
      ) {
        return Promise.resolve({ data: mirror, error: null });
      }
      return Promise.resolve({ data: null, error: null });
    }
    if (table === "payments") {
      return Promise.resolve({ data: payment, error: null });
    }
    if (table === "student_packages") {
      return Promise.resolve({ data: grant, error: null });
    }
    return Promise.resolve({ data: null, error: null });
  }

  function makeBuilder(table: string) {
    const state: { mode: "insert" | "update" | "upsert" | "select"; payload: unknown; eq: EqCall[] } = {
      mode: "select",
      payload: null,
      eq: [],
    };
    const builder: Record<string, unknown> = {};
    for (const method of ["select", "not", "limit", "lte", "neq"]) {
      builder[method] = () => builder;
    }
    builder.eq = (column: string, value: unknown) => {
      state.eq.push([column, value]);
      return builder;
    };
    builder.insert = (payload: unknown) => {
      state.mode = "insert";
      state.payload = payload;
      dbCalls.push({ op: "insert", table, payload, eq: state.eq });
      return builder;
    };
    builder.update = (payload: unknown) => {
      state.mode = "update";
      state.payload = payload;
      dbCalls.push({ op: "update", table, payload, eq: state.eq });
      return builder;
    };
    builder.upsert = (payload: unknown) => {
      state.mode = "upsert";
      state.payload = payload;
      dbCalls.push({ op: "upsert", table, payload, eq: state.eq });
      return builder;
    };
    builder.maybeSingle = () => terminal(table, state.mode, state.payload, state.eq);
    builder.single = () => terminal(table, state.mode, state.payload, state.eq);
    builder.then = (
      resolve: (value: { data: unknown; error: unknown }) => unknown,
      reject?: (reason: unknown) => unknown,
    ) => terminal(table, state.mode, state.payload, state.eq).then(resolve, reject);
    return builder;
  }

  return {
    from: vi.fn((table: string) => makeBuilder(table)),
    rpc: vi.fn().mockResolvedValue({ data: "grant-1", error: null }),
  };
}

const STUDENT_ID = "11111111-1111-4111-8111-111111111111";

const VALID_HEADERS: Record<string, string> = {
  "paypal-auth-algo": "SHA256withRSA",
  "paypal-cert-url": "https://api.paypal.com/cert",
  "paypal-transmission-id": "txn-1",
  "paypal-transmission-sig": "sig-1",
  "paypal-transmission-time": "2026-01-01T00:00:00Z",
};

function makeReq(
  body: unknown,
  headers: Record<string, string> = VALID_HEADERS,
  rawBodyOverride?: string,
): Request {
  return new Request("https://furqan.today/api/paypal/webhook", {
    method: "POST",
    headers,
    body: rawBodyOverride ?? JSON.stringify(body),
  });
}

function subscriptionEvent(eventType: string, createTime = "2026-02-01T00:00:00Z") {
  return {
    id: `WH-${eventType}`,
    event_type: eventType,
    create_time: createTime,
    resource: { id: "I-SUB-1" },
  };
}

const CAPTURE_EVENT = {
  id: "WH-EVT-1",
  event_type: "PAYMENT.CAPTURE.COMPLETED",
  create_time: "2026-01-01T00:00:00Z",
  resource: {
    id: "CAPTURE-1",
    amount: { value: "14.00" },
    custom_id: "prepaid_hours:stu-1:2:7.00",
    supplementary_data: { related_ids: { order_id: "ORDER-1" } },
  },
};

const SALE_COMPLETED_EVENT = {
  id: "WH-SALE-1",
  event_type: "PAYMENT.SALE.COMPLETED",
  create_time: "2026-02-01T00:00:00Z",
  resource: {
    id: "SALE-1",
    billing_agreement_id: "I-AGREE-1",
    amount: { total: "40.00", currency: "USD" },
  },
};

const SALE_REFUNDED_EVENT = {
  id: "WH-REFUND-1",
  event_type: "PAYMENT.SALE.REFUNDED",
  create_time: "2026-02-02T00:00:00Z",
  resource: {
    id: "SALE-1",
    sale_id: "SALE-1",
    amount: { total: "40.00", currency: "USD" },
  },
};

const PLAN = {
  id: "plan-1",
  planCode: "hifz_individual_8",
  name: "Individual 8",
  planType: "subscription",
  monthlyCreditCount: 8,
  sessionMetadata: { mode: "hifz" },
  priceCents: 4000,
  currency: "usd",
  stripeProductId: "prod-1",
  stripePriceId: "price-1",
  isActive: true,
};

beforeEach(() => {
  vi.resetAllMocks();
  dbCalls = [];
  mockIsConfigured.mockReturnValue(true);
  mockVerify.mockResolvedValue(true);
  mockCreateAdminClient.mockReturnValue(makeAdmin());
  mockGetPayPalSubscription.mockResolvedValue({
    subscriptionId: "I-AGREE-1",
    status: "ACTIVE",
    planId: "P-PLAN-1",
    customId: `v1|subscription|${STUDENT_ID}|hifz_individual_8`,
    currentPeriodStart: "2026-02-01T00:00:00Z",
    currentPeriodEnd: "2026-03-01T00:00:00Z",
  });
  mockParseSubscriptionCustomId.mockReturnValue({
    productType: "subscription",
    studentId: STUDENT_ID,
    planCode: "hifz_individual_8",
    extra: null,
  });
  mockGetActivePlanByCode.mockResolvedValue(PLAN);
  mockBuildCycleKey.mockReturnValue("SALE-1:I-AGREE-1:2026-02-01T00_00_00.000Z");
  mockGrantCycle.mockResolvedValue({ ok: true, grantId: "grant-1", created: true });
  mockUpsertMirror.mockResolvedValue({
    id: "mirror-1",
    studentId: STUDENT_ID,
    planId: "plan-1",
    provider: "paypal",
    providerSubscriptionId: "I-AGREE-1",
  });
  mockCancelPayPalSubscription.mockResolvedValue({ ok: true });
  mockEmitEvent.mockResolvedValue(undefined);
});

describe("POST /api/paypal/webhook", () => {
  it("forged signature is rejected with zero DB writes", async () => {
    mockVerify.mockResolvedValue(false);

    const res = await POST(makeReq(CAPTURE_EVENT));

    expect(res.status).toBe(400);
    expect(dbCalls).toEqual([]);
    expect(mockGrant).not.toHaveBeenCalled();
    expect(mockGrantCycle).not.toHaveBeenCalled();
  });

  it("unknown events stay ignored and change nothing beyond the ledger status", async () => {
    const res = await POST(makeReq({
      id: "WH-UNKNOWN",
      event_type: "SOMETHING.NEW",
      create_time: "2026-01-01T00:00:00Z",
      resource: {},
    }));

    expect(res.status).toBe(200);
    expect(dbCalls.some((c) => c.op === "update" && c.table === "subscriptions")).toBe(false);
    expect(dbCalls.find((c) => c.op === "update" && c.table === "billing_events")?.payload)
      .toEqual({ status: "ignored", error_detail: "SOMETHING.NEW" });
  });

  it("routes all requested PayPal subscription lifecycle events", async () => {
    const cases = [
      ["BILLING.SUBSCRIPTION.ACTIVATED", "active"],
      ["BILLING.SUBSCRIPTION.UPDATED", "active"],
      ["BILLING.SUBSCRIPTION.CANCELLED", "canceled"],
      ["BILLING.SUBSCRIPTION.EXPIRED", "canceled"],
      ["BILLING.SUBSCRIPTION.SUSPENDED", "past_due"],
      ["BILLING.SUBSCRIPTION.PAYMENT.FAILED", "past_due"],
    ] as const;

    for (const [eventType, status] of cases) {
      dbCalls = [];
      vi.clearAllMocks();
      mockIsConfigured.mockReturnValue(true);
      mockVerify.mockResolvedValue(true);
      mockCreateAdminClient.mockReturnValue(makeAdmin());
      mockGetPayPalSubscription.mockResolvedValue({
        subscriptionId: "I-SUB-1",
        status: "ACTIVE",
        planId: "P-PLAN-1",
        customId: `v1|subscription|${STUDENT_ID}|hifz_individual_8`,
        currentPeriodStart: "2026-02-01T00:00:00Z",
        currentPeriodEnd: "2026-03-01T00:00:00Z",
      });
      mockParseSubscriptionCustomId.mockReturnValue({
        productType: "subscription",
        studentId: STUDENT_ID,
        planCode: "hifz_individual_8",
        extra: null,
      });
      mockGetActivePlanByCode.mockResolvedValue(PLAN);
      mockUpsertMirror.mockResolvedValue({ id: "mirror-1", studentId: STUDENT_ID });
      mockEmitEvent.mockResolvedValue(undefined);

      const res = await POST(makeReq(subscriptionEvent(eventType)));

      expect(res.status).toBe(200);
      if (eventType === "BILLING.SUBSCRIPTION.UPDATED") {
        expect(mockUpsertMirror).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
          provider: "paypal",
          status,
        }));
      } else {
        expect(dbCalls).toContainEqual(expect.objectContaining({
          op: "update",
          table: "subscriptions",
          payload: expect.objectContaining({ status }),
        }));
      }
    }
  });

  it("PAYMENT.SALE.COMPLETED grants one PayPal cycle with sale-id provider refs", async () => {
    mockCreateAdminClient.mockReturnValue(makeAdmin({ mirror: null }));

    const res = await POST(makeReq(SALE_COMPLETED_EVENT));

    expect(res.status).toBe(200);
    expect(mockGrantCycle).toHaveBeenCalledTimes(1);
    expect(mockGrantCycle).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      subscriptionId: "mirror-1",
      studentId: STUDENT_ID,
      planId: "plan-1",
      stripePaymentIntent: "SALE-1",
      provider: "paypal",
      providerRef: "SALE-1",
      amountCents: 4000,
      creditCount: 8,
      expiresAt: "2026-03-01T00:00:00.000Z",
      sessionMetadata: { mode: "hifz" },
    }));
    expect(mockBuildCycleKey).toHaveBeenCalledWith({
      invoiceId: "SALE-1",
      subscriptionId: "I-AGREE-1",
      periodStartIso: "2026-02-01T00:00:00.000Z",
    });
    expect(mockEmitEvent).toHaveBeenCalledWith(
      "subscription.activated",
      "subscription",
      "mirror-1",
      expect.objectContaining({ student_id: STUDENT_ID, grant_id: "grant-1" }),
    );
  });

  it("redelivering the same event id is a no-op after a terminal ledger row", async () => {
    mockCreateAdminClient.mockReturnValue(makeAdmin({
      insertError: { code: "23505", message: "duplicate key value violates unique constraint" },
      duplicateRow: { id: "row-1", status: "processed" },
    }));

    const res = await POST(makeReq(SALE_COMPLETED_EVENT));

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ received: true, duplicate: true });
    expect(mockGrantCycle).not.toHaveBeenCalled();
  });

  it("PAYMENT.SALE.COMPLETED subscription lookup failure is transient and grants nothing", async () => {
    mockGetPayPalSubscription.mockRejectedValue(new Error("paypal down"));

    const res = await POST(makeReq(SALE_COMPLETED_EVENT));

    expect(res.status).toBe(500);
    expect(mockGrantCycle).not.toHaveBeenCalled();
    expect(dbCalls.find((c) => c.op === "update" && c.table === "billing_events")?.payload)
      .toEqual(expect.objectContaining({ status: "failed" }));
  });

  it("out-of-order older subscription payment failure does not regress status", async () => {
    mockCreateAdminClient.mockReturnValue(makeAdmin({
      mirror: {
        id: "mirror-1",
        student_id: STUDENT_ID,
        plan_id: "plan-1",
        last_event_at: "2026-03-01T00:00:00.000Z",
      },
    }));

    const res = await POST(makeReq(subscriptionEvent(
      "BILLING.SUBSCRIPTION.PAYMENT.FAILED",
      "2026-02-01T00:00:00Z",
    )));

    expect(res.status).toBe(200);
    expect(dbCalls.some((c) =>
      c.op === "update" &&
      c.table === "subscriptions" &&
      (c.payload as { status?: string }).status === "past_due",
    )).toBe(false);
  });

  it("BILLING.SUBSCRIPTION.PAYMENT.FAILED sets past_due and revokes nothing", async () => {
    const res = await POST(makeReq(subscriptionEvent("BILLING.SUBSCRIPTION.PAYMENT.FAILED")));

    expect(res.status).toBe(200);
    expect(dbCalls).toContainEqual(expect.objectContaining({
      op: "update",
      table: "subscriptions",
      payload: expect.objectContaining({ status: "past_due" }),
    }));
    expect(dbCalls.some((c) => c.table === "student_packages")).toBe(false);
    expect(mockEmitEvent).toHaveBeenCalledWith(
      "subscription.past_due",
      "subscription",
      "mirror-1",
      expect.objectContaining({ student_id: STUDENT_ID }),
    );
  });

  it("PAYMENT.SALE.REFUNDED full refund cancels PayPal sub and flips only active packages", async () => {
    mockCreateAdminClient.mockReturnValue(makeAdmin({
      payment: { amount_usd: 40 },
      grant: { subscription_id: "mirror-1" },
      mirrorById: { provider_subscription_id: "I-SUB-1", status: "active" },
    }));

    const res = await POST(makeReq(SALE_REFUNDED_EVENT));

    expect(res.status).toBe(200);
    expect(mockCancelPayPalSubscription).toHaveBeenCalledWith(
      "I-SUB-1",
      "Subscription payment fully refunded",
    );
    expect(dbCalls).toContainEqual(expect.objectContaining({
      op: "update",
      table: "payments",
      payload: { status: "refunded" },
    }));
    expect(dbCalls).toContainEqual(expect.objectContaining({
      op: "update",
      table: "student_packages",
      payload: { status: "cancelled" },
    }));
    expect(dbCalls).toContainEqual(expect.objectContaining({
      op: "update",
      table: "subscriptions",
      payload: { status: "canceled" },
    }));
  });

  it("PAYMENT.SALE.COMPLETED with bad custom_id marks failed and grants nothing", async () => {
    mockParseSubscriptionCustomId.mockReturnValue(null);

    const res = await POST(makeReq(SALE_COMPLETED_EVENT));

    expect(res.status).toBe(200);
    expect(mockGrantCycle).not.toHaveBeenCalled();
    expect(dbCalls.findLast((c) => c.op === "update" && c.table === "billing_events")?.payload)
      .toEqual({ status: "failed", error_detail: "bad subscription custom_id" });
  });

  it("PAYMENT.SALE.COMPLETED rejects non-USD sales before subscription lookup", async () => {
    const res = await POST(makeReq({
      ...SALE_COMPLETED_EVENT,
      resource: {
        ...SALE_COMPLETED_EVENT.resource,
        amount: { total: "40.00", currency: "EUR" },
      },
    }));

    expect(res.status).toBe(200);
    expect(mockGetPayPalSubscription).not.toHaveBeenCalled();
    expect(mockGrantCycle).not.toHaveBeenCalled();
    expect(dbCalls.findLast((c) => c.op === "update" && c.table === "billing_events")?.payload)
      .toEqual({ status: "failed", error_detail: "non-usd currency: EUR" });
  });
});
