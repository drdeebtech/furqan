/**
 * Thin server-only wrapper around PayPal Orders v2 REST.
 *
 * Two operations: createOrder (intent: CAPTURE) and captureOrder. Both go
 * through the OAuth client-credentials grant transparently — token is fetched
 * on each call to keep this module stateless and survive serverless cold
 * boots without a shared cache.
 *
 * Mode (sandbox vs live) is determined by PAYPAL_API_BASE. Defaults to
 * sandbox if unset so a missing env var fails safe (no real charges).
 *
 * Errors are thrown as plain Error with a sanitized message — callers wrap
 * via loudAction so they land in Sentry + audit_log automatically.
 */

import "server-only";

const SANDBOX = "https://api-m.sandbox.paypal.com";
const LIVE = "https://api-m.paypal.com";

function apiBase(): string {
  return process.env.PAYPAL_API_BASE?.trim() || SANDBOX;
}

function isLive(): boolean {
  return apiBase() === LIVE;
}

function requireEnv(name: "PAYPAL_CLIENT_ID" | "PAYPAL_CLIENT_SECRET"): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is not set — PayPal disabled`);
  return value;
}

async function fetchAccessToken(): Promise<string> {
  const clientId = requireEnv("PAYPAL_CLIENT_ID");
  const secret = requireEnv("PAYPAL_CLIENT_SECRET");
  const credentials = Buffer.from(`${clientId}:${secret}`).toString("base64");

  const res = await fetch(`${apiBase()}/v1/oauth2/token`, {
    method: "POST",
    headers: {
      Authorization: `Basic ${credentials}`,
      "Content-Type": "application/x-www-form-urlencoded",
      Accept: "application/json",
    },
    body: "grant_type=client_credentials",
    cache: "no-store",
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`PayPal OAuth failed (${res.status}): ${body.slice(0, 200)}`);
  }
  const json = (await res.json()) as { access_token?: string };
  if (!json.access_token) throw new Error("PayPal OAuth returned no access_token");
  return json.access_token;
}

interface CreateOrderInput {
  amount: number;            // Numeric amount (e.g. 40)
  currencyCode: string;      // ISO-4217 (USD/GBP/SAR/AUD)
  description: string;       // Human-readable line item
  customId?: string;         // Our internal ref (e.g. payments.id)
  returnUrl?: string;        // Optional redirect for non-modal flows
  cancelUrl?: string;
}

export interface CreateOrderResult {
  orderId: string;
  approveUrl: string | null;
  mode: "sandbox" | "live";
}

export async function createOrder(input: CreateOrderInput): Promise<CreateOrderResult> {
  const token = await fetchAccessToken();
  const amountString = input.amount.toFixed(2); // PayPal expects "40.00"

  const res = await fetch(`${apiBase()}/v2/checkout/orders`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    cache: "no-store",
    body: JSON.stringify({
      intent: "CAPTURE",
      purchase_units: [
        {
          reference_id: input.customId ?? "default",
          description: input.description,
          amount: {
            currency_code: input.currencyCode,
            value: amountString,
          },
          custom_id: input.customId,
        },
      ],
      application_context: {
        brand_name: "FURQAN Academy",
        landing_page: "NO_PREFERENCE",
        user_action: "PAY_NOW",
        return_url: input.returnUrl,
        cancel_url: input.cancelUrl,
      },
    }),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`PayPal createOrder failed (${res.status}): ${body.slice(0, 300)}`);
  }
  const json = (await res.json()) as {
    id?: string;
    links?: { rel: string; href: string }[];
  };
  if (!json.id) throw new Error("PayPal createOrder returned no order id");

  const approveUrl = json.links?.find((l) => l.rel === "approve")?.href ?? null;
  return { orderId: json.id, approveUrl, mode: isLive() ? "live" : "sandbox" };
}

export interface CaptureOrderResult {
  captureId: string;
  status: string;
  payerEmail: string | null;
  amount: { value: string; currencyCode: string } | null;
}

export async function captureOrder(orderId: string): Promise<CaptureOrderResult> {
  const token = await fetchAccessToken();

  const res = await fetch(`${apiBase()}/v2/checkout/orders/${orderId}/capture`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    cache: "no-store",
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`PayPal captureOrder failed (${res.status}): ${body.slice(0, 300)}`);
  }
  const json = (await res.json()) as {
    status?: string;
    payer?: { email_address?: string };
    purchase_units?: {
      payments?: {
        captures?: { id: string; status: string; amount?: { value: string; currency_code: string } }[];
      };
    }[];
  };

  const capture = json.purchase_units?.[0]?.payments?.captures?.[0];
  if (!capture?.id) throw new Error("PayPal captureOrder returned no capture id");

  return {
    captureId: capture.id,
    status: capture.status ?? json.status ?? "UNKNOWN",
    payerEmail: json.payer?.email_address ?? null,
    amount: capture.amount
      ? { value: capture.amount.value, currencyCode: capture.amount.currency_code }
      : null,
  };
}
