import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// ─── Mocks ───────────────────────────────────────────────────────────────────

vi.mock("server-only", () => ({}));
vi.mock("@/lib/logger", () => ({ logError: vi.fn() }));

// Mock fns declared via vi.hoisted so they're visible inside the hoisted
// vi.mock factories (factories run before top-level let bindings initialize).
const {
  mockRequireRole,
  mockGetUser,
  mockAdminFrom,
  mockSessionsCreate,
  mockCouponsCreate,
  mockGetPlan,
  mockIsPlanHifz,
  mockAssertNoActive,
  mockIsStripeConfigured,
} = vi.hoisted(() => ({
  mockRequireRole: vi.fn(),
  mockGetUser: vi.fn(),
  mockAdminFrom: vi.fn(),
  mockSessionsCreate: vi.fn(),
  mockCouponsCreate: vi.fn(),
  mockGetPlan: vi.fn(),
  mockIsPlanHifz: vi.fn(),
  mockAssertNoActive: vi.fn(),
  mockIsStripeConfigured: vi.fn(),
}));

// Real error classes so the route's `instanceof` checks work.
import { UnauthenticatedError, ForbiddenError } from "@/lib/auth/errors";
vi.mock("@/lib/auth/require-admin", () => ({ requireRole: mockRequireRole }));

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(() => ({ auth: { getUser: mockGetUser } })),
}));

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: vi.fn(() => ({ from: mockAdminFrom })),
}));

// Faithful to the real module: `getStripe()` THROWS when the secret key is
// absent (src/lib/stripe/client.ts). Mocking it as always-succeeding would hide
// the very failure mode this route has to defend against (FURQAN-4C).
vi.mock("@/lib/stripe/client", () => ({
  getStripe: vi.fn(() => {
    if (!mockIsStripeConfigured()) {
      throw new Error("STRIPE_SECRET_KEY is not configured.");
    }
    return {
      customers: { create: vi.fn() },
      checkout: { sessions: { create: mockSessionsCreate } },
      coupons: { create: mockCouponsCreate },
    };
  }),
  isStripeConfigured: mockIsStripeConfigured,
}));

vi.mock("@/lib/domains/billing", () => ({ getActivePlanByCode: mockGetPlan }));

vi.mock("@/lib/actions/subscriptions/create-hifz-subscription", () => ({
  isPlanHifzProduct: mockIsPlanHifz,
  assertNoActiveHifz: mockAssertNoActive,
  resolveStudentFamilyDiscount: vi.fn().mockResolvedValue({ applies: false }),
  HifzAlreadyActiveError: class HifzAlreadyActiveError extends Error {
    constructor(message = "hifz active") { super(message); this.name = "HifzAlreadyActiveError"; }
  },
}));

// Non-hoisted: only used at runtime (in beforeEach), not inside a mock factory.
const mockMaybeSingle = vi.fn();

// ─── Helpers ─────────────────────────────────────────────────────────────────

function makeReq(body: unknown): Request {
  return { json: async () => body } as Request;
}

const STUDENT_ID = "stu-00000000-0000-0000-000000000001";
const PLAN = {
  id: "plan-1",
  planCode: "MONTHLY",
  name: "Monthly",
  planType: "recurring_monthly" as const,
  monthlyCreditCount: 8,
  sessionMetadata: {},
  priceCents: 4000,
  currency: "usd",
  stripeProductId: "prod_1",
  stripePriceId: "price_1",
  isActive: true,
};

let originalEnv: Record<string, string | undefined>;

beforeEach(() => {
  originalEnv = { ...process.env };
  vi.clearAllMocks();
  process.env.NEXT_PUBLIC_APP_URL = "https://app.test";
  process.env.STRIPE_SECRET_KEY = "sk_test_x";
  mockIsStripeConfigured.mockReturnValue(true);
  mockRequireRole.mockResolvedValue({ id: STUDENT_ID });
  mockGetUser.mockResolvedValue({ data: { user: { email: "s@test.local" } } });
  mockGetPlan.mockResolvedValue(PLAN);
  mockIsPlanHifz.mockResolvedValue(false);
  mockAssertNoActive.mockResolvedValue(undefined);
  // stripe_customers fast path: existing mapping.
  // eqChain supports any depth of .eq() chaining (T019 adds a 2-deep chain
  // for the packages query: .eq(subscription_plan_id).eq(is_hifz_product).maybeSingle()).
  const eqChain: Record<string, unknown> = {
    maybeSingle: mockMaybeSingle,
  };
  eqChain.eq = () => eqChain;
  eqChain.not = () => eqChain;
  mockAdminFrom.mockReturnValue({
    select: () => eqChain,
  });
  mockMaybeSingle.mockResolvedValue({ data: { stripe_customer_id: "cus_existing" }, error: null });
  mockSessionsCreate.mockResolvedValue({ url: "https://checkout.stripe.com/c/session" });
  mockCouponsCreate.mockResolvedValue({ id: "coupon_123" });
});

afterEach(() => {
  for (const key of Object.keys(process.env)) {
    if (!(key in originalEnv)) delete process.env[key];
  }
  for (const [k, v] of Object.entries(originalEnv)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
});

import { POST } from "./route";

// ─── Tests ───────────────────────────────────────────────────────────────────

describe("POST /api/stripe/checkout — subscription mode (spec 018)", () => {
  it("returns 401 when unauthenticated", async () => {
    mockRequireRole.mockRejectedValue(new UnauthenticatedError());
    const res = await POST(makeReq({ planCode: "MONTHLY" }));
    expect(res.status).toBe(401);
  });

  it("returns 403 when not a student", async () => {
    mockRequireRole.mockRejectedValue(new ForbiddenError());
    const res = await POST(makeReq({ planCode: "MONTHLY" }));
    expect(res.status).toBe(403);
  });

  it("returns 400 when planCode is missing", async () => {
    const res = await POST(makeReq({}));
    expect(res.status).toBe(400);
  });

  it("returns 400 when planCode is empty", async () => {
    const res = await POST(makeReq({ planCode: "" }));
    expect(res.status).toBe(400);
  });

  it("returns 400 when plan is unknown / inactive", async () => {
    mockGetPlan.mockResolvedValue(null);
    const res = await POST(makeReq({ planCode: "NOPE" }));
    expect(res.status).toBe(400);
  });

  it("returns 400 when plan currency is not USD (FR-008)", async () => {
    mockGetPlan.mockResolvedValue({ ...PLAN, currency: "eur" });
    const res = await POST(makeReq({ planCode: "MONTHLY" }));
    expect(res.status).toBe(400);
  });

  it("returns 409 when student already has active hifz (FR-007)", async () => {
    const { HifzAlreadyActiveError } = await import("@/lib/actions/subscriptions/create-hifz-subscription");
    mockIsPlanHifz.mockResolvedValue(true);
    mockAssertNoActive.mockRejectedValue(new HifzAlreadyActiveError());
    const res = await POST(makeReq({ planCode: "HIFZ_GROUP_4" }));
    expect(res.status).toBe(409);
  });

  it("creates a subscription-mode Checkout and returns {url}", async () => {
    const res = await POST(makeReq({ planCode: "MONTHLY" }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ url: "https://checkout.stripe.com/c/session" });
    expect(mockSessionsCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        mode: "subscription",
        customer: "cus_existing",
        line_items: [{ price: "price_1", quantity: 1 }],
        client_reference_id: STUDENT_ID,
      }),
      expect.objectContaining({ idempotencyKey: expect.any(String) }),
    );
  });

  it("stamps student_id in metadata + client_reference (identity from session)", async () => {
    await POST(makeReq({ planCode: "MONTHLY" }));
    const call = mockSessionsCreate.mock.calls[0][0] as { metadata: Record<string, string>; client_reference_id: string };
    expect(call.metadata.student_id).toBe(STUDENT_ID);
    expect(call.client_reference_id).toBe(STUDENT_ID);
  });

  it("returns 500 when Stripe returns no url", async () => {
    mockSessionsCreate.mockResolvedValue({ url: null });
    const res = await POST(makeReq({ planCode: "MONTHLY" }));
    expect(res.status).toBe(502);
  });

  it("returns 500 when NEXT_PUBLIC_APP_URL is unset", async () => {
    delete process.env.NEXT_PUBLIC_APP_URL;
    const res = await POST(makeReq({ planCode: "MONTHLY" }));
    expect(res.status).toBe(500);
  });

  // Regression: Sentry FURQAN-4C. With no STRIPE_SECRET_KEY, `getStripe()` threw
  // an UNHANDLED error, so Next returned an HTML 500 page. The client does
  // `res.json()` on that HTML, which rejects, and the student was shown
  // "connection failed — check your internet" for a server misconfiguration.
  // The route must answer with parseable JSON so the real reason reaches them.
  it("returns a parseable 503 (not an unhandled throw) when Stripe is unconfigured", async () => {
    mockIsStripeConfigured.mockReturnValue(false);

    const res = await POST(makeReq({ planCode: "MONTHLY" }));

    expect(res.status).toBe(503);
    const body = (await res.json()) as { error?: string };
    expect(body.error).toBeTruthy();
    // Never reach Stripe when it is unconfigured.
    expect(mockSessionsCreate).not.toHaveBeenCalled();
  });

  it("passes discount coupon to Stripe when family discount applies", async () => {
    const { resolveStudentFamilyDiscount } = await import("@/lib/actions/subscriptions/create-hifz-subscription");
    // Mock the discount resolver to return an applicable discount.
    vi.mocked(resolveStudentFamilyDiscount).mockResolvedValue({
      applies: true,
      discountType: "sibling_group",
      discountPct: 10,
      settingKey: "hifz_sibling_group_discount_pct",
    });

    // Provide a mocked package product_category via mockMaybeSingle so discount check proceeds
    mockMaybeSingle.mockResolvedValueOnce({ data: { product_category: "hifz_group" }, error: null }) // package lookup
      .mockResolvedValueOnce({ data: { stripe_customer_id: "cus_existing" }, error: null }); // customer lookup

    const res = await POST(makeReq({ planCode: "MONTHLY" }));
    expect(res.status).toBe(200);

    expect(mockSessionsCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        discounts: [{ coupon: "coupon_123" }],
      }),
      expect.objectContaining({ idempotencyKey: expect.any(String) }),
    );
    // Coupon creation is also idempotent within the same submit window.
    expect(mockCouponsCreate).toHaveBeenCalledWith(
      expect.objectContaining({ percent_off: 10 }),
      expect.objectContaining({ idempotencyKey: expect.any(String) }),
    );
  });
});
