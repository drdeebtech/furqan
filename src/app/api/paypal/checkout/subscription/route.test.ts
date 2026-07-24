import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const {
  mockRequireRole,
  mockCheckRateLimit,
  mockIsFeatureEnabled,
  mockIsPayPalConfigured,
  mockCreatePayPalSubscription,
  mockGetActivePlanByCode,
  mockIsPlanHifzProduct,
  mockAssertNoActiveHifz,
  mockCreateAdminClient,
  mockCreateClient,
} = vi.hoisted(() => ({
  mockRequireRole: vi.fn(),
  mockCheckRateLimit: vi.fn(),
  mockIsFeatureEnabled: vi.fn(),
  mockIsPayPalConfigured: vi.fn(),
  mockCreatePayPalSubscription: vi.fn(),
  mockGetActivePlanByCode: vi.fn(),
  mockIsPlanHifzProduct: vi.fn(),
  mockAssertNoActiveHifz: vi.fn(),
  mockCreateAdminClient: vi.fn(),
  mockCreateClient: vi.fn(),
}));

vi.mock("@/lib/logger", () => ({ logError: vi.fn(), logInfo: vi.fn() }));
vi.mock("@/lib/auth/require-admin", () => ({ requireRole: mockRequireRole }));
vi.mock("@/lib/security/rate-limit", () => ({ checkRateLimit: mockCheckRateLimit }));
vi.mock("@/lib/settings", () => ({ isFeatureEnabled: mockIsFeatureEnabled }));
vi.mock("@/lib/paypal/client", () => ({
  createPayPalSubscription: mockCreatePayPalSubscription,
  isPayPalConfigured: () => mockIsPayPalConfigured(),
}));
vi.mock("@/lib/domains/billing", () => ({
  getActivePlanByCode: mockGetActivePlanByCode,
}));
vi.mock("@/lib/supabase/server", () => ({ createClient: mockCreateClient }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: mockCreateAdminClient }));
vi.mock("@/lib/posthog-server", () => ({ getPostHogClient: () => null }));

// Real classes so `instanceof` in the route works; the guard functions and
// custom_id codec are the real (pure) modules — we exercise them, not stub them.
import { UnauthenticatedError, ForbiddenError } from "@/lib/auth/errors";
import { HifzAlreadyActiveError } from "@/lib/actions/subscriptions/create-hifz-subscription";

vi.mock("@/lib/actions/subscriptions/create-hifz-subscription", async (importOriginal) => {
  const actual = await importOriginal<
    typeof import("@/lib/actions/subscriptions/create-hifz-subscription")
  >();
  return {
    ...actual,
    isPlanHifzProduct: mockIsPlanHifzProduct,
    assertNoActiveHifz: mockAssertNoActiveHifz,
  };
});

import { POST } from "./route";

const STUDENT_ID = "11111111-1111-4111-8111-111111111111";

const groupPlan = {
  id: "plan-group-4",
  planCode: "hifz_group_4",
  name: "Group 4",
  planType: "subscription" as const,
  monthlyCreditCount: 4,
  sessionMetadata: {},
  priceCents: 4000,
  currency: "usd",
  stripeProductId: "prod_g",
  stripePriceId: "price_g",
  paypalPlanId: "P-GROUP4",
  isActive: true,
};

const individualPlan = {
  ...groupPlan,
  id: "plan-ind-8",
  planCode: "hifz_individual_8",
  name: "Individual 8",
  monthlyCreditCount: 8,
  priceCents: 8000,
  stripeProductId: "prod_i",
  stripePriceId: "price_i",
  paypalPlanId: "P-IND8",
};

function req(body: unknown = { planCode: "hifz_group_4" }): Request {
  return new Request("http://localhost/api/paypal/checkout/subscription", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  // Happy-path defaults; each test overrides what it exercises.
  mockIsFeatureEnabled.mockResolvedValue(true);
  mockRequireRole.mockResolvedValue({ id: STUDENT_ID });
  mockCheckRateLimit.mockResolvedValue(true);
  mockIsPayPalConfigured.mockReturnValue(true);
  mockCreateClient.mockResolvedValue({});
  mockCreateAdminClient.mockReturnValue({});
  mockGetActivePlanByCode.mockResolvedValue(groupPlan);
  mockIsPlanHifzProduct.mockResolvedValue(true);
  mockAssertNoActiveHifz.mockResolvedValue(undefined);
  mockCreatePayPalSubscription.mockResolvedValue({
    subscriptionId: "I-SUB1",
    status: "APPROVAL_PENDING",
    approveUrl: "https://www.paypal.com/approve/I-SUB1",
  });
  process.env.NEXT_PUBLIC_APP_URL = "https://furqan.today";
});

describe("POST /api/paypal/checkout/subscription", () => {
  it("returns 404 when the paypal_subscription_enabled flag is off", async () => {
    mockIsFeatureEnabled.mockResolvedValue(false);
    const res = await POST(req());
    expect(res.status).toBe(404);
    expect(mockCreatePayPalSubscription).not.toHaveBeenCalled();
  });

  it("returns 401 for an unauthenticated caller", async () => {
    mockRequireRole.mockRejectedValue(new UnauthenticatedError());
    const res = await POST(req());
    expect(res.status).toBe(401);
  });

  it("returns 403 for a non-student role", async () => {
    mockRequireRole.mockRejectedValue(new ForbiddenError());
    const res = await POST(req());
    expect(res.status).toBe(403);
  });

  it("returns 429 when rate-limited", async () => {
    mockCheckRateLimit.mockResolvedValue(false);
    const res = await POST(req());
    expect(res.status).toBe(429);
  });

  it("returns 400 for a body missing planCode", async () => {
    const res = await POST(req({}));
    expect(res.status).toBe(400);
    expect(mockCreatePayPalSubscription).not.toHaveBeenCalled();
  });

  it("returns 503 when PayPal is not configured", async () => {
    mockIsPayPalConfigured.mockReturnValue(false);
    const res = await POST(req());
    expect(res.status).toBe(503);
    expect(mockCreatePayPalSubscription).not.toHaveBeenCalled();
  });

  it("returns 400 for an unknown plan", async () => {
    mockGetActivePlanByCode.mockResolvedValue(null);
    const res = await POST(req({ planCode: "nope" }));
    expect(res.status).toBe(400);
  });

  it("returns 503 when the plan has no paypal_plan_id (bootstrap not run)", async () => {
    mockGetActivePlanByCode.mockResolvedValue({ ...groupPlan, paypalPlanId: null });
    const res = await POST(req());
    expect(res.status).toBe(503);
    expect(mockCreatePayPalSubscription).not.toHaveBeenCalled();
  });

  it("returns 409 when the student already has an active hifz subscription", async () => {
    mockAssertNoActiveHifz.mockRejectedValue(
      new HifzAlreadyActiveError("You already have an active Hifz subscription."),
    );
    const res = await POST(req());
    expect(res.status).toBe(409);
    expect(mockCreatePayPalSubscription).not.toHaveBeenCalled();
  });

  it("does not run the hifz guard for a non-hifz plan", async () => {
    mockIsPlanHifzProduct.mockResolvedValue(false);
    const res = await POST(req());
    expect(res.status).toBe(200);
    expect(mockAssertNoActiveHifz).not.toHaveBeenCalled();
  });

  // AC11: exercise a group AND an individual plan, not only Group 4.
  it.each([
    ["hifz_group_4", groupPlan],
    ["hifz_individual_8", individualPlan],
  ])("returns the PayPal approval url for %s", async (planCode, plan) => {
    mockGetActivePlanByCode.mockResolvedValue(plan);
    const res = await POST(req({ planCode }));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.url).toBe("https://www.paypal.com/approve/I-SUB1");

    // Plan id + custom_id are resolved server-side, never from the request.
    expect(mockCreatePayPalSubscription).toHaveBeenCalledTimes(1);
    const arg = mockCreatePayPalSubscription.mock.calls[0][0];
    expect(arg.planId).toBe(plan.paypalPlanId);
    expect(arg.customId).toBe(`v1|subscription|${STUDENT_ID}|${planCode}`);
    expect(arg.returnUrl).toContain("/student/dashboard?subscription=success");
  });

  it("returns 500 when the PayPal call fails", async () => {
    mockCreatePayPalSubscription.mockRejectedValue(new Error("paypal down"));
    const res = await POST(req());
    expect(res.status).toBe(500);
  });
});
