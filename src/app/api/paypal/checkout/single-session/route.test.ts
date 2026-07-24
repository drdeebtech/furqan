import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const {
  mockCreatePayPalOrder,
  mockFindSpecialist,
  mockGetAssessmentPrice,
  mockGetInstantPrice,
  mockGetSpecializedPrice,
  mockCreateAdminClient,
  mockIngestBillingEvent,
  mockMarkEvent,
  mockRequireRole,
} = vi.hoisted(() => ({
  mockCreatePayPalOrder: vi.fn(),
  mockFindSpecialist: vi.fn(),
  mockGetAssessmentPrice: vi.fn(),
  mockGetInstantPrice: vi.fn(),
  mockGetSpecializedPrice: vi.fn(),
  mockCreateAdminClient: vi.fn(),
  mockIngestBillingEvent: vi.fn(),
  mockMarkEvent: vi.fn(),
  mockRequireRole: vi.fn(),
}));

vi.mock("@/lib/logger", () => ({ logError: vi.fn(), logInfo: vi.fn() }));
vi.mock("@/lib/auth/require-admin", () => ({ requireRole: mockRequireRole }));
vi.mock("@/lib/security/rate-limit", () => ({
  checkRateLimit: vi.fn().mockResolvedValue(true),
}));
vi.mock("@/lib/settings", () => ({
  getSetting: vi.fn().mockResolvedValue("1"),
  isFeatureEnabled: vi.fn().mockResolvedValue(true),
}));
vi.mock("@/lib/paypal/client", () => ({
  createPayPalOrder: mockCreatePayPalOrder,
  isPayPalConfigured: () => true,
  isPayPalWebhookConfigured: () => true,
  verifyPayPalWebhookSignature: vi.fn().mockResolvedValue(true),
}));
vi.mock("@/lib/domains/single-sessions/specialist-matching", () => ({
  countStudentActiveAssessments: vi.fn().mockResolvedValue(0),
  countStudentAssessmentsForSpecialty: vi.fn().mockResolvedValue(0),
  findAvailableSpecialist: mockFindSpecialist,
}));
vi.mock("@/lib/domains/single-sessions/pricing", () => ({
  getAssessmentPrice: mockGetAssessmentPrice,
  getInstantPrice: mockGetInstantPrice,
  getSpecializedPrice: mockGetSpecializedPrice,
  SPECIALIZED_PURPOSES: [
    "review",
    "consolidate_surah",
    "memorize_mutoon",
    "test_juz_mutashabihat",
  ] as const,
}));
vi.mock("@/lib/domains/single-sessions/quran-validation", () => ({
  validateTargetScope: vi.fn(() => ({ valid: true })),
}));
vi.mock("@/lib/domains/single-sessions/instant-slot", () => ({
  validateInstantSlot: vi.fn(() => ({ ok: true })),
}));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: mockCreateAdminClient,
}));
vi.mock("@/lib/domains/billing/webhook-handlers", () => ({
  ingestBillingEvent: mockIngestBillingEvent,
  markEvent: mockMarkEvent,
}));

import { POST } from "./route";
import { POST as paypalWebhookPost } from "../../webhook/route";
import {
  buildPaypalSingleSessionCustomId,
  grantPaypalSingleSessionCapture,
  parseSingleSessionCustomId,
} from "@/lib/paypal/grant";

const STUDENT_ID = "00000000-0000-4000-8000-000000000001";
const TEACHER_ID = "00000000-0000-4000-8000-000000000002";

function makeRequest(body: unknown): Request {
  return { json: async () => body } as Request;
}

function routeAdmin() {
  const teacherQuery = {
    select: vi.fn(() => teacherQuery),
    eq: vi.fn(() => teacherQuery),
    maybeSingle: vi.fn().mockResolvedValue({
      data: { teacher_id: TEACHER_ID },
      error: null,
    }),
  };
  return { from: vi.fn(() => teacherQuery) };
}

function singleSessionCustomId(): string {
  const customId = buildPaypalSingleSessionCustomId({
    studentId: STUDENT_ID,
    teacherId: TEACHER_ID,
    bookingType: "assessment",
    priceCents: 500,
    specialty: "hifz",
    purpose: null,
    targetScope: null,
    scheduledAt: null,
  });
  if (!customId) throw new Error("test custom_id did not encode");
  return customId;
}

function grantAdmin(options: { profileRole?: string } = {}) {
  const payments: Array<Record<string, unknown>> = [];
  let bookingLinked = false;
  const rpc = vi.fn().mockImplementation(async () => {
    bookingLinked = true;
    return { data: "booking-1", error: null };
  });
  const from = vi.fn((table: string) => {
    if (table === "profiles") {
      const profileQuery = {
        select: vi.fn(() => profileQuery),
        eq: vi.fn(() => profileQuery),
        maybeSingle: vi.fn().mockResolvedValue({
          data: {
            id: STUDENT_ID,
            role: options.profileRole ?? "student",
          },
          error: null,
        }),
      };
      return profileQuery;
    }
    let operation: "insert" | "lookup" = "lookup";
    let duplicateInsert = false;
    const paymentQuery = {
      insert: vi.fn((row: Record<string, unknown>) => {
        operation = "insert";
        duplicateInsert = payments.length > 0;
        if (!duplicateInsert) payments.push(row);
        return paymentQuery;
      }),
      select: vi.fn(() => paymentQuery),
      eq: vi.fn(() => paymentQuery),
      maybeSingle: vi.fn(async () => {
        if (operation === "insert" && duplicateInsert) {
          return { data: null, error: { code: "23505" } };
        }
        return {
          data: {
            id: "payment-1",
            booking_id: bookingLinked ? "booking-1" : null,
          },
          error: null,
        };
      }),
    };
    return paymentQuery;
  });
  return { admin: { from, rpc }, payments, rpc };
}

function asGrantAdmin(
  admin: ReturnType<typeof grantAdmin>["admin"],
): Parameters<typeof grantPaypalSingleSessionCapture>[0] {
  return admin as unknown as Parameters<
    typeof grantPaypalSingleSessionCapture
  >[0];
}

describe("POST /api/paypal/checkout/single-session", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.NEXT_PUBLIC_APP_URL = "https://app.test";
    mockRequireRole.mockResolvedValue({ id: STUDENT_ID });
    mockFindSpecialist.mockResolvedValue({ teacherId: TEACHER_ID });
    mockGetAssessmentPrice.mockResolvedValue(5);
    mockGetInstantPrice.mockResolvedValue(7);
    mockGetSpecializedPrice.mockResolvedValue(10);
    mockCreateAdminClient.mockReturnValue(routeAdmin());
    mockIngestBillingEvent.mockResolvedValue({
      outcome: "new",
      billingEventId: "billing-event-1",
    });
    mockMarkEvent.mockResolvedValue(undefined);
    mockCreatePayPalOrder.mockResolvedValue({
      orderId: "ORDER-1",
      approveUrl: "https://paypal.test/approve",
    });
  });

  it("creates an assessment order from the server-resolved teacher and price", async () => {
    const response = await POST(
      makeRequest({ productType: "assessment", specialty: "hifz" }),
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      success: true,
      data: {
        orderId: "ORDER-1",
        approveUrl: "https://paypal.test/approve",
      },
    });
    expect(mockCreatePayPalOrder).toHaveBeenCalledWith(
      expect.objectContaining({
        amountUsd: 5,
        referenceId: STUDENT_ID,
        customId: expect.stringMatching(
          /^single_session:[^:]+:a:500:[^:]+:aGlmeg$/,
        ),
      }),
    );
  });

  it("materializes a free instant booking without creating a PayPal order", async () => {
    const rpc = vi.fn().mockResolvedValue({ data: "booking-free", error: null });
    mockGetInstantPrice.mockResolvedValue(0);
    mockCreateAdminClient.mockReturnValue({ ...routeAdmin(), rpc });

    const response = await POST(
      makeRequest({
        productType: "instant",
        teacherId: TEACHER_ID,
      }),
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      success: true,
      data: {
        bookingId: "booking-free",
        message: "booking_created_free",
      },
    });
    expect(mockCreatePayPalOrder).not.toHaveBeenCalled();
    expect(rpc).toHaveBeenCalledWith(
      "start_instant_session_booking",
      expect.objectContaining({
        p_student_id: STUDENT_ID,
        p_teacher_id: TEACHER_ID,
        p_rate_snapshot: 0,
        p_amount_usd: 0,
      }),
    );
  });

  it("creates an instant-session order from the server-resolved price", async () => {
    const response = await POST(
      makeRequest({
        productType: "instant",
        teacherId: TEACHER_ID,
      }),
    );

    expect(response.status).toBe(200);
    expect(mockCreatePayPalOrder).toHaveBeenCalledWith(
      expect.objectContaining({
        amountUsd: 7,
        customId: expect.stringMatching(
          /^single_session:[^:]+:i:700:[^:]+:-$/,
        ),
      }),
    );
  });

  it("creates a specialized-session order from the purpose price", async () => {
    const response = await POST(
      makeRequest({
        productType: "specialized",
        teacherId: TEACHER_ID,
        purpose: "consolidate_surah",
        targetScope: { surah: 36 },
      }),
    );

    expect(response.status).toBe(200);
    expect(mockGetSpecializedPrice).toHaveBeenCalledWith(
      "consolidate_surah",
    );
    expect(mockCreatePayPalOrder).toHaveBeenCalledWith(
      expect.objectContaining({
        amountUsd: 10,
        customId: expect.stringMatching(
          /^single_session:[^:]+:s:1000:[^:]+:c\.eyJzdXJhaCI6MzZ9$/,
        ),
      }),
    );
  });

  it("fails closed when an instant custom_id timestamp is outside the Date range", () => {
    const customId = buildPaypalSingleSessionCustomId({
      studentId: STUDENT_ID,
      teacherId: TEACHER_ID,
      bookingType: "instant",
      priceCents: 700,
      specialty: null,
      purpose: null,
      targetScope: null,
      scheduledAt: null,
    });
    if (!customId) throw new Error("test custom_id did not encode");
    const segments = customId.split(":");
    segments[5] = Number.MAX_SAFE_INTEGER.toString(36);

    expect(parseSingleSessionCustomId(segments.join(":"))).toBeNull();
  });

  it("records one PayPal payment and materializes one booking after capture", async () => {
    const { admin, payments, rpc } = grantAdmin();

    const result = await grantPaypalSingleSessionCapture(
      asGrantAdmin(admin),
      {
        captureId: "CAPTURE-1",
        amountUsd: 5,
        customId: singleSessionCustomId(),
        orderId: "ORDER-1",
      },
    );

    expect(result).toEqual({
      ok: true,
      bookingId: "booking-1",
      duplicate: false,
    });
    expect(payments).toHaveLength(1);
    expect(payments[0]).toMatchObject({
      provider: "paypal",
      paypal_order_id: "ORDER-1",
      paypal_capture_id: "CAPTURE-1",
      amount_usd: 5,
    });
    expect(rpc).toHaveBeenCalledTimes(1);
    expect(rpc).toHaveBeenCalledWith(
      "create_single_session_booking",
      expect.objectContaining({
        p_student_id: STUDENT_ID,
        p_teacher_id: TEACHER_ID,
        p_booking_product_type: "assessment",
        p_payment_id: "payment-1",
      }),
    );
  });

  it("rejects a custom_id whose frozen price was changed", async () => {
    const { admin, payments, rpc } = grantAdmin();
    const segments = singleSessionCustomId().split(":");
    segments[3] = "600";

    const result = await grantPaypalSingleSessionCapture(
      asGrantAdmin(admin),
      {
        captureId: "CAPTURE-TAMPERED",
        amountUsd: 5,
        customId: segments.join(":"),
        orderId: "ORDER-TAMPERED",
      },
    );

    expect(result).toEqual({
      ok: false,
      reason: "custom_id price mismatch",
    });
    expect(payments).toHaveLength(0);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("rejects a custom_id whose session type was changed", async () => {
    const { admin, payments, rpc } = grantAdmin();
    const segments = singleSessionCustomId().split(":");
    segments[2] = "i";

    const result = await grantPaypalSingleSessionCapture(
      asGrantAdmin(admin),
      {
        captureId: "CAPTURE-TYPE-TAMPERED",
        amountUsd: 5,
        customId: segments.join(":"),
        orderId: "ORDER-TYPE-TAMPERED",
      },
    );

    expect(result).toEqual({ ok: false, reason: "bad custom_id" });
    expect(payments).toHaveLength(0);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("rejects a captured amount that differs from the expected price", async () => {
    const { admin, payments, rpc } = grantAdmin();

    const result = await grantPaypalSingleSessionCapture(
      asGrantAdmin(admin),
      {
        captureId: "CAPTURE-WRONG-AMOUNT",
        amountUsd: 4.99,
        customId: singleSessionCustomId(),
        orderId: "ORDER-WRONG-AMOUNT",
      },
    );

    expect(result).toMatchObject({
      ok: false,
      reason: expect.stringContaining("amount mismatch"),
    });
    expect(payments).toHaveLength(0);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("rejects a custom_id student whose profile is not a student", async () => {
    const { admin, payments, rpc } = grantAdmin({
      profileRole: "teacher",
    });

    const result = await grantPaypalSingleSessionCapture(
      asGrantAdmin(admin),
      {
        captureId: "CAPTURE-WRONG-OWNER",
        amountUsd: 5,
        customId: singleSessionCustomId(),
        orderId: "ORDER-WRONG-OWNER",
      },
    );

    expect(result).toMatchObject({
      ok: false,
      reason: expect.stringContaining("not student"),
    });
    expect(payments).toHaveLength(0);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("does not grant again when the same PayPal order is redelivered", async () => {
    const { admin, payments, rpc } = grantAdmin();
    const grantArgs = {
      captureId: "CAPTURE-REDELIVERED",
      amountUsd: 5,
      customId: singleSessionCustomId(),
      orderId: "ORDER-REDELIVERED",
    };

    const first = await grantPaypalSingleSessionCapture(
      asGrantAdmin(admin),
      grantArgs,
    );
    const redelivery = await grantPaypalSingleSessionCapture(
      asGrantAdmin(admin),
      grantArgs,
    );

    expect(first).toMatchObject({ ok: true, duplicate: false });
    expect(redelivery).toMatchObject({ ok: true, duplicate: true });
    expect(payments).toHaveLength(1);
    expect(rpc).toHaveBeenCalledTimes(1);
  });

  it("routes repeated capture webhooks through order-id idempotency", async () => {
    const { admin, payments, rpc } = grantAdmin();
    mockCreateAdminClient.mockReturnValue(admin);
    const webhookBody = {
      event_type: "PAYMENT.CAPTURE.COMPLETED",
      resource: {
        id: "CAPTURE-WEBHOOK",
        amount: { value: "5.00" },
        custom_id: singleSessionCustomId(),
        supplementary_data: {
          related_ids: { order_id: "ORDER-WEBHOOK" },
        },
      },
    };
    const makeWebhookRequest = (eventId: string) =>
      new Request("https://app.test/api/paypal/webhook", {
        method: "POST",
        headers: {
          "paypal-auth-algo": "SHA256withRSA",
          "paypal-cert-url": "https://paypal.test/cert",
          "paypal-transmission-id": "transmission-1",
          "paypal-transmission-sig": "signature",
          "paypal-transmission-time": "2026-07-24T00:00:00Z",
        },
        body: JSON.stringify({ id: eventId, ...webhookBody }),
      });

    const first = await paypalWebhookPost(makeWebhookRequest("EVENT-1"));
    const redelivery = await paypalWebhookPost(
      makeWebhookRequest("EVENT-2"),
    );

    expect(first.status).toBe(200);
    expect(redelivery.status).toBe(200);
    expect(payments).toHaveLength(1);
    expect(rpc).toHaveBeenCalledTimes(1);
  });
});
