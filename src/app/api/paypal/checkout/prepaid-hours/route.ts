import { NextResponse } from "next/server";
import { z } from "zod";
import { createPayPalOrder, isPayPalConfigured } from "@/lib/paypal/client";
import { requireRole } from "@/lib/auth/require-admin";
import { UnauthenticatedError, ForbiddenError } from "@/lib/auth/errors";
import { logError, logInfo } from "@/lib/logger";
import { getSetting, isFeatureEnabled } from "@/lib/settings";
import {
  PREPAID_DEFAULT_RATE_USD as DEFAULT_RATE_USD,
  PREPAID_DEFAULT_CUSTOM_MIN as DEFAULT_CUSTOM_MIN,
  PREPAID_DEFAULT_CUSTOM_MAX as DEFAULT_CUSTOM_MAX,
} from "@/lib/domains/billing/prepaid-defaults";
import {
  PAYMENTS_UNAVAILABLE_MESSAGE,
  PAYMENTS_UNAVAILABLE_STATUS,
} from "@/lib/payments/provider-unavailable";

export const maxDuration = 60;

/**
 * Spec 039 — PayPal interim payment processor, Phase 2a (checkout create only).
 *
 * Stripe is blocked pending a company EIN, so PayPal fills in as the
 * processor for the prepaid-hour "buy" surface. This route mirrors the
 * Stripe prepaid-hours checkout almost exactly — same feature-flag-then-404
 * fail-closed posture, same `requireRole("student")` auth gate, same
 * zod-`.strict()` body that accepts ONLY `hours`, same server-derived
 * amount + bounds from `platform_settings` (never from the client).
 *
 * Phase 2a creates the order ONLY. The capture/grant step (Phase 2b, the
 * PayPal webhook + captureOrder → grant_prepaid_hours) is NOT here yet.
 * Until 2b lands this route is reachable but does not grant hours.
 *
 * Feature flag: `paypal_purchase_enabled` in platform_settings (default OFF,
 * missing key → 404, not 501). The PayPal surface stays invisible until an
 * admin flips it on, same posture as `prepaid_hours_purchase_enabled`.
 */

// ── Body schema (FR-016 zod at the boundary) ─────────────────────────────────
// Client sends ONLY hours. Amount, rate, currency, and product_type are
// server-derived. `hours` is clamped to the custom min/max from settings below.
const PrepaidCheckoutSchema = z
  .object({
    hours: z.number().int().finite().positive(),
  })
  .strict();

type PrepaidCheckout = z.infer<typeof PrepaidCheckoutSchema>;

// ── Setting readers ──────────────────────────────────────────────────────────
// Same wallet money knobs + same defensive parsing as the Stripe prepaid route.
// Missing/blank/non-finite → seeded default. The webhook (2b) re-derives the
// grant from the FROZEN rate stamped into PayPal `custom_id`, NOT from a
// re-read of the setting, so a mid-flight admin rate change cannot desync the
// charged amount from the granted lot's rate_paid_usd (R1).

// Defaults are imported from @/lib/domains/billing/prepaid-defaults. This is
// the CHARGE path — a stale local copy bills the wrong amount.

async function readRateUsd(): Promise<number> {
  const raw = await getSetting("prepaid_hours_rate_usd");
  if (raw === null || raw === undefined || raw.trim() === "") return DEFAULT_RATE_USD;
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) return DEFAULT_RATE_USD;
  return Math.round(n * 100) / 100;
}

async function readCustomBounds(): Promise<{ min: number; max: number }> {
  const readMin = await getSetting("prepaid_hours_custom_min");
  const readMax = await getSetting("prepaid_hours_custom_max");
  const min = (() => {
    if (readMin === null || readMin === undefined || readMin.trim() === "") return DEFAULT_CUSTOM_MIN;
    const n = Number(readMin);
    if (!Number.isFinite(n) || n < 1) return DEFAULT_CUSTOM_MIN;
    return Math.floor(n);
  })();
  const max = (() => {
    if (readMax === null || readMax === undefined || readMax.trim() === "") return DEFAULT_CUSTOM_MAX;
    const n = Number(readMax);
    if (!Number.isFinite(n) || n < min) return DEFAULT_CUSTOM_MAX;
    return Math.floor(n);
  })();
  // Admin can set min > 100 while max is missing/invalid → the IIFE above
  // would yield max=DEFAULT_CUSTOM_MAX=100 < min, rejecting every request
  // ("between 200 and 100"). Reset both to defaults if the final range is
  // inverted, so checkout never hard-fails on a misconfigured bound.
  if (max < min) return { min: DEFAULT_CUSTOM_MIN, max: DEFAULT_CUSTOM_MAX };
  return { min, max };
}

/**
 * POST /api/paypal/checkout/prepaid-hours
 *
 * Creates a PayPal order (intent: CAPTURE) for a prepaid-hour bundle and
 * returns `{ orderId, approveUrl }` so the client can redirect to PayPal.
 * Does NOT grant hours — the capture step (Phase 2b) does that.
 */
export async function POST(request: Request) {
  // ── Feature flag (R10): default OFF; 404 (not 501) so the surface is
  // invisible to students until an admin flips the setting on. ──────────────
  const enabled = await isFeatureEnabled("paypal_purchase_enabled");
  if (!enabled) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  // ── Auth gate (FR-005: identity from session only) ────────────────────────
  let studentId: string;
  try {
    ({ id: studentId } = await requireRole("student"));
  } catch (e) {
    if (e instanceof UnauthenticatedError) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    if (e instanceof ForbiddenError) {
      return NextResponse.json(
        { error: "Only students may purchase prepaid hours" },
        { status: 403 },
      );
    }
    throw e;
  }

  // ── Body validation ────────────────────────────────────────────────────────
  let body: PrepaidCheckout;
  try {
    body = PrepaidCheckoutSchema.parse(await request.json());
  } catch (e) {
    if (e instanceof z.ZodError) {
      return NextResponse.json(
        { error: "Invalid body", issues: e.flatten() },
        { status: 400 },
      );
    }
    return NextResponse.json(
      { error: "Invalid or malformed JSON body" },
      { status: 400 },
    );
  }

  // ── Rate + bounds from settings (server-only; FR-002) ─────────────────────
  const rateUsd = await readRateUsd();
  const { min, max } = await readCustomBounds();

  if (body.hours < min || body.hours > max) {
    return NextResponse.json(
      {
        success: false,
        error: `Hours must be between ${min} and ${max}`,
      },
      { status: 422 },
    );
  }

  // ── Server-side amount computation (FR-002: never trust client amount) ────
  const amountUsd = Math.round(body.hours * rateUsd * 100) / 100;

  // ── PayPal configuration gates ─────────────────────────────────────────────
  if (!isPayPalConfigured()) {
    logError(
      "paypal-prepaid checkout: PayPal not configured",
      new Error("no-paypal-credentials"),
      { tag: "paypal-prepaid" },
    );
    return NextResponse.json(
      { success: false, error: PAYMENTS_UNAVAILABLE_MESSAGE },
      { status: PAYMENTS_UNAVAILABLE_STATUS },
    );
  }

  const appUrl = process.env.NEXT_PUBLIC_APP_URL;
  if (!appUrl) {
    logError(
      "paypal-prepaid checkout: NEXT_PUBLIC_APP_URL not configured",
      new Error("config-missing"),
      { tag: "paypal-prepaid" },
    );
    return NextResponse.json(
      { success: false, error: "Server misconfigured" },
      { status: 500 },
    );
  }

  // ── custom_id (FROZEN grant context for the 2b capture step) ──────────────
  // The capture/webhook step (2b) re-derives ownership + the charged rate from
  // this string — it MUST carry everything grant_prepaid_hours needs to be
  // idempotent:
  //   product_type=prepaid_hours, student_id, hours, and the FROZEN rate.
  // PayPal custom_id is capped at 127 chars; `prepaid_hours:<uuid>:<hours>:<rate>`
  // fits well inside (36-char UUID + ~10 overhead). `rate` is toFixed(2) so a
  // mid-flight admin rate change cannot desync the charged amount from the
  // granted lot's rate_paid_usd (R1).
  const customId = `prepaid_hours:${studentId}:${body.hours}:${rateUsd.toFixed(2)}`;
  if (customId.length > 127) {
    logError(
      "paypal-prepaid checkout: custom_id exceeds 127 chars",
      new Error("custom_id-too-long"),
      { tag: "paypal-prepaid", student_id: studentId, custom_id_length: customId.length },
    );
    return NextResponse.json(
      { success: false, error: "Server misconfigured" },
      { status: 500 },
    );
  }

  const description = `Prepaid hour wallet — ${body.hours} × 60-min 1:1 session${body.hours === 1 ? "" : "s"}`;

  try {
    const order = await createPayPalOrder({
      amountUsd,
      referenceId: studentId,
      customId,
      description,
      returnUrl: `${appUrl}/api/paypal/checkout/prepaid-hours/return`,
      cancelUrl: `${appUrl}/student/dashboard?prepaid_hours=cancelled`,
    });

    logInfo("paypal-prepaid checkout: order created", {
      tag: "paypal-prepaid",
      student_id: studentId,
      hours: body.hours,
      rate_usd: rateUsd,
      amount_usd: amountUsd,
      order_id: order.orderId,
    });

    return NextResponse.json({
      success: true,
      data: { orderId: order.orderId, approveUrl: order.approveUrl },
    });
  } catch (err) {
    logError("paypal-prepaid checkout: createPayPalOrder failed", err, {
      tag: "paypal-prepaid",
      student_id: studentId,
      hours: body.hours,
    });
    return NextResponse.json(
      { success: false, error: "Checkout creation failed" },
      { status: 500 },
    );
  }
}
