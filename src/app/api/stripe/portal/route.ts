import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getStripe } from "@/lib/stripe/client";
import { requireRole } from "@/lib/auth/require-admin";
import { UnauthenticatedError, ForbiddenError } from "@/lib/auth/errors";
import { logError } from "@/lib/logger";

export const maxDuration = 60;

/**
 * POST /api/stripe/portal — Customer Portal session (spec 018 US4).
 *
 * Scoped strictly to the requester's own stripe_customer_id (SC-007) — never
 * another user's. Identity from the session only (FR-011). Cancellations /
 * payment-method changes made in the portal flow back via
 * `customer.subscription.updated/deleted` webhooks, NOT handled here.
 * See contracts/portal.contract.md.
 */
export async function POST() {
  // ── Auth gate (Principle IV) ──────────────────────────────────────────────
  let userId: string;
  try {
    ({ id: userId } = await requireRole(["student", "admin"]));
  } catch (e) {
    if (e instanceof UnauthenticatedError) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    if (e instanceof ForbiddenError) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
    throw e;
  }

  const appUrl = process.env.NEXT_PUBLIC_APP_URL;
  if (!appUrl) {
    logError("portal: NEXT_PUBLIC_APP_URL not configured", new Error("config-missing"), {
      tag: "billing",
    });
    return NextResponse.json({ error: "Server misconfigured" }, { status: 500 });
  }

  // ── Look up the requester's own stripe_customers row ──────────────────────
  // Read with the user client (RLS scopes to user_id = auth.uid()); never
  // trust a customer id from request input.
  const userClient = await createClient();
  const { data: mapping, error: readErr } = await userClient
    .from("stripe_customers")
    .select("stripe_customer_id")
    .eq("user_id", userId)
    .maybeSingle();

  if (readErr) {
    logError("portal: stripe_customers read failed", readErr, { tag: "billing", user_id: userId });
    return NextResponse.json({ error: "Failed to read customer" }, { status: 500 });
  }
  if (!mapping?.stripe_customer_id) {
    // No billing relationship yet.
    return NextResponse.json({ error: "No billing account found" }, { status: 404 });
  }

  // ── Create the portal session scoped to that customer ────────────────────
  try {
    const session = await getStripe().billingPortal.sessions.create({
      customer: mapping.stripe_customer_id,
      return_url: `${appUrl}/student/dashboard`,
    });
    return NextResponse.json({ url: session.url });
  } catch (err) {
    logError("portal: billingPortal.sessions.create failed", err, {
      tag: "billing", user_id: userId, stripe_customer_id: mapping.stripe_customer_id,
    });
    return NextResponse.json({ error: "Portal session creation failed" }, { status: 500 });
  }
}
