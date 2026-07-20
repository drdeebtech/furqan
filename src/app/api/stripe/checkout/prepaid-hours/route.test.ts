import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { PREPAID_DEFAULT_RATE_USD } from "@/lib/domains/billing/prepaid-defaults";

// ─── Mocks (mirror single-session/route.test.ts) ────────────────────────────

vi.mock("server-only", () => ({}));
vi.mock("@/lib/logger", () => ({
  logError: vi.fn(),
  logInfo: vi.fn(),
}));

const {
  mockRequireRole,
  mockGetUser,
  mockSessionsCreate,
  mockGetSetting,
  mockIsFeatureEnabled,
  mockIsStripeConfigured,
} = vi.hoisted(() => ({
  mockRequireRole: vi.fn(),
  mockGetUser: vi.fn(),
  mockSessionsCreate: vi.fn(),
  mockGetSetting: vi.fn(),
  mockIsFeatureEnabled: vi.fn(),
  mockIsStripeConfigured: vi.fn(() => true),
}));

import { UnauthenticatedError, ForbiddenError } from "@/lib/auth/errors";
vi.mock("@/lib/auth/require-admin", () => ({ requireRole: mockRequireRole }));

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(() => ({ auth: { getUser: mockGetUser } })),
}));

vi.mock("@/lib/stripe/client", () => ({
  getStripe: vi.fn(() => ({
    checkout: { sessions: { create: mockSessionsCreate } },
  })),
  isStripeConfigured: mockIsStripeConfigured,
}));

vi.mock("@/lib/settings", () => ({
  getSetting: mockGetSetting,
  isFeatureEnabled: mockIsFeatureEnabled,
}));

// ─── Helpers ────────────────────────────────────────────────────────────────

const STUDENT_ID = "00000000-0000-1000-8000-000000000001";

function makeReq(body: unknown): Request {
  return { json: async () => body } as Request;
}

let originalEnv: Record<string, string | undefined>;

beforeEach(() => {
  originalEnv = { ...process.env };
  vi.clearAllMocks();
  process.env.NEXT_PUBLIC_APP_URL = "https://app.test";
  process.env.STRIPE_SECRET_KEY = "sk_test_x";
  mockRequireRole.mockResolvedValue({ id: STUDENT_ID });
  mockGetUser.mockResolvedValue({ data: { user: { email: "s@test.local" } } });
  mockIsFeatureEnabled.mockResolvedValue(true);
  mockGetSetting.mockImplementation(async (key: string) => {
    switch (key) {
      case "prepaid_hours_rate_usd":
        return "10";
      case "prepaid_hours_custom_min":
        return "1";
      case "prepaid_hours_custom_max":
        return "100";
      default:
        return null;
    }
  });
  mockSessionsCreate.mockResolvedValue({ url: "https://checkout.stripe.com/c/sess" });
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

// ─── Tests ──────────────────────────────────────────────────────────────────

describe("POST /api/stripe/checkout/prepaid-hours (spec 038)", () => {
  // ── Feature flag (R10) ─────────────────────────────────────────────────────
  it("returns 404 when the feature flag is OFF (R10 default-off)", async () => {
    mockIsFeatureEnabled.mockResolvedValue(false);
    const res = await POST(makeReq({ hours: 10 }));
    expect(res.status).toBe(404);
    // Must not touch Stripe when disabled.
    expect(mockSessionsCreate).not.toHaveBeenCalled();
  });

  // ── Auth (FR-005) ──────────────────────────────────────────────────────────
  it("returns 401 when unauthenticated", async () => {
    mockRequireRole.mockRejectedValue(new UnauthenticatedError());
    const res = await POST(makeReq({ hours: 10 }));
    expect(res.status).toBe(401);
  });

  it("returns 403 when not a student", async () => {
    mockRequireRole.mockRejectedValue(new ForbiddenError());
    const res = await POST(makeReq({ hours: 10 }));
    expect(res.status).toBe(403);
  });

  // ── Body validation ────────────────────────────────────────────────────────
  it("returns 400 on invalid body (missing hours)", async () => {
    const res = await POST(makeReq({}));
    expect(res.status).toBe(400);
  });

  it("returns 400 when hours is not a positive integer", async () => {
    const res = await POST(makeReq({ hours: 0 }));
    expect(res.status).toBe(400);
  });

  it("returns 400 when hours is a fractional number", async () => {
    const res = await POST(makeReq({ hours: 5.5 }));
    expect(res.status).toBe(400);
  });

  // ── Fail-closed: NEVER accept client-supplied amount ───────────────────────
  it("ignores a client-supplied amount (FR-002 server computes)", async () => {
    // Attacker tries to send amount + currency + rate — none are in the schema,
    // `.strict()` rejects the unknown keys.
    const res = await POST(
      makeReq({ hours: 10, amount: 100, currency: "usd", rate_usd: 0.01 }),
    );
    expect(res.status).toBe(400);
    expect(mockSessionsCreate).not.toHaveBeenCalled();
  });

  // ── Bounds (custom min/max) ────────────────────────────────────────────────
  it("returns 422 when hours is below the custom min", async () => {
    mockGetSetting.mockImplementation(async (key: string) => {
      if (key === "prepaid_hours_custom_min") return "5";
      if (key === "prepaid_hours_custom_max") return "100";
      if (key === "prepaid_hours_rate_usd") return "10";
      return null;
    });
    const res = await POST(makeReq({ hours: 2 }));
    expect(res.status).toBe(422);
    expect(mockSessionsCreate).not.toHaveBeenCalled();
  });

  it("returns 422 when hours exceeds the custom max", async () => {
    mockGetSetting.mockImplementation(async (key: string) => {
      if (key === "prepaid_hours_custom_min") return "1";
      if (key === "prepaid_hours_custom_max") return "20";
      if (key === "prepaid_hours_rate_usd") return "10";
      return null;
    });
    const res = await POST(makeReq({ hours: 50 }));
    expect(res.status).toBe(422);
    expect(mockSessionsCreate).not.toHaveBeenCalled();
  });

  // ── Server-side price computation (FR-002) ─────────────────────────────────
  it("computes amount = hours × rate (read from settings, not client)", async () => {
    mockGetSetting.mockImplementation(async (key: string) => {
      if (key === "prepaid_hours_rate_usd") return "7.5";
      if (key === "prepaid_hours_custom_min") return "1";
      if (key === "prepaid_hours_custom_max") return "100";
      return null;
    });

    await POST(makeReq({ hours: 10 }));

    expect(mockSessionsCreate).toHaveBeenCalledTimes(1);
    const args = mockSessionsCreate.mock.calls[0][0];
    // unit_amount is the per-hour price in cents; line item quantity = hours.
    expect(args.line_items[0].price_data.unit_amount).toBe(750); // $7.50
    expect(args.line_items[0].quantity).toBe(10);
    // Metadata carries the frozen rate snapshot (R1) + student_id (FR-005).
    expect(args.metadata.product_type).toBe("prepaid_hours");
    expect(args.metadata.student_id).toBe(STUDENT_ID);
    expect(args.metadata.hours).toBe("10");
    expect(args.metadata.rate_usd).toBe("7.50");
    expect(args.payment_intent_data.metadata.product_type).toBe("prepaid_hours");
  });

  // Derived from the shared constant, never hardcoded. These assertions used to
  // say 1000 / "10.00"; when migration 20260817000000 raised the seeded rate to
  // $14 the route still fell back to a local copy of 10, so a settings-read
  // failure billed $10/hr for a $14/hr product. Deriving the expectation means
  // the next rate change cannot leave this test asserting a stale price.
  it("uses the seeded default rate when the setting is missing", async () => {
    mockGetSetting.mockResolvedValue(null);

    await POST(makeReq({ hours: 5 }));

    const args = mockSessionsCreate.mock.calls[0][0];
    expect(args.line_items[0].price_data.unit_amount).toBe(PREPAID_DEFAULT_RATE_USD * 100);
    expect(args.metadata.rate_usd).toBe(PREPAID_DEFAULT_RATE_USD.toFixed(2));
  });

  it("uses the seeded default rate when the setting is malformed", async () => {
    // Defense-in-depth: a corrupt setting value must not crash checkout or
    // silently grant at 0 — fall back to the seeded default.
    mockGetSetting.mockResolvedValue("not-a-number");

    await POST(makeReq({ hours: 5 }));

    const args = mockSessionsCreate.mock.calls[0][0];
    expect(args.line_items[0].price_data.unit_amount).toBe(PREPAID_DEFAULT_RATE_USD * 100);
  });

  // ── Happy path ─────────────────────────────────────────────────────────────
  it("returns 200 + checkoutUrl on a well-formed request", async () => {
    const res = await POST(makeReq({ hours: 20 }));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.success).toBe(true);
    expect(json.data.checkoutUrl).toBe("https://checkout.stripe.com/c/sess");
  });

  // ── Config gates ───────────────────────────────────────────────────────────
  // 503, not 500: the server is healthy and the request well-formed — the
  // payment provider is simply unconfigured, which is a "try later" state. The
  // body must also be real bilingual user copy, because the client renders
  // `error` verbatim (it used to read "Server misconfigured" in English).
  it("returns a bilingual 503 when Stripe is not configured", async () => {
    mockIsStripeConfigured.mockReturnValueOnce(false);
    const res = await POST(makeReq({ hours: 10 }));
    expect(res.status).toBe(503);
    const json = await res.json();
    expect(json.error).toMatch(/[؀-ۿ]/);
    expect(json.error).not.toMatch(/misconfigur/i);
    expect(mockSessionsCreate).not.toHaveBeenCalled();
  });

  it("returns 500 when NEXT_PUBLIC_APP_URL is missing", async () => {
    delete process.env.NEXT_PUBLIC_APP_URL;
    const res = await POST(makeReq({ hours: 10 }));
    expect(res.status).toBe(500);
    expect(mockSessionsCreate).not.toHaveBeenCalled();
  });

  it("returns 502 when Stripe returns no url", async () => {
    mockSessionsCreate.mockResolvedValueOnce({ url: null });
    const res = await POST(makeReq({ hours: 10 }));
    expect(res.status).toBe(502);
  });

  it("returns 500 when stripe.checkout.sessions.create throws", async () => {
    mockSessionsCreate.mockRejectedValueOnce(new Error("stripe down"));
    const res = await POST(makeReq({ hours: 10 }));
    expect(res.status).toBe(500);
  });
});
