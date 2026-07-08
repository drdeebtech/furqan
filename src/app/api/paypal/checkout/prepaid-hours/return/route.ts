import { NextResponse } from "next/server";
import {
  capturePayPalOrder,
  getPayPalOrder,
  isPayPalConfigured,
} from "@/lib/paypal/client";
import { grantPaypalPrepaidCapture } from "@/lib/paypal/grant";
import { requireRole } from "@/lib/auth/require-admin";
import { UnauthenticatedError, ForbiddenError } from "@/lib/auth/errors";
import { createAdminClient } from "@/lib/supabase/admin";
import { logError } from "@/lib/logger";
import { isFeatureEnabled } from "@/lib/settings";

export const maxDuration = 60;

/**
 * GET /api/paypal/checkout/prepaid-hours/return
 *
 * PayPal redirects the buyer here after they approve the order. This is the
 * UX-fast capture+grant path — the webhook (POST /api/paypal/webhook) is the
 * source of truth and runs independently; this route just makes the buyer's
 * browser reflect the grant immediately instead of waiting for the webhook.
 *
 * Flow (fail-closed at every gate):
 *   1. feature flag off → 404 (surface invisible)
 *   2. read `token` (PayPal's order id) from query — missing → redirect error
 *   3. requireRole('student') — unauthed → /login, forbidden → dashboard error
 *   4. capturePayPalOrder(orderId):
 *        - throws ORDER_ALREADY_CAPTURED / 422 → fall back to getPayPalOrder
 *          to recover the existing capture id (idempotent re-entry)
 *        - otherwise use the capture result
 *   5. status !== COMPLETED (and not recoverable) → redirect pending
 *   6. grantPaypalPrepaidCapture (tamper guard + ownership + idempotent rpc):
 *        - ok → redirect /student/dashboard?prepaid_hours=paypal_success
 *        - !ok → logError + redirect ?prepaid_hours=paypal_failed
 *
 * The webhook remains authoritative — if this route fails, the webhook will
 * still grant (or has already granted). A successful grant here is a no-op for
 * the webhook (captureId is the idempotency key).
 */

/** Build the dashboard redirect URL with the prepaid_hours status flag. */
function dashboardRedirect(flag: string): NextResponse {
  return NextResponse.redirect(
    new URL(`/student/dashboard?prepaid_hours=${flag}`, process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000"),
    { status: 303 },
  );
}

export async function GET(request: Request) {
  // 1. Feature flag — default OFF; 404 so the surface is invisible.
  const enabled = await isFeatureEnabled("paypal_purchase_enabled");
  if (!enabled) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  // 2. Read the PayPal order id from the `token` query param.
  const { searchParams } = new URL(request.url);
  const orderId = searchParams.get("token");
  if (!orderId) {
    return dashboardRedirect("paypal_error");
  }

  // 3. Auth gate — the returning buyer is logged in.
  try {
    await requireRole("student");
  } catch (e) {
    if (e instanceof UnauthenticatedError) {
      return NextResponse.redirect(
        new URL("/login", process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000"),
        { status: 303 },
      );
    }
    if (e instanceof ForbiddenError) {
      return dashboardRedirect("paypal_error");
    }
    throw e;
  }

  // 4. PayPal config gate (mirrors the checkout route's 500).
  if (!isPayPalConfigured()) {
    logError(
      "paypal-prepaid return: PayPal not configured",
      new Error("no-paypal-credentials"),
      { tag: "paypal-prepaid", order_id: orderId },
    );
    return dashboardRedirect("paypal_error");
  }

  // 5. Capture (or recover an already-captured order).
  let captureId: string;
  let amountUsd: number;
  let customId: string | null;
  let status: string;

  try {
    try {
      const captured = await capturePayPalOrder(orderId);
      captureId = captured.captureId;
      amountUsd = captured.amountUsd;
      customId = captured.customId;
      status = captured.status;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      // ORDER_ALREADY_CAPTURED (PayPal returns 422 UNPROCESSABLE_ENTITY with
      // this name) means the webhook (or a prior return-route hit) already
      // captured. Fall back to an idempotent GET to recover the capture id.
      const alreadyCaptured =
        msg.includes("ORDER_ALREADY_CAPTURED") ||
        msg.includes("422");
      if (!alreadyCaptured) throw err;

      const order = await getPayPalOrder(orderId);
      if (!order.captureId) {
        // Captured-but-no-capture-id is an inconsistent PayPal state; treat as
        // pending (the webhook will reconcile).
        return dashboardRedirect("paypal_pending");
      }
      captureId = order.captureId;
      // If the GET couldn't recover the amount, coerce to 0 — the tamper guard
      // in grantPaypalPrepaidCapture will fail-close (0 ≠ hours×rate).
      amountUsd = order.amountUsd ?? 0;
      customId = order.customId;
      status = order.status;
    }
  } catch (err) {
    logError("paypal-prepaid return: capture failed", err, {
      tag: "paypal-prepaid",
      order_id: orderId,
    });
    return dashboardRedirect("paypal_error");
  }

  // 6. Not yet completed (async method / pending) → let the webhook finish it.
  if (status !== "COMPLETED") {
    return dashboardRedirect("paypal_pending");
  }

  // 7. Grant (tamper guard + ownership + idempotent rpc).
  const admin = createAdminClient();
  const result = await grantPaypalPrepaidCapture(admin, {
    captureId,
    amountUsd,
    customId,
    orderId,
  });

  if (result.ok) {
    return dashboardRedirect("paypal_success");
  }

  logError(
    "paypal-prepaid return: grant failed",
    new Error(result.reason),
    {
      tag: "paypal-prepaid",
      order_id: orderId,
      capture_id: captureId,
      reason: result.reason,
    },
  );
  return dashboardRedirect("paypal_failed");
}
