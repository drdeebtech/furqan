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

function webhookHeaders(overrides: Record<string, string | null> = {}): Headers {
  const base: Record<string, string> = {
    "paypal-auth-algo": "SHA256withRSA",
    "paypal-cert-url": "https://api.paypal.test/cert",
    "paypal-transmission-id": "tid-1",
    "paypal-transmission-sig": "sig-1",
    "paypal-transmission-time": "2026-07-24T00:00:00Z",
  };
  const headers = new Headers(base);
  for (const [key, value] of Object.entries(overrides)) {
    if (value === null) {
      headers.delete(key);
    } else {
      headers.set(key, value);
    }
  }
  return headers;
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
    expect(logErrorMock).toHaveBeenCalledTimes(1);
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

  it("throws when create-product response is missing id", async () => {
    fetchMock
      .mockResolvedValueOnce(tokenResponse("tok-1"))
      .mockResolvedValueOnce(jsonResponse({}));

    const { createPayPalProduct } = await loadClient();

    await expect(createPayPalProduct({ name: "Monthly" })).rejects.toThrow(
      "missing id",
    );
  });

  it("throws when create-plan response is missing id or status", async () => {
    fetchMock
      .mockResolvedValueOnce(tokenResponse("tok-1"))
      .mockResolvedValueOnce(jsonResponse({ id: "P-1" }));

    const { createPayPalPlan } = await loadClient();

    await expect(
      createPayPalPlan({ productId: "PROD-1", name: "Monthly", amountUsd: 19 }),
    ).rejects.toThrow("missing id/status");
  });

  it("throws when create-subscription response is missing id or status", async () => {
    fetchMock
      .mockResolvedValueOnce(tokenResponse("tok-1"))
      .mockResolvedValueOnce(jsonResponse({ id: "S-1" }));

    const { createPayPalSubscription } = await loadClient();

    await expect(
      createPayPalSubscription({
        planId: "P-1",
        customId: "c",
        returnUrl: "https://furqan.test/return",
        cancelUrl: "https://furqan.test/cancel",
      }),
    ).rejects.toThrow("missing id/status");
  });

  it("throws when create-subscription response lacks an approve link", async () => {
    fetchMock
      .mockResolvedValueOnce(tokenResponse("tok-1"))
      .mockResolvedValueOnce(
        jsonResponse({ id: "S-1", status: "APPROVAL_PENDING", links: [] }),
      );

    const { createPayPalSubscription } = await loadClient();

    await expect(
      createPayPalSubscription({
        planId: "P-1",
        customId: "c",
        returnUrl: "https://furqan.test/return",
        cancelUrl: "https://furqan.test/cancel",
      }),
    ).rejects.toThrow("missing approve link");
  });

  it("falls back to the argument id when the get response omits id", async () => {
    fetchMock
      .mockResolvedValueOnce(tokenResponse("tok-1"))
      .mockResolvedValueOnce(jsonResponse({ status: "ACTIVE" }));

    const { getPayPalSubscription } = await loadClient();

    await expect(getPayPalSubscription("S-9")).resolves.toMatchObject({
      subscriptionId: "S-9",
      status: "ACTIVE",
    });
  });

  it("revises a subscription: returns status + approveUrl and sends the request id", async () => {
    fetchMock
      .mockResolvedValueOnce(tokenResponse("tok-1"))
      .mockResolvedValueOnce(
        jsonResponse({
          status: "ACTIVE",
          links: [
            { rel: "approve", href: "https://paypal.test/revise-approve" },
          ],
        }),
      );

    const { revisePayPalSubscription } = await loadClient();

    await expect(
      revisePayPalSubscription({
        subscriptionId: "S-1",
        planId: "P-2",
        requestId: "rev-req-1",
      }),
    ).resolves.toEqual({
      status: "ACTIVE",
      approveUrl: "https://paypal.test/revise-approve",
    });

    const call = callForPath("/v1/billing/subscriptions/S-1/revise");
    expect(requestHeaders(call[1])["PayPal-Request-Id"]).toBe("rev-req-1");
  });

  it("revise returns null approveUrl when no re-approval is required", async () => {
    fetchMock
      .mockResolvedValueOnce(tokenResponse("tok-1"))
      .mockResolvedValueOnce(jsonResponse({ status: "ACTIVE" }));

    const { revisePayPalSubscription } = await loadClient();

    await expect(
      revisePayPalSubscription({ subscriptionId: "S-1", planId: "P-2" }),
    ).resolves.toEqual({ status: "ACTIVE", approveUrl: null });
  });

  it("revise throws when the response is missing status", async () => {
    fetchMock
      .mockResolvedValueOnce(tokenResponse("tok-1"))
      .mockResolvedValueOnce(jsonResponse({ links: [] }));

    const { revisePayPalSubscription } = await loadClient();

    await expect(
      revisePayPalSubscription({ subscriptionId: "S-1", planId: "P-2" }),
    ).rejects.toThrow("PayPal revise-subscription response missing status");
  });

  it("wraps a network failure in a generic error and logs it", async () => {
    fetchMock
      .mockResolvedValueOnce(tokenResponse("tok-1"))
      .mockRejectedValueOnce(new Error("ECONNRESET"));

    const { logError } = await import("@/lib/logger");
    const logErrorMock = vi.mocked(logError);
    const { createPayPalProduct } = await loadClient();

    let thrown: Error | null = null;
    try {
      await createPayPalProduct({ name: "Monthly" });
    } catch (error) {
      thrown = error as Error;
    }

    expect(thrown?.message).toBe("PayPal create-product request failed.");
    expect(thrown?.message).not.toContain("ECONNRESET");
    expect(logErrorMock).toHaveBeenCalledWith(
      "paypal: create-product failed",
      expect.any(Error),
      expect.objectContaining({ tag: "paypal" }),
    );
  });

  it("logs a non-2xx error with an undefined debug_id when the body has none", async () => {
    fetchMock
      .mockResolvedValueOnce(tokenResponse("tok-1"))
      .mockResolvedValueOnce(
        jsonResponse(
          { message: "nope" },
          { status: 400, statusText: "Bad Request" },
        ),
      );

    const { logError } = await import("@/lib/logger");
    const logErrorMock = vi.mocked(logError);
    const { createPayPalProduct } = await loadClient();

    await expect(createPayPalProduct({ name: "Monthly" })).rejects.toThrow(
      "400 Bad Request",
    );
    expect(logErrorMock).toHaveBeenCalledWith(
      "paypal: create-product failed",
      expect.anything(),
      expect.objectContaining({ tag: "paypal", debug_id: undefined }),
    );
  });

  it("includes an optional product description when provided", async () => {
    fetchMock
      .mockResolvedValueOnce(tokenResponse("tok-1"))
      .mockResolvedValueOnce(jsonResponse({ id: "PROD-1" }));

    const { createPayPalProduct } = await loadClient();
    await createPayPalProduct({ name: "Monthly", description: "Hifz plan" });

    const body = requestBody(callForPath("/v1/catalogs/products")[1]);
    expect(body.description).toBe("Hifz plan");
  });

  it("honors an explicit billing interval on plan creation", async () => {
    fetchMock
      .mockResolvedValueOnce(tokenResponse("tok-1"))
      .mockResolvedValueOnce(jsonResponse({ id: "P-1", status: "ACTIVE" }));

    const { createPayPalPlan } = await loadClient();
    await createPayPalPlan({
      productId: "PROD-1",
      name: "Quarterly",
      amountUsd: 50,
      intervalMonths: 3,
    });

    const body = requestBody(callForPath("/v1/billing/plans")[1]);
    const cycle = (body.billing_cycles as Array<Record<string, unknown>>)[0];
    const frequency = cycle.frequency as Record<string, unknown>;
    expect(frequency.interval_count).toBe(3);
    const pricing = cycle.pricing_scheme as Record<string, unknown>;
    const fixed = pricing.fixed_price as Record<string, unknown>;
    expect(fixed.value).toBe("50.00");
  });

  it("verify throws when PAYPAL_WEBHOOK_ID is unset", async () => {
    delete process.env.PAYPAL_WEBHOOK_ID;
    const { verifyPayPalWebhookSignature } = await loadClient();
    await expect(
      verifyPayPalWebhookSignature(webhookHeaders(), "{}"),
    ).rejects.toThrow("PAYPAL_WEBHOOK_ID is not set");
  });

  it("verify returns false when a transmission header is missing", async () => {
    process.env.PAYPAL_WEBHOOK_ID = "WH-1";
    const { verifyPayPalWebhookSignature } = await loadClient();
    await expect(
      verifyPayPalWebhookSignature(
        webhookHeaders({ "paypal-transmission-sig": null }),
        "{}",
      ),
    ).resolves.toBe(false);
  });

  it("verify returns false on a malformed body", async () => {
    process.env.PAYPAL_WEBHOOK_ID = "WH-1";
    const { verifyPayPalWebhookSignature } = await loadClient();
    await expect(
      verifyPayPalWebhookSignature(webhookHeaders(), "{"),
    ).resolves.toBe(false);
  });

  it("verify returns true when PayPal reports SUCCESS", async () => {
    process.env.PAYPAL_WEBHOOK_ID = "WH-1";
    fetchMock
      .mockResolvedValueOnce(tokenResponse("tok-1"))
      .mockResolvedValueOnce(jsonResponse({ verification_status: "SUCCESS" }));

    const { verifyPayPalWebhookSignature } = await loadClient();
    await expect(
      verifyPayPalWebhookSignature(webhookHeaders(), '{"id":"evt-1"}'),
    ).resolves.toBe(true);
  });

  it("verify returns false when PayPal does not report SUCCESS", async () => {
    process.env.PAYPAL_WEBHOOK_ID = "WH-1";
    fetchMock
      .mockResolvedValueOnce(tokenResponse("tok-1"))
      .mockResolvedValueOnce(jsonResponse({ verification_status: "FAILURE" }));

    const { verifyPayPalWebhookSignature } = await loadClient();
    await expect(
      verifyPayPalWebhookSignature(webhookHeaders(), '{"id":"evt-1"}'),
    ).resolves.toBe(false);
  });

  it("verify returns false when the verify endpoint is non-2xx", async () => {
    process.env.PAYPAL_WEBHOOK_ID = "WH-1";
    fetchMock
      .mockResolvedValueOnce(tokenResponse("tok-1"))
      .mockResolvedValueOnce(jsonResponse({}, { status: 500 }));

    const { verifyPayPalWebhookSignature } = await loadClient();
    await expect(
      verifyPayPalWebhookSignature(webhookHeaders(), '{"id":"evt-1"}'),
    ).resolves.toBe(false);
  });

  const ORDER_ARGS = {
    amountUsd: 40,
    referenceId: "ref-1",
    customId: "cust-1",
    description: "Single session",
    returnUrl: "https://furqan.test/return",
    cancelUrl: "https://furqan.test/cancel",
  };

  it("creates an order and returns the approve link", async () => {
    fetchMock
      .mockResolvedValueOnce(tokenResponse("tok-1"))
      .mockResolvedValueOnce(
        jsonResponse({
          id: "ORD-1",
          links: [{ rel: "approve", href: "https://paypal.test/approve" }],
        }),
      );

    const { createPayPalOrder } = await loadClient();
    await expect(createPayPalOrder(ORDER_ARGS)).resolves.toEqual({
      orderId: "ORD-1",
      approveUrl: "https://paypal.test/approve",
    });
  });

  it("falls back to the payer-action link when approve is absent", async () => {
    fetchMock
      .mockResolvedValueOnce(tokenResponse("tok-1"))
      .mockResolvedValueOnce(
        jsonResponse({
          id: "ORD-1",
          links: [{ rel: "payer-action", href: "https://paypal.test/payer" }],
        }),
      );

    const { createPayPalOrder } = await loadClient();
    await expect(createPayPalOrder(ORDER_ARGS)).resolves.toEqual({
      orderId: "ORD-1",
      approveUrl: "https://paypal.test/payer",
    });
  });

  it("throws when create-order lacks an id or an approve link", async () => {
    fetchMock
      .mockResolvedValueOnce(tokenResponse("tok-1"))
      .mockResolvedValueOnce(jsonResponse({ id: "ORD-1", links: [] }));

    const { createPayPalOrder } = await loadClient();
    await expect(createPayPalOrder(ORDER_ARGS)).rejects.toThrow(
      "missing approve link",
    );
  });

  it("captures an order and extracts capture id, amount, payer, and custom_id", async () => {
    fetchMock
      .mockResolvedValueOnce(tokenResponse("tok-1"))
      .mockResolvedValueOnce(
        jsonResponse({
          purchase_units: [
            {
              custom_id: "cust-1",
              payments: {
                captures: [
                  {
                    id: "CAP-1",
                    status: "COMPLETED",
                    amount: { currency_code: "USD", value: "40.00" },
                  },
                ],
              },
            },
          ],
          payer: { email_address: "payer@example.com" },
        }),
      );

    const { capturePayPalOrder } = await loadClient();
    await expect(capturePayPalOrder("ORD-1")).resolves.toEqual({
      captureId: "CAP-1",
      status: "COMPLETED",
      amountUsd: 40,
      payerEmail: "payer@example.com",
      customId: "cust-1",
    });
  });

  it("throws when a capture response has no capture id", async () => {
    fetchMock
      .mockResolvedValueOnce(tokenResponse("tok-1"))
      .mockResolvedValueOnce(jsonResponse({ purchase_units: [{}] }));

    const { capturePayPalOrder } = await loadClient();
    await expect(capturePayPalOrder("ORD-1")).rejects.toThrow(
      "missing capture id/status",
    );
  });

  it("throws when a capture amount is missing or non-numeric", async () => {
    fetchMock
      .mockResolvedValueOnce(tokenResponse("tok-1"))
      .mockResolvedValueOnce(
        jsonResponse({
          purchase_units: [
            {
              payments: {
                captures: [{ id: "CAP-1", status: "COMPLETED" }],
              },
            },
          ],
        }),
      );

    const { capturePayPalOrder } = await loadClient();
    await expect(capturePayPalOrder("ORD-1")).rejects.toThrow(
      "missing/invalid amount",
    );
  });

  it("reads an already-captured order via get-order", async () => {
    fetchMock
      .mockResolvedValueOnce(tokenResponse("tok-1"))
      .mockResolvedValueOnce(
        jsonResponse({
          status: "COMPLETED",
          purchase_units: [
            {
              custom_id: "cust-1",
              amount: { value: "40.00" },
              payments: {
                captures: [
                  { id: "CAP-1", amount: { value: "40.00" } },
                ],
              },
            },
          ],
        }),
      );

    const { getPayPalOrder } = await loadClient();
    await expect(getPayPalOrder("ORD-1")).resolves.toEqual({
      status: "COMPLETED",
      captureId: "CAP-1",
      amountUsd: 40,
      customId: "cust-1",
    });
  });

  it("returns a null captureId for an order not yet captured", async () => {
    fetchMock
      .mockResolvedValueOnce(tokenResponse("tok-1"))
      .mockResolvedValueOnce(
        jsonResponse({
          status: "APPROVED",
          purchase_units: [{ custom_id: "cust-1", amount: { value: "40.00" } }],
        }),
      );

    const { getPayPalOrder } = await loadClient();
    await expect(getPayPalOrder("ORD-1")).resolves.toEqual({
      status: "APPROVED",
      captureId: null,
      amountUsd: 40,
      customId: "cust-1",
    });
  });
});
