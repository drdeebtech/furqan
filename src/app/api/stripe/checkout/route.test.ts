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
  mockGetPlan,
} = vi.hoisted(() => ({
  mockRequireRole: vi.fn(),
  mockGetUser: vi.fn(),
  mockAdminFrom: vi.fn(),
  mockSessionsCreate: vi.fn(),
  mockGetPlan: vi.fn(),
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

vi.mock("@/lib/stripe/client", () => ({
  getStripe: vi.fn(() => ({
    customers: { create: vi.fn() },
    checkout: { sessions: { create: mockSessionsCreate } },
  })),
  isStripeConfigured: () => true,
}));

vi.mock("@/lib/domains/billing", () => ({ getActivePlanByCode: mockGetPlan }));

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
  mockRequireRole.mockResolvedValue({ id: STUDENT_ID });
  mockGetUser.mockResolvedValue({ data: { user: { email: "s@test.local" } } });
  mockGetPlan.mockResolvedValue(PLAN);
  // stripe_customers fast path: existing mapping
  mockAdminFrom.mockReturnValue({
    select: () => ({ eq: () => ({ maybeSingle: mockMaybeSingle }) }),
  });
  mockMaybeSingle.mockResolvedValue({ data: { stripe_customer_id: "cus_existing" }, error: null });
  mockSessionsCreate.mockResolvedValue({ url: "https://checkout.stripe.com/c/session" });
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

  it("creates a subscription-mode Checkout and returns {url}", async () => {
    const res = await POST(makeReq({ planCode: "MONTHLY" }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ url: "https://checkout.stripe.com/c/session" });
    expect(mockSessionsCreate).toHaveBeenCalledWith(expect.objectContaining({
      mode: "subscription",
      customer: "cus_existing",
      line_items: [{ price: "price_1", quantity: 1 }],
      client_reference_id: STUDENT_ID,
    }));
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
});
