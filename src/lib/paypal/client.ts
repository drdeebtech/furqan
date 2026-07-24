import "server-only";

import { logError } from "@/lib/logger";

/**
 * Server-only PayPal REST client (spec 039 — PayPal as interim processor).
 *
 * Stripe is blocked by a pending company EIN, so PayPal is wired in as a
 * short-lived payment surface. The shape mirrors `src/lib/stripe/client.ts`:
 * server-only barrier, env-driven config guard, and a loud failure on a
 * missing secret (constitution: never silently degrade into "no charges").
 *
 * Secrets (`PAYPAL_CLIENT_ID`, `PAYPAL_CLIENT_SECRET`) are read from env on
 * demand — never `NEXT_PUBLIC_*`, never logged. `PAYPAL_API_BASE` selects
 * sandbox vs live; mode is purely env-driven (same philosophy as Stripe's
 * `STRIPE_SECRET_KEY` — no `if (test)` branch in code).
 *
 * Uses the global `fetch` (Node 24) — no SDK dependency to maintain.
 */

// ── Config (env-only) ────────────────────────────────────────────────────────
const PAYPAL_CLIENT_ID = process.env.PAYPAL_CLIENT_ID;
const PAYPAL_CLIENT_SECRET = process.env.PAYPAL_CLIENT_SECRET;
const PAYPAL_API_BASE = process.env.PAYPAL_API_BASE;

/**
 * True only when ALL three PayPal env vars are set. Routes use this to return
 * a clean 500 ("Server misconfigured") instead of throwing mid-handler when
 * PayPal is unconfigured — mirrors `isStripeConfigured()`.
 */
export function isPayPalConfigured(): boolean {
  return Boolean(
    PAYPAL_CLIENT_ID && PAYPAL_CLIENT_SECRET && PAYPAL_API_BASE,
  );
}

// ── Types ────────────────────────────────────────────────────────────────────
/** Shape returned by PayPal's /v1/oauth2/token. */
interface PayPalTokenResponse {
  access_token: string;
  /** Seconds until expiry. */
  expires_in: number;
  token_type: string;
  scope?: string;
  // PayPal may include these on some error paths; ignored on success.
  error?: string;
  error_description?: string;
}

export interface CreatePayPalOrderArgs {
  amountUsd: number;
  referenceId: string;
  customId: string;
  description: string;
  returnUrl: string;
  cancelUrl: string;
}

export interface CreatePayPalOrderResult {
  orderId: string;
  approveUrl: string;
}

export interface CapturePayPalOrderResult {
  captureId: string;
  status: string;
  amountUsd: number;
  payerEmail: string | null;
  /** FROZEN grant context stamped at checkout (`prepaid_hours:<uuid>:<h>:<rate>`). */
  customId: string | null;
}

/** Shape returned by GET /v2/checkout/orders/{id} (idempotent re-entry lookup). */
export interface GetPayPalOrderResult {
  status: string;
  captureId: string | null;
  amountUsd: number | null;
  customId: string | null;
}

export interface CreatePayPalProductResult {
  productId: string;
}

export interface CreatePayPalPlanResult {
  planId: string;
  status: string;
}

export interface CreatePayPalSubscriptionResult {
  subscriptionId: string;
  status: string;
  approveUrl: string;
}

export interface GetPayPalSubscriptionResult {
  subscriptionId: string;
  status: string;
  planId: string | null;
  customId: string | null;
  currentPeriodStart: string | null;
  currentPeriodEnd: string | null;
}

export interface CancelPayPalSubscriptionResult {
  ok: true;
}

export interface RevisePayPalSubscriptionResult {
  status: string;
  approveUrl: string | null;
}

// ── Token cache (module-level) ───────────────────────────────────────────────
// PayPal access tokens last ~9h (sandbox) / ~32400s. We cache one in-memory
// and refresh it ~60s before expiry so a request mid-flight at the boundary
// doesn't hit a 401. A module-level variable is fine for a single Vercel
// serverless function instance — worst case is one extra token fetch per
// cold start, which is the same cost as Stripe's SDK cold-init.
interface CachedToken {
  accessToken: string;
  // Absolute epoch-ms at which this token should be discarded. We pre-empt
  // by REFRESH_MARGIN_MS so a request issued at the boundary still has time
  // to land.
  expiresAtMs: number;
}

const REFRESH_MARGIN_MS = 60_000;
let cachedToken: CachedToken | null = null;

function invalidatePayPalToken(): void {
  cachedToken = null;
}

// ── Network timeout ──────────────────────────────────────────────────────────
// PayPal fetches (token, create-order, capture, get-order, verify-webhook) all
// run through this wrapper so a hung TCP connection cannot stall a serverless
// invocation past its maxDuration. 10s is well above PayPal's p99 latency but
// well below the 60s route budget, leaving room for retry inside the same
// request if the caller chooses to.
const PAYPAL_FETCH_TIMEOUT_MS = 10_000;

/**
 * `fetch` with an AbortController-driven timeout. Aborts (→ throws an
 * AbortError) after PAYPAL_FETCH_TIMEOUT_MS of inactivity. The timer is
 * cleared in `finally` so a fast response never holds the timer open.
 */
async function fetchPayPal(input: string, init: RequestInit): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), PAYPAL_FETCH_TIMEOUT_MS);
  try {
    return await fetch(input, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Returns a valid bearer token, refreshing on demand. Throws a clear Error
 * (surfaces as 500 via logError) on any PayPal auth failure.
 *
 * `Authorization: Basic base64(client_id:client_secret)` per PayPal docs.
 * Body is `application/x-www-form-urlencoded` (NOT JSON) for the token
 * endpoint — a common PayPal gotcha.
 */
export async function getPayPalAccessToken(): Promise<string> {
  // Refresh window: discard if within REFRESH_MARGIN_MS of expiry.
  if (cachedToken && Date.now() < cachedToken.expiresAtMs) {
    return cachedToken.accessToken;
  }

  if (!PAYPAL_API_BASE || !PAYPAL_CLIENT_ID || !PAYPAL_CLIENT_SECRET) {
    throw new Error(
      "PayPal is not configured. Set PAYPAL_CLIENT_ID, PAYPAL_CLIENT_SECRET, and PAYPAL_API_BASE in the server environment (never NEXT_PUBLIC_*).",
    );
  }

  const basicAuth = Buffer.from(
    `${PAYPAL_CLIENT_ID}:${PAYPAL_CLIENT_SECRET}`,
  ).toString("base64");

  const url = `${PAYPAL_API_BASE}/v1/oauth2/token`;
  const res = await fetchPayPal(url, {
    method: "POST",
    headers: {
      Authorization: `Basic ${basicAuth}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: "grant_type=client_credentials",
  });

  if (!res.ok) {
    throw new Error(
      `PayPal token request failed: ${res.status} ${res.statusText}`,
    );
  }

  const json = (await res.json()) as PayPalTokenResponse;
  if (!json.access_token || typeof json.expires_in !== "number") {
    throw new Error(`PayPal token response missing access_token / expires_in`);
  }

  cachedToken = {
    accessToken: json.access_token,
    expiresAtMs: Date.now() + Math.max(0, json.expires_in * 1000) - REFRESH_MARGIN_MS,
  };
  return cachedToken.accessToken;
}

// ── Order create / capture ───────────────────────────────────────────────────
/** Centralized header builder so create + capture share one auth path. */
async function authedJsonHeaders(): Promise<Record<string, string>> {
  const token = await getPayPalAccessToken();
  return {
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/json",
  };
}

interface PayPalRequestOptions {
  body?: unknown;
  requestId?: string;
  expectNoContent?: boolean;
}

interface PayPalErrorBody {
  name?: unknown;
  message?: unknown;
  debug_id?: unknown;
  details?: unknown;
}

class PayPalHandledRequestError extends Error {}

async function buildPayPalRequestHeaders(
  requestId: string | undefined,
): Promise<Record<string, string>> {
  const token = await getPayPalAccessToken();
  const headers: Record<string, string> = {
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/json",
  };
  if (requestId) {
    headers["PayPal-Request-Id"] = requestId;
  }
  return headers;
}

async function readPayPalErrorBody(res: Response): Promise<PayPalErrorBody> {
  try {
    return (await res.json()) as PayPalErrorBody;
  } catch {
    return {};
  }
}

function paypalDebugId(err: PayPalErrorBody): string | undefined {
  return typeof err.debug_id === "string" ? err.debug_id : undefined;
}

/* eslint-disable @typescript-eslint/no-explicit-any -- PayPal responses are endpoint-specific; exported callers narrow the parsed JSON. */
async function paypalRequest(
  op: string,
  method: string,
  path: string,
  opts: PayPalRequestOptions = {},
): Promise<any> {
  try {
    if (!PAYPAL_API_BASE) {
      throw new PayPalHandledRequestError(
        "PayPal is not configured: PAYPAL_API_BASE is missing.",
      );
    }

    const url = `${PAYPAL_API_BASE}${path}`;
    const requestBody =
      opts.body === undefined ? undefined : JSON.stringify(opts.body);

    let headers = await buildPayPalRequestHeaders(opts.requestId);
    let res = await fetchPayPal(url, {
      method,
      headers,
      body: requestBody,
    });

    if (res.status === 401) {
      invalidatePayPalToken();
      headers = await buildPayPalRequestHeaders(opts.requestId);
      res = await fetchPayPal(url, {
        method,
        headers,
        body: requestBody,
      });
    }

    if (!res.ok) {
      const err = await readPayPalErrorBody(res);
      logError(`paypal: ${op} failed`, err, {
        tag: "paypal",
        status: res.status,
        debug_id: paypalDebugId(err),
      });
      throw new PayPalHandledRequestError(
        `PayPal ${op} request failed: ${res.status} ${res.statusText}`,
      );
    }

    if (opts.expectNoContent) {
      return null;
    }

    try {
      return await res.json();
    } catch (error) {
      logError(`paypal: ${op} failed`, error, { tag: "paypal" });
      throw new PayPalHandledRequestError(
        `PayPal ${op} response parse failed`,
      );
    }
  } catch (error) {
    if (error instanceof PayPalHandledRequestError) {
      throw error;
    }

    logError(`paypal: ${op} failed`, error, { tag: "paypal" });
    throw new Error(`PayPal ${op} request failed.`);
  }
}
/* eslint-enable @typescript-eslint/no-explicit-any */

/**
 * Creates a PayPal order (intent: CAPTURE) with one purchase_unit and a
 * PayPal-style experience_context (return/cancel URLs, PAY_NOW, NO_SHIPPING).
 *
 * Returns `{ orderId, approveUrl }` where approveUrl is the link with
 * `rel === "approve"` (PayPal sometimes returns `"payer-action"` instead —
 * we fall back to that).
 */
export async function createPayPalOrder(
  args: CreatePayPalOrderArgs,
): Promise<CreatePayPalOrderResult> {
  if (!PAYPAL_API_BASE) {
    throw new Error(
      "PayPal is not configured: PAYPAL_API_BASE is missing.",
    );
  }

  const body = {
    intent: "CAPTURE",
    purchase_units: [
      {
        amount: {
          currency_code: "USD",
          value: args.amountUsd.toFixed(2),
        },
        reference_id: args.referenceId,
        custom_id: args.customId,
        description: args.description,
      },
    ],
    payment_source: {
      paypal: {
        experience_context: {
          return_url: args.returnUrl,
          cancel_url: args.cancelUrl,
          user_action: "PAY_NOW",
          shipping_preference: "NO_SHIPPING",
        },
      },
    },
  };

  const url = `${PAYPAL_API_BASE}/v2/checkout/orders`;
  const res = await fetchPayPal(url, {
    method: "POST",
    headers: await authedJsonHeaders(),
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    throw new Error(
      `PayPal create-order request failed: ${res.status} ${res.statusText}`,
    );
  }

  const json = (await res.json()) as {
    id?: string;
    links?: Array<{ href: string; rel: string; method?: string }>;
  };

  if (!json.id) {
    throw new Error(`PayPal create-order response missing id`);
  }

  const approveLink =
    json.links?.find((l) => l.rel === "approve") ??
    json.links?.find((l) => l.rel === "payer-action");
  if (!approveLink?.href) {
    throw new Error(`PayPal create-order response missing approve link`);
  }

  return { orderId: json.id, approveUrl: approveLink.href };
}

/**
 * Captures a previously-approved PayPal order. Used by the webhook/grant step
 * (Phase 2b). Typed now so 2b just drops in.
 */
export async function capturePayPalOrder(
  orderId: string,
): Promise<CapturePayPalOrderResult> {
  if (!PAYPAL_API_BASE) {
    throw new Error(
      "PayPal is not configured: PAYPAL_API_BASE is missing.",
    );
  }

  const url = `${PAYPAL_API_BASE}/v2/checkout/orders/${encodeURIComponent(orderId)}/capture`;
  const res = await fetchPayPal(url, {
    method: "POST",
    headers: await authedJsonHeaders(),
    body: "{}",
  });

  if (!res.ok) {
    throw new Error(
      `PayPal capture-order request failed: ${res.status} ${res.statusText}`,
    );
  }

  const json = (await res.json()) as {
    purchase_units?: Array<{
      custom_id?: string;
      amount?: { currency_code?: string; value?: string };
      payments?: {
        captures?: Array<{
          id?: string;
          status?: string;
          custom_id?: string;
          amount?: { currency_code?: string; value?: string };
        }>;
      };
    }>;
    payer?: { email_address?: string };
  };

  const purchaseUnit = json.purchase_units?.[0] ?? undefined;
  const capture = purchaseUnit?.payments?.captures?.[0] ?? undefined;
  if (!capture?.id || !capture.status) {
    throw new Error(`PayPal capture response missing capture id/status`);
  }

  const valueStr = capture.amount?.value;
  const amountUsd = valueStr ? Number(valueStr) : NaN;
  if (!Number.isFinite(amountUsd)) {
    throw new Error(`PayPal capture response missing/invalid amount.value`);
  }

  return {
    captureId: capture.id,
    status: capture.status,
    amountUsd,
    payerEmail: json.payer?.email_address ?? null,
    // FROZEN grant context — prefer the capture-level custom_id (set on the
    // capture by PayPal when present), fall back to the purchase-unit level
    // (where checkout stamped it). Null only if PayPal dropped it entirely.
    customId: capture.custom_id ?? purchaseUnit?.custom_id ?? null,
  };
}

/**
 * GET /v2/checkout/orders/{id} — idempotent order lookup.
 *
 * Used by the capture/grant return route to RECOVER the capture id when the
 * order was ALREADY captured (a redelivery, or the buyer hit the return URL
 * after the webhook already captured). `capturePayPalOrder` throws on an
 * already-captured order; this GET reads the existing capture from
 * `purchase_units[0].payments.captures[0]` without mutating anything.
 *
 * Returns `captureId: null` when the order has NOT yet been captured (no
 * captures array) — the caller treats that as "pending, not recoverable".
 */
export async function getPayPalOrder(orderId: string): Promise<GetPayPalOrderResult> {
  if (!PAYPAL_API_BASE) {
    throw new Error(
      "PayPal is not configured: PAYPAL_API_BASE is missing.",
    );
  }

  const url = `${PAYPAL_API_BASE}/v2/checkout/orders/${encodeURIComponent(orderId)}`;
  const res = await fetchPayPal(url, {
    method: "GET",
    headers: await authedJsonHeaders(),
  });

  if (!res.ok) {
    throw new Error(
      `PayPal get-order request failed: ${res.status} ${res.statusText}`,
    );
  }

  const json = (await res.json()) as {
    status?: string;
    purchase_units?: Array<{
      custom_id?: string;
      amount?: { currency_code?: string; value?: string };
      payments?: {
        captures?: Array<{
          id?: string;
          status?: string;
          custom_id?: string;
          amount?: { currency_code?: string; value?: string };
        }>;
      };
    }>;
  };

  const purchaseUnit = json.purchase_units?.[0] ?? undefined;
  const capture = purchaseUnit?.payments?.captures?.[0] ?? undefined;

  // Amount: prefer the capture-level amount (what was actually charged), fall
  // back to the purchase-unit amount (the quoted amount). Null if neither is a
  // finite number — the caller's tamper guard will fail-close.
  const valueStr = capture?.amount?.value ?? purchaseUnit?.amount?.value;
  const amountUsd = valueStr ? Number(valueStr) : NaN;

  return {
    status: json.status ?? "UNKNOWN",
    captureId: capture?.id ?? null,
    amountUsd: Number.isFinite(amountUsd) ? amountUsd : null,
    customId: capture?.custom_id ?? purchaseUnit?.custom_id ?? null,
  };
}

// ── Recurring subscriptions ──────────────────────────────────────────────────

export async function createPayPalProduct(args: {
  name: string;
  description?: string;
  requestId?: string;
}): Promise<CreatePayPalProductResult> {
  const body = {
    name: args.name,
    ...(args.description ? { description: args.description } : {}),
    type: "SERVICE",
    category: "SOFTWARE",
  };

  const json = (await paypalRequest("create-product", "POST", "/v1/catalogs/products", {
    body,
    requestId: args.requestId,
  })) as { id?: string };

  if (!json.id) {
    throw new Error(`PayPal create-product response missing id`);
  }

  return { productId: json.id };
}

export async function createPayPalPlan(args: {
  productId: string;
  name: string;
  amountUsd: number;
  intervalMonths?: number;
  requestId?: string;
}): Promise<CreatePayPalPlanResult> {
  const intervalMonths = args.intervalMonths ?? 1;
  const body = {
    product_id: args.productId,
    name: args.name,
    billing_cycles: [
      {
        frequency: {
          interval_unit: "MONTH",
          interval_count: intervalMonths,
        },
        tenure_type: "REGULAR",
        sequence: 1,
        total_cycles: 0,
        pricing_scheme: {
          fixed_price: {
            value: args.amountUsd.toFixed(2),
            currency_code: "USD",
          },
        },
      },
    ],
    payment_preferences: {
      auto_bill_outstanding: true,
      setup_fee_failure_action: "CANCEL",
      payment_failure_threshold: 1,
    },
  };

  const json = (await paypalRequest("create-plan", "POST", "/v1/billing/plans", {
    body,
    requestId: args.requestId,
  })) as { id?: string; status?: string };

  if (!json.id || !json.status) {
    throw new Error(`PayPal create-plan response missing id/status`);
  }

  return { planId: json.id, status: json.status };
}

export async function createPayPalSubscription(args: {
  planId: string;
  customId: string;
  returnUrl: string;
  cancelUrl: string;
  requestId?: string;
}): Promise<CreatePayPalSubscriptionResult> {
  const body = {
    plan_id: args.planId,
    custom_id: args.customId,
    application_context: {
      return_url: args.returnUrl,
      cancel_url: args.cancelUrl,
      user_action: "SUBSCRIBE_NOW",
      shipping_preference: "NO_SHIPPING",
    },
  };

  const json = (await paypalRequest(
    "create-subscription",
    "POST",
    "/v1/billing/subscriptions",
    {
      body,
      requestId: args.requestId,
    },
  )) as {
    id?: string;
    status?: string;
    links?: Array<{ href?: string; rel?: string; method?: string }>;
  };

  if (!json.id || !json.status) {
    throw new Error(`PayPal create-subscription response missing id/status`);
  }

  const approveLink = json.links?.find((l) => l.rel === "approve");
  if (!approveLink?.href) {
    throw new Error(`PayPal create-subscription response missing approve link`);
  }

  return {
    subscriptionId: json.id,
    status: json.status,
    approveUrl: approveLink.href,
  };
}

export async function getPayPalSubscription(
  subscriptionId: string,
): Promise<GetPayPalSubscriptionResult> {
  const json = (await paypalRequest(
    "get-subscription",
    "GET",
    `/v1/billing/subscriptions/${encodeURIComponent(subscriptionId)}`,
  )) as {
    id?: string;
    status?: string;
    plan_id?: string;
    custom_id?: string;
    billing_info?: {
      last_payment?: { time?: string };
      next_billing_time?: string;
    };
  };

  return {
    subscriptionId: json.id ?? subscriptionId,
    status: json.status ?? "UNKNOWN",
    planId: json.plan_id ?? null,
    customId: json.custom_id ?? null,
    currentPeriodStart: json.billing_info?.last_payment?.time ?? null,
    currentPeriodEnd: json.billing_info?.next_billing_time ?? null,
  };
}

export async function cancelPayPalSubscription(
  subscriptionId: string,
  reason: string,
): Promise<CancelPayPalSubscriptionResult> {
  await paypalRequest(
    "cancel-subscription",
    "POST",
    `/v1/billing/subscriptions/${encodeURIComponent(subscriptionId)}/cancel`,
    {
      body: { reason },
      expectNoContent: true,
    },
  );

  return { ok: true };
}

export async function revisePayPalSubscription(args: {
  subscriptionId: string;
  planId: string;
  requestId?: string;
}): Promise<RevisePayPalSubscriptionResult> {
  const json = (await paypalRequest(
    "revise-subscription",
    "POST",
    `/v1/billing/subscriptions/${encodeURIComponent(args.subscriptionId)}/revise`,
    {
      body: { plan_id: args.planId },
      requestId: args.requestId,
    },
  )) as {
    status?: string;
    links?: Array<{ href?: string; rel?: string; method?: string }>;
  };

  // A revise is a state-changing billing-plan change; a response with no status
  // is unrecognized, so fail loud (matching createPayPalPlan / createPayPalSubscription)
  // rather than silently returning "UNKNOWN" as if the change had completed.
  if (!json.status) {
    throw new Error(`PayPal revise-subscription response missing status`);
  }

  return {
    status: json.status,
    approveUrl: json.links?.find((l) => l.rel === "approve")?.href ?? null,
  };
}

// ── Webhook verification ─────────────────────────────────────────────────────

/**
 * True iff `PAYPAL_WEBHOOK_ID` is set. The webhook route uses this to return a
 * clean 503 ("not configured") instead of attempting signature verification
 * with a missing webhook id (which would always fail). Mirrors the Stripe
 * route's missing-config 503 gate.
 */
export function isPayPalWebhookConfigured(): boolean {
  return Boolean(process.env.PAYPAL_WEBHOOK_ID);
}

/** PayPal-to-Node header name map for webhook signature verification. */
const PAYPAL_WEBHOOK_HEADERS = {
  authAlgo: "paypal-auth-algo",
  certUrl: "paypal-cert-url",
  transmissionId: "paypal-transmission-id",
  transmissionSig: "paypal-transmission-sig",
  transmissionTime: "paypal-transmission-time",
} as const;

/**
 * Verifies a PayPal webhook signature via POST /v1/notifications/verify-webhook-signature.
 *
 * PayPal sends five transmission headers (algo, cert url, transmission id, sig,
 * time) alongside the raw body. We forward ALL of them + the parsed body + the
 * configured `PAYPAL_WEBHOOK_ID` to PayPal's verify endpoint and trust ONLY
 * `verification_status === 'SUCCESS'`.
 *
 * Fail-closed posture (mirrors `stripe.webhooks.constructEvent`):
 *   - If `PAYPAL_WEBHOOK_ID` is missing → THROW (the route maps this to 503,
 *     same as Stripe's missing-secret gate). Never return false here — a false
 *     return would let the route emit a 400 "invalid signature" which is the
 *     WRONG signal for a config problem.
 *   - If PayPal returns a non-SUCCESS status → return false (route emits 400
 *     with ZERO side effects — NFR-001).
 *   - Network/parse errors bubble up (route catches and 500s).
 *
 * Never logs secrets: the transmission_sig / cert_url are PayPal-provided
 * verification material, not our credentials; we still avoid logging them.
 */
export async function verifyPayPalWebhookSignature(
  headers: Headers,
  rawBody: string,
): Promise<boolean> {
  const webhookId = process.env.PAYPAL_WEBHOOK_ID;
  if (!webhookId) {
    throw new Error(
      "PayPal webhook verification failed: PAYPAL_WEBHOOK_ID is not set.",
    );
  }

  if (!PAYPAL_API_BASE) {
    throw new Error(
      "PayPal webhook verification failed: PAYPAL_API_BASE is missing.",
    );
  }

  const authAlgo = headers.get(PAYPAL_WEBHOOK_HEADERS.authAlgo);
  const certUrl = headers.get(PAYPAL_WEBHOOK_HEADERS.certUrl);
  const transmissionId = headers.get(PAYPAL_WEBHOOK_HEADERS.transmissionId);
  const transmissionSig = headers.get(PAYPAL_WEBHOOK_HEADERS.transmissionSig);
  const transmissionTime = headers.get(PAYPAL_WEBHOOK_HEADERS.transmissionTime);

  // Any missing transmission header → cannot verify → fail-closed (false).
  // (Distinct from a missing webhook_id, which is a config error → throw.)
  if (!authAlgo || !certUrl || !transmissionId || !transmissionSig || !transmissionTime) {
    return false;
  }

  let webhookEvent: unknown;
  try {
    webhookEvent = JSON.parse(rawBody);
  } catch {
    // Malformed body → cannot forward to PayPal → fail-closed.
    return false;
  }

  const url = `${PAYPAL_API_BASE}/v1/notifications/verify-webhook-signature`;
  const res = await fetchPayPal(url, {
    method: "POST",
    headers: await authedJsonHeaders(),
    body: JSON.stringify({
      auth_algo: authAlgo,
      cert_url: certUrl,
      transmission_id: transmissionId,
      transmission_sig: transmissionSig,
      transmission_time: transmissionTime,
      webhook_id: webhookId,
      webhook_event: webhookEvent,
    }),
  });

  if (!res.ok) {
    // PayPal verify endpoint returned non-2xx — treat as NOT verified.
    return false;
  }

  const json = (await res.json()) as { verification_status?: string };
  return json.verification_status === "SUCCESS";
}
