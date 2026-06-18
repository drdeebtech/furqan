import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// ─── Mocks ───────────────────────────────────────────────────────────────────

vi.mock("server-only", () => ({}));
vi.mock("@/lib/logger", () => ({
  logError: vi.fn(),
  logInfo: vi.fn(),
}));

const {
  mockRequireRole,
  mockGetUser,
  mockRpc,
  mockFindSpecialist,
  mockCountAssessments,
  mockAssessmentPrice,
  mockInstantPrice,
  mockSpecializedPrice,
  mockGetSetting,
  mockSessionsCreate,
} = vi.hoisted(() => ({
  mockRequireRole: vi.fn(),
  mockGetUser: vi.fn(),
  mockRpc: vi.fn(),
  mockFindSpecialist: vi.fn(),
  mockCountAssessments: vi.fn(),
  mockAssessmentPrice: vi.fn(),
  mockInstantPrice: vi.fn(),
  mockSpecializedPrice: vi.fn(),
  mockGetSetting: vi.fn(),
  mockSessionsCreate: vi.fn(),
}));

import { UnauthenticatedError, ForbiddenError } from "@/lib/auth/errors";
vi.mock("@/lib/auth/require-admin", () => ({ requireRole: mockRequireRole }));

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(() => ({ auth: { getUser: mockGetUser } })),
}));

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: vi.fn(() => ({ rpc: mockRpc })),
}));

vi.mock("@/lib/stripe/client", () => ({
  getStripe: vi.fn(() => ({
    checkout: { sessions: { create: mockSessionsCreate } },
  })),
  isStripeConfigured: () => true,
}));

vi.mock("@/lib/settings", () => ({ getSetting: mockGetSetting }));

vi.mock("@/lib/domains/single-sessions/specialist-matching", () => ({
  findAvailableSpecialist: mockFindSpecialist,
  listAvailableSpecialists: vi.fn(),
  countStudentAssessmentsForSpecialty: mockCountAssessments,
}));

vi.mock("@/lib/domains/single-sessions/pricing", () => ({
  getAssessmentPrice: mockAssessmentPrice,
  getInstantPrice: mockInstantPrice,
  getSpecializedPrice: mockSpecializedPrice,
  SPECIALIZED_PURPOSES: [
    "review",
    "consolidate_surah",
    "memorize_mutoon",
    "test_juz_mutashabihat",
  ] as const,
}));

// REAL validator — pure module, no mocks needed.
vi.mock("@/lib/next-cache", () => ({}));

// ─── Helpers ─────────────────────────────────────────────────────────────────

const STUDENT_ID = "00000000-0000-1000-8000-000000000001";
const TEACHER_ID = "00000000-0000-1000-8000-000000000002";

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
  mockGetSetting.mockResolvedValue("1");
  mockCountAssessments.mockResolvedValue(0);
  mockAssessmentPrice.mockResolvedValue(5);
  mockInstantPrice.mockResolvedValue(7);
  mockSpecializedPrice.mockResolvedValue(10);
  mockFindSpecialist.mockResolvedValue({
    teacherId: TEACHER_ID,
    displayName: "Teacher Test",
    specialties: ["hifz"],
    hasAvailability: true,
  });
  mockSessionsCreate.mockResolvedValue({ url: "https://checkout.stripe.com/c/sess" });
  mockRpc.mockResolvedValue({ data: null, error: null });
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

describe("POST /api/stripe/checkout/single-session (spec 022)", () => {
  // ── Auth ──────────────────────────────────────────────────────────────────
  it("returns 401 when unauthenticated", async () => {
    mockRequireRole.mockRejectedValue(new UnauthenticatedError());
    const res = await POST(makeReq({ productType: "instant", teacherId: TEACHER_ID }));
    expect(res.status).toBe(401);
  });

  it("returns 403 when not a student", async () => {
    mockRequireRole.mockRejectedValue(new ForbiddenError());
    const res = await POST(makeReq({ productType: "instant", teacherId: TEACHER_ID }));
    expect(res.status).toBe(403);
  });

  // ── Schema validation (FR-016) ────────────────────────────────────────────
  it("returns 400 on invalid body (missing productType)", async () => {
    const res = await POST(makeReq({}));
    expect(res.status).toBe(400);
  });

  it("returns 400 on unknown productType", async () => {
    const res = await POST(makeReq({ productType: "bogus" }));
    expect(res.status).toBe(400);
  });

  it("returns 400 when assessment is requested without a specialty", async () => {
    const res = await POST(makeReq({ productType: "assessment" }));
    expect(res.status).toBe(400);
  });

  it("returns 400 when instant is requested without teacherId", async () => {
    const res = await POST(makeReq({ productType: "instant" }));
    expect(res.status).toBe(400);
  });

  it("returns 400 when specialized is requested without purpose/targetScope", async () => {
    const res = await POST(
      makeReq({ productType: "specialized", teacherId: TEACHER_ID }),
    );
    expect(res.status).toBe(400);
  });

  // ── Fail-before-charge: assessment ────────────────────────────────────────
  it("returns 409 when per-specialty assessment limit reached (FR-014)", async () => {
    mockCountAssessments.mockResolvedValueOnce(1); // limit default 1 → reached
    const res = await POST(makeReq({ productType: "assessment", specialty: "hifz" }));
    expect(res.status).toBe(409);
    // Must NOT have called Stripe (fail-before-charge).
    expect(mockSessionsCreate).not.toHaveBeenCalled();
  });

  // CodeRabbit #3: Number(null)/Number("") === 0 previously collapsed the
  // limit to 0 and blocked every assessment. The default-policy branch must
  // fire for missing/blank/non-numeric settings so the limit falls back to 1.
  it("does NOT block when assessment-limit setting is null (default policy)", async () => {
    mockGetSetting.mockResolvedValueOnce(null);
    mockCountAssessments.mockResolvedValueOnce(0);
    const res = await POST(makeReq({ productType: "assessment", specialty: "hifz" }));
    expect(res.status).toBe(200);
    expect(mockSessionsCreate).toHaveBeenCalledTimes(1);
  });

  it("does NOT block when assessment-limit setting is blank string", async () => {
    mockGetSetting.mockResolvedValueOnce("");
    mockCountAssessments.mockResolvedValueOnce(0);
    const res = await POST(makeReq({ productType: "assessment", specialty: "hifz" }));
    expect(res.status).toBe(200);
    expect(mockSessionsCreate).toHaveBeenCalledTimes(1);
  });

  it("does NOT block when assessment-limit setting is non-numeric", async () => {
    mockGetSetting.mockResolvedValueOnce("unlimited");
    mockCountAssessments.mockResolvedValueOnce(0);
    const res = await POST(makeReq({ productType: "assessment", specialty: "hifz" }));
    expect(res.status).toBe(200);
    expect(mockSessionsCreate).toHaveBeenCalledTimes(1);
  });

  it("returns 422 when no specialist matches the specialty (FR-013)", async () => {
    mockFindSpecialist.mockResolvedValueOnce(null);
    const res = await POST(makeReq({ productType: "assessment", specialty: "qiraat" }));
    expect(res.status).toBe(422);
    expect(mockSessionsCreate).not.toHaveBeenCalled();
  });

  // ── Fail-before-charge: specialized Quran validation (FR-015) ─────────────
  it("returns 422 when surah is out of canonical range (surah 999)", async () => {
    const res = await POST(
      makeReq({
        productType: "specialized",
        teacherId: TEACHER_ID,
        purpose: "consolidate_surah",
        targetScope: { surah: 999 },
      }),
    );
    expect(res.status).toBe(422);
    expect(mockSessionsCreate).not.toHaveBeenCalled();
  });

  it("returns 422 when juz is out of range (juz 31)", async () => {
    const res = await POST(
      makeReq({
        productType: "specialized",
        teacherId: TEACHER_ID,
        purpose: "test_juz_mutashabihat",
        targetScope: { juz: 31 },
      }),
    );
    expect(res.status).toBe(422);
  });

  it("rejects non-USD currency (Edge: USD only)", async () => {
    // zod enum forces 'usd'; pass via unknown cast to bypass client schema
    const res = await POST(
      makeReq({
        productType: "instant",
        teacherId: TEACHER_ID,
        currency: "eur",
      }),
    );
    // zod enum literal → 400 from schema parse; the explicit gate never runs.
    expect(res.status).toBe(400);
  });

  // ── Happy paths ───────────────────────────────────────────────────────────
  it("returns a checkoutUrl when assessment has a specialist + non-zero price", async () => {
    const res = await POST(makeReq({ productType: "assessment", specialty: "hifz" }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.data.checkoutUrl).toBe("https://checkout.stripe.com/c/sess");

    // The PI metadata must stamp student_id + teacher_id + booking_type
    // server-side (FR-005: identity never from input).
    const createCall = mockSessionsCreate.mock.calls[0][0];
    expect(createCall.metadata).toMatchObject({
      booking_type: "assessment",
      student_id: STUDENT_ID,
      teacher_id: TEACHER_ID,
      specialty: "hifz",
    });
    expect(createCall.payment_intent_data.metadata.student_id).toBe(STUDENT_ID);
    expect(createCall.mode).toBe("payment");
  });

  it("returns a bookingId (no Stripe) when assessment price is 0 (free)", async () => {
    mockAssessmentPrice.mockResolvedValue(0);
    mockRpc.mockResolvedValueOnce({ data: "booking-uuid-001", error: null });

    const res = await POST(makeReq({ productType: "assessment", specialty: "hifz" }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.bookingId).toBe("booking-uuid-001");
    expect(body.data.message).toBe("booking_created_free");
    expect(mockSessionsCreate).not.toHaveBeenCalled();

    // Zero-price path calls the SAME atomic creator the webhook uses — never
    // a bare INSERT. p_payment_id must be null.
    const rpcArgs = mockRpc.mock.calls[0][1] as Record<string, unknown>;
    expect(rpcArgs.p_booking_product_type).toBe("assessment");
    expect(rpcArgs.p_payment_id).toBeUndefined();
    expect(rpcArgs.p_specialty).toBe("hifz");
  });

  it("creates an instant session via start_instant_session_booking on zero-price", async () => {
    mockInstantPrice.mockResolvedValue(0);
    mockRpc.mockResolvedValueOnce({ data: "booking-instant-001", error: null });

    const res = await POST(
      makeReq({ productType: "instant", teacherId: TEACHER_ID }),
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.bookingId).toBe("booking-instant-001");
    expect(mockSessionsCreate).not.toHaveBeenCalled();

    const fnName = mockRpc.mock.calls[0][0];
    expect(fnName).toBe("start_instant_session_booking");
  });

  it("returns a checkoutUrl for a valid specialized booking (surah 36)", async () => {
    const res = await POST(
      makeReq({
        productType: "specialized",
        teacherId: TEACHER_ID,
        purpose: "consolidate_surah",
        targetScope: { surah: 36 },
      }),
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.data.checkoutUrl).toBeTruthy();

    const createCall = mockSessionsCreate.mock.calls[0][0];
    expect(createCall.metadata.booking_type).toBe("specialized");
    expect(createCall.metadata.purpose).toBe("consolidate_surah");
    expect(createCall.metadata.target_scope).toContain("36");
  });

  // ── Never-debit invariant (NFR-001 / FR-007) ──────────────────────────────
  it("does NOT touch student_packages on any assessment path", async () => {
    mockAssessmentPrice.mockResolvedValue(5);
    await POST(makeReq({ productType: "assessment", specialty: "hifz" }));
    // No RPC was called (Stripe path; the webhook materializes later).
    expect(mockRpc).not.toHaveBeenCalled();
    // Stripe Checkout was the only side effect.
    expect(mockSessionsCreate).toHaveBeenCalledTimes(1);
  });

  it("returns 500 when Stripe is healthy but Checkout creation throws", async () => {
    mockSessionsCreate.mockRejectedValueOnce(new Error("stripe down"));
    const res = await POST(makeReq({ productType: "assessment", specialty: "hifz" }));
    expect(res.status).toBe(500);
  });
});
