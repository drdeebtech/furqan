import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/logger", () => ({
  logError: vi.fn(),
}));

const API_BASE = "https://api-m.sandbox.paypal.com";
const TOKEN_URL = `${API_BASE}/v1/oauth2/token`;
const STUDENT_ID = "00000000-0000-4000-8000-000000000001";

let fetchMock: ReturnType<typeof vi.fn<typeof fetch>>;

function jsonResponse(body: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(body), {
    status: init.status ?? 200,
    statusText: init.statusText,
    headers: { "Content-Type": "application/json" },
  });
}

function noContentResponse(): Response {
  return new Response(null, { status: 204, statusText: "No Content" });
}

function tokenResponse(token: string): Response {
  return jsonResponse({
    access_token: token,
    expires_in: 3600,
    token_type: "Bearer",
  });
}

async function loadClient() {
  return import("../client");
}

function callsForUrl(url: string): Array<Parameters<typeof fetch>> {
  return fetchMock.mock.calls.filter(([input]) => String(input) === url);
}

function callForPath(path: string): Parameters<typeof fetch> {
  const call = fetchMock.mock.calls.find(([input]) =>
    String(input).endsWith(path),
  );
  if (!call) {
    throw new Error(`Missing fetch call for ${path}`);
  }
  return call;
}

function requestHeaders(init: RequestInit | undefined): Record<string, string> {
  return init?.headers as Record<string, string>;
}

function requestBody(init: RequestInit | undefined): Record<string, unknown> {
  return JSON.parse(String(init?.body)) as Record<string, unknown>;
}

beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
  process.env.PAYPAL_API_BASE = API_BASE;
  process.env.PAYPAL_CLIENT_ID = "cid";
  process.env.PAYPAL_CLIENT_SECRET = "sec";
  fetchMock = vi.fn<typeof fetch>();
  vi.stubGlobal("fetch", fetchMock);
});

describe("PayPal recurring client", () => {
  it("reuses a bearer token across two API calls", async () => {
    fetchMock
      .mockResolvedValueOnce(tokenResponse("tok-1"))
      .mockResolvedValueOnce(jsonResponse({ id: "PROD-1" }))
      .mockResolvedValueOnce(jsonResponse({ id: "PROD-2" }));

    const { createPayPalProduct } = await loadClient();

    await createPayPalProduct({ name: "Monthly" });
    await createPayPalProduct({ name: "Annual" });

    expect(callsForUrl(TOKEN_URL)).toHaveLength(1);
    expect(callsForUrl(`${API_BASE}/v1/catalogs/products`)).toHaveLength(2);
  });

  it("refreshes the token and retries once after a 401 API response", async () => {
    fetchMock
      .mockResolvedValueOnce(tokenResponse("tok-1"))
      .mockResolvedValueOnce(jsonResponse({ debug_id: "old-token" }, { status: 401 }))
      .mockResolvedValueOnce(tokenResponse("tok-2"))
      .mockResolvedValueOnce(jsonResponse({ id: "PROD-1" }));

    const { createPayPalProduct } = await loadClient();

    await expect(createPayPalProduct({ name: "Monthly" })).resolves.toEqual({
      productId: "PROD-1",
    });

    expect(callsForUrl(TOKEN_URL)).toHaveLength(2);
    expect(callsForUrl(`${API_BASE}/v1/catalogs/products`)).toHaveLength(2);
  });

  it("wraps malformed success JSON in a clean Error", async () => {
    fetchMock
      .mockResolvedValueOnce(tokenResponse("tok-1"))
      .mockResolvedValueOnce(new Response("{", { status: 200 }));

    const { createPayPalProduct } = await loadClient();

    await expect(createPayPalProduct({ name: "Monthly" })).rejects.toThrow(
      "PayPal create-product response parse failed",
    );
  });

  it("logs PayPal debug_id on non-2xx but keeps it out of the thrown message", async () => {
    fetchMock
      .mockResolvedValueOnce(tokenResponse("tok-1"))
      .mockResolvedValueOnce(
        jsonResponse(
          { debug_id: "dbg123", message: "x" },
          { status: 422, statusText: "Unprocessable Entity" },
        ),
      );

    const { logError } = await import("@/lib/logger");
    const logErrorMock = vi.mocked(logError);
    const { createPayPalProduct } = await loadClient();

    let thrown: Error | null = null;
    try {
      await createPayPalProduct({ name: "Monthly" });
    } catch (error) {
      thrown = error as Error;
    }

    expect(thrown).toBeInstanceOf(Error);
    expect(thrown?.message).toBe(
      "PayPal create-product request failed: 422 Unprocessable Entity",
    );
    expect(thrown?.message).not.toContain("dbg123");
    expect(logErrorMock).toHaveBeenCalledWith(
      "paypal: create-product failed",
      expect.objectContaining({ debug_id: "dbg123", message: "x" }),
      expect.objectContaining({
        tag: "paypal",
        status: 422,
        debug_id: "dbg123",
      }),
    );
  });

  it("sends PayPal-Request-Id for plan and subscription creation", async () => {
    fetchMock
      .mockResolvedValueOnce(tokenResponse("tok-1"))
      .mockResolvedValueOnce(jsonResponse({ id: "P-1", status: "ACTIVE" }))
      .mockResolvedValueOnce(
        jsonResponse({
          id: "S-1",
          status: "APPROVAL_PENDING",
          links: [{ rel: "approve", href: "https://paypal.test/approve" }],
        }),
      );

    const { createPayPalPlan, createPayPalSubscription } = await loadClient();

    await createPayPalPlan({
      productId: "PROD-1",
      name: "Monthly",
      amountUsd: 19,
      requestId: "plan-req-1",
    });
    await createPayPalSubscription({
      planId: "P-1",
      customId: "v1|subscription|00000000-0000-4000-8000-000000000001|monthly",
      returnUrl: "https://furqan.test/return",
      cancelUrl: "https://furqan.test/cancel",
      requestId: "sub-req-1",
    });

    expect(
      requestHeaders(callForPath("/v1/billing/plans")[1])["PayPal-Request-Id"],
    ).toBe("plan-req-1");
    expect(
      requestHeaders(callForPath("/v1/billing/subscriptions")[1])[
        "PayPal-Request-Id"
      ],
    ).toBe("sub-req-1");
  });

  it("round-trips a subscription custom_id through create and get subscription", async () => {
    fetchMock
      .mockResolvedValueOnce(tokenResponse("tok-1"))
      .mockResolvedValueOnce(
        jsonResponse({
          id: "S-1",
          status: "APPROVAL_PENDING",
          links: [{ rel: "approve", href: "https://paypal.test/approve" }],
        }),
      );

    const { buildSubscriptionCustomId } = await import("../subscription-custom-id");
    const { createPayPalSubscription, getPayPalSubscription } = await loadClient();
    const customId = buildSubscriptionCustomId({
      productType: "subscription",
      studentId: STUDENT_ID,
      planCode: "monthly",
    });

    await createPayPalSubscription({
      planId: "P-1",
      customId,
      returnUrl: "https://furqan.test/return",
      cancelUrl: "https://furqan.test/cancel",
    });

    const createBody = requestBody(callForPath("/v1/billing/subscriptions")[1]);
    expect(createBody.custom_id).toBe(customId);

    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        id: "S-1",
        status: "ACTIVE",
        plan_id: "P-1",
        custom_id: customId,
      }),
    );

    await expect(getPayPalSubscription("S-1")).resolves.toMatchObject({
      subscriptionId: "S-1",
      customId,
    });
  });

  it("parses subscription period boundaries when PayPal returns billing_info", async () => {
    fetchMock
      .mockResolvedValueOnce(tokenResponse("tok-1"))
      .mockResolvedValueOnce(
        jsonResponse({
          id: "S-1",
          status: "ACTIVE",
          plan_id: "P-1",
          custom_id: "custom-1",
          billing_info: {
            last_payment: { time: "2026-07-01T00:00:00Z" },
            next_billing_time: "2026-08-01T00:00:00Z",
          },
        }),
      );

    const { getPayPalSubscription } = await loadClient();

    await expect(getPayPalSubscription("S-1")).resolves.toEqual({
      subscriptionId: "S-1",
      status: "ACTIVE",
      planId: "P-1",
      customId: "custom-1",
      currentPeriodStart: "2026-07-01T00:00:00Z",
      currentPeriodEnd: "2026-08-01T00:00:00Z",
    });
  });

  it("returns null subscription periods for a brand-new subscription", async () => {
    fetchMock
      .mockResolvedValueOnce(tokenResponse("tok-1"))
      .mockResolvedValueOnce(
        jsonResponse({
          id: "S-1",
          status: "APPROVAL_PENDING",
        }),
      );

    const { getPayPalSubscription } = await loadClient();

    await expect(getPayPalSubscription("S-1")).resolves.toEqual({
      subscriptionId: "S-1",
      status: "APPROVAL_PENDING",
      planId: null,
      customId: null,
      currentPeriodStart: null,
      currentPeriodEnd: null,
    });
  });

  it("maps cancel 204 responses to ok", async () => {
    fetchMock
      .mockResolvedValueOnce(tokenResponse("tok-1"))
      .mockResolvedValueOnce(noContentResponse());

    const { cancelPayPalSubscription } = await loadClient();

    await expect(
      cancelPayPalSubscription("S-1", "student canceled"),
    ).resolves.toEqual({ ok: true });
  });
});
