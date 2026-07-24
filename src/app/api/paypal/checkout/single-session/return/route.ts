import { NextResponse } from "next/server";
import { z } from "zod";
import { requireRole } from "@/lib/auth/require-admin";
import { ForbiddenError, UnauthenticatedError } from "@/lib/auth/errors";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  capturePayPalOrder,
  getPayPalOrder,
  isPayPalConfigured,
} from "@/lib/paypal/client";
import { grantPaypalSingleSessionCapture } from "@/lib/paypal/grant";
import { isFeatureEnabled } from "@/lib/settings";
import { logError } from "@/lib/logger";

export const maxDuration = 60;

const ReturnQuerySchema = z.object({
  token: z.string().trim().min(1).max(200),
});

function dashboardRedirect(flag: string): NextResponse {
  const appUrl =
    process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";
  return NextResponse.redirect(
    new URL(`/student/dashboard?single_session=${flag}`, appUrl),
    { status: 303 },
  );
}

async function captureOrRecover(orderId: string) {
  try {
    return await capturePayPalOrder(orderId);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (
      !message.includes("ORDER_ALREADY_CAPTURED") &&
      !message.includes("422")
    ) {
      throw error;
    }
    const order = await getPayPalOrder(orderId);
    if (!order.captureId) return null;
    return {
      captureId: order.captureId,
      amountUsd: order.amountUsd ?? 0,
      customId: order.customId,
      status: order.status,
    };
  }
}

export async function GET(request: Request) {
  if (!(await isFeatureEnabled("paypal_purchase_enabled"))) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  const query = ReturnQuerySchema.safeParse({
    token: new URL(request.url).searchParams.get("token"),
  });
  if (!query.success) return dashboardRedirect("paypal_error");

  try {
    await requireRole("student");
  } catch (error) {
    if (error instanceof UnauthenticatedError) {
      const appUrl =
        process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";
      return NextResponse.redirect(new URL("/login", appUrl), {
        status: 303,
      });
    }
    if (error instanceof ForbiddenError) {
      return dashboardRedirect("paypal_error");
    }
    throw error;
  }

  if (!isPayPalConfigured()) {
    return dashboardRedirect("paypal_error");
  }

  let capture: Awaited<ReturnType<typeof captureOrRecover>>;
  try {
    capture = await captureOrRecover(query.data.token);
  } catch (error) {
    logError("paypal-single-session return: capture failed", error, {
      tag: "paypal-single-session",
      order_id: query.data.token,
    });
    return dashboardRedirect("paypal_error");
  }
  if (!capture || capture.status !== "COMPLETED") {
    return dashboardRedirect("paypal_pending");
  }

  const grant = await grantPaypalSingleSessionCapture(createAdminClient(), {
    captureId: capture.captureId,
    amountUsd: capture.amountUsd,
    customId: capture.customId,
    orderId: query.data.token,
  });
  if (grant.ok) return dashboardRedirect("paypal_success");

  logError(
    "paypal-single-session return: grant failed",
    new Error(grant.reason),
    {
      tag: "paypal-single-session",
      order_id: query.data.token,
      capture_id: capture.captureId,
      reason: grant.reason,
    },
  );
  return dashboardRedirect("paypal_failed");
}
