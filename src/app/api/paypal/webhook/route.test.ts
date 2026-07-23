import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * Route-level characterization test for the PayPal webhook — spec-039 2b's
 * ONLY money-moving path with zero prior tests. This test documents CURRENT
 * behavior; it does not modify route.ts. Where the brief calls for a
 * fail-closed expectation (invalid signature / unreachable verifier /
 * malformed body), the assertion is what fail-closed SHOULD look like — if
 * the route actually fails open, the assertion FAILS and that is reported as
 * a SECURITY FINDING, not silently adjusted to match.
 */

vi.mock("server-only", () => ({}));
vi.mock("@/lib/logger", () => ({ logError: vi.fn(), logInfo: vi.fn() }));

const { mockIsConfigured, mockVerify, mockGrant, mockParseRefundCaptureId, mockCreateAdminClient } =
  vi.hoisted(() => ({
    mockIsConfigured: vi.fn(),
    mockVerify: vi.fn(),
    mockGrant: vi.fn(),
    mockParseRefundCaptureId: vi.fn(),
    mockCreateAdminClient: vi.fn(),
  }));

vi.mock("@/lib/paypal/client", () => ({
  isPayPalWebhookConfigured: mockIsConfigured,
  verifyPayPalWebhookSignature: mockVerify,
}));

vi.mock("@/lib/paypal/grant", () => ({
  grantPaypalPrepaidCapture: mockGrant,
  parseRefundCaptureId: mockParseRefundCaptureId,
}));

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: mockCreateAdminClient,
}));

import { POST } from "./route";

// ─── Fake admin client ───────────────────────────────────────────────────────
// Chainable fake that RECORDS every insert/update against billing_events so
// tests can assert "zero DB writes" by inspecting dbCalls, not by trusting a
// mock's return value alone.

type DbCall = { op: "insert" | "update"; table: string; payload: unknown };
let dbCalls: DbCall[] = [];

function makeAdmin(opts: {
  insertError?: { code?: string; message?: string } | null;
  duplicateRow?: { id: string; status: string } | null;
} = {}) {
  const { insertError = null, duplicateRow = null } = opts;
  return {
    from: vi.fn((table: string) => ({
      insert: vi.fn((payload: unknown) => {
        dbCalls.push({ op: "insert", table, payload });
        // ingestBillingEvent chains .select("id").maybeSingle() after insert
        // (needed to thread billingEventId through for ALL providers).
        return {
          select: vi.fn(() => ({
            maybeSingle: vi.fn().mockResolvedValue({
              data: insertError ? null : { id: "new-row-1" },
              error: insertError,
            }),
          })),
        };
      }),
      update: vi.fn((payload: unknown) => {
        dbCalls.push({ op: "update", table, payload });
        return { eq: vi.fn().mockResolvedValue({ error: null }) };
      }),
      select: vi.fn(() => ({
        eq: vi.fn(() => ({
          maybeSingle: vi.fn().mockResolvedValue({ data: duplicateRow, error: null }),
        })),
      })),
    })),
  };
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

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

beforeEach(() => {
  vi.resetAllMocks();
  dbCalls = [];
  mockIsConfigured.mockReturnValue(true);
  mockCreateAdminClient.mockReturnValue(makeAdmin());
});

// ─── Tests ───────────────────────────────────────────────────────────────────

describe("POST /api/paypal/webhook — characterization (spec 039 2b)", () => {
  it("1. invalid signature → 4xx, zero DB writes", async () => {
    mockVerify.mockResolvedValue(false);

    const res = await POST(makeReq(CAPTURE_EVENT));

    expect(res.status).toBe(400);
    expect(dbCalls).toEqual([]);
    expect(mockGrant).not.toHaveBeenCalled();
  });

  it("1b. isPayPalWebhookConfigured() false → 503 immediately, verify() never called, zero DB writes", async () => {
    // Gate 1 in route.ts is a distinct code path from the verify()-throws
    // mapping in test 2: it returns 503 BEFORE the header check / signature
    // verify call, so it never even reaches PayPal. Force it to false —
    // previously untested — and assert the short-circuit.
    mockIsConfigured.mockReturnValue(false);

    const res = await POST(makeReq(CAPTURE_EVENT));

    expect(res.status).toBe(503);
    expect(mockVerify).not.toHaveBeenCalled();
    expect(mockCreateAdminClient).not.toHaveBeenCalled();
    expect(dbCalls).toEqual([]);
    expect(mockGrant).not.toHaveBeenCalled();
  });

  it("2. returns 503 when signature verification is unavailable (helper rejects — treated as config error)", async () => {
    // route.ts documents that verifyPayPalWebhookSignature throws ONLY on a
    // config problem (missing webhook id / api base), so any rejection here
    // — including a genuinely unreachable PayPal endpoint — is mapped to the
    // same 503 "not configured" response, not a distinct network-error path.
    mockVerify.mockRejectedValue(new Error("PayPal verify endpoint unreachable"));

    const res = await POST(makeReq(CAPTURE_EVENT));

    expect(res.status).toBe(503);
    expect(dbCalls).toEqual([]);
    expect(mockGrant).not.toHaveBeenCalled();
  });

  it("3. malformed JSON body → 400-class, zero DB writes", async () => {
    mockVerify.mockResolvedValue(true);

    const res = await POST(makeReq(undefined, VALID_HEADERS, "{not valid json"));

    expect(res.status).toBe(400);
    expect(dbCalls).toEqual([]);
    expect(mockGrant).not.toHaveBeenCalled();
  });

  it("4. duplicate event id (billing_events already has the row) → 2xx, grant NOT called", async () => {
    mockVerify.mockResolvedValue(true);
    mockCreateAdminClient.mockReturnValue(
      makeAdmin({
        insertError: { code: "23505", message: "duplicate key value violates unique constraint" },
        duplicateRow: { id: "row-1", status: "processed" },
      }),
    );

    const res = await POST(makeReq(CAPTURE_EVENT));

    expect(res.status).toBe(200);
    const body = (await res.json()) as { received?: boolean; duplicate?: boolean };
    expect(body).toEqual({ received: true, duplicate: true });
    expect(mockGrant).not.toHaveBeenCalled();
  });

  it("5. PAYMENT.CAPTURE.COMPLETED happy path → 2xx, grant called once with payload ids, event marked processed", async () => {
    mockVerify.mockResolvedValue(true);
    mockGrant.mockResolvedValue({ ok: true, lotId: "lot-1" });

    const res = await POST(makeReq(CAPTURE_EVENT));

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ received: true });

    expect(mockGrant).toHaveBeenCalledTimes(1);
    expect(mockGrant).toHaveBeenCalledWith(
      expect.anything(),
      {
        captureId: "CAPTURE-1",
        amountUsd: 14,
        customId: "prepaid_hours:stu-1:2:7.00",
        orderId: "ORDER-1",
      },
    );

    const processedUpdate = dbCalls.find(
      (c) => c.op === "update" && c.table === "billing_events",
    );
    expect(processedUpdate?.payload).toEqual({ status: "processed" });
  });

  it("6. grant retryable failure → 5xx-class status so PayPal retries, event marked accordingly", async () => {
    mockVerify.mockResolvedValue(true);
    mockGrant.mockResolvedValue({ ok: false, reason: "grant failed" });

    const res = await POST(makeReq(CAPTURE_EVENT));

    expect(res.status).toBe(500);
    const body = (await res.json()) as { error?: string };
    expect(body.error).toBeTruthy();

    const failedUpdate = dbCalls.find(
      (c) => c.op === "update" && c.table === "billing_events",
    );
    expect(failedUpdate?.payload).toEqual({
      status: "failed",
      error_detail: "grant failed",
    });
  });
});
