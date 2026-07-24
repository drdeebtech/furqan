import { NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { createPayPalSubscription, isPayPalConfigured } from "@/lib/paypal/client";
import { buildSubscriptionCustomId } from "@/lib/paypal/subscription-custom-id";
import { getActivePlanByCode } from "@/lib/domains/billing";
import { isFeatureEnabled } from "@/lib/settings";
import { requireRole } from "@/lib/auth/require-admin";
import { checkRateLimit } from "@/lib/security/rate-limit";
import { UnauthenticatedError, ForbiddenError } from "@/lib/auth/errors";
import {
  assertNoActiveHifz,
  HifzAlreadyActiveError,
  isPlanHifzProduct,
} from "@/lib/actions/subscriptions/create-hifz-subscription";
import { logError, logInfo } from "@/lib/logger";
import { getPostHogClient } from "@/lib/posthog-server";
import {
  PAYMENTS_UNAVAILABLE_MESSAGE,
  PAYMENTS_UNAVAILABLE_STATUS,
} from "@/lib/payments/provider-unavailable";

export const maxDuration = 60;

const Body = z.object({
  planCode: z.string().min(1).max(120),
});

/**
 * POST /api/paypal/checkout/subscription — recurring-subscription checkout
 * (spec 039 / #762), the PayPal-provider twin of POST /api/stripe/checkout.
 *
 * Identity is session-only (FR-010); the plan id, price, and grant size all
 * come from the catalog, never the client. NO DB row is written here — the
 * grant is webhook-driven (BILLING.SUBSCRIPTION.ACTIVATED → grant_subscription_cycle,
 * shipped separately in Phase 6 / #763). This route only mints the PayPal
 * approval link the student is redirected to.
 *
 * Gated twice: the `paypal_subscription_enabled` flag (a flagged-off provider
 * must be unreachable, → 404) AND `isPayPalConfigured()` (PAYPAL_* env present,
 * → 503 "payments unavailable"). The provider button on /subscribe renders only
 * when BOTH are true, but the route re-checks both — never trust the UI.
 */
export async function POST(request: Request) {
  // ── Feature-flag gate (defense in depth: a flagged-off provider is 404) ────
  if (!(await isFeatureEnabled("paypal_subscription_enabled"))) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  // ── Auth gate (Principle IV) ──────────────────────────────────────────────
  let userId: string;
  try {
    ({ id: userId } = await requireRole("student"));
  } catch (e) {
    if (e instanceof UnauthenticatedError) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    if (e instanceof ForbiddenError) {
      return NextResponse.json({ error: "Only students may initiate checkout" }, { status: 403 });
    }
    throw e;
  }

  // Per-user rate limit — cap subscription-creation so a script cannot spam
  // PayPal object creation. Distinct bucket from Stripe so a student who tries
  // one provider is not throttled on the other. Fail-open (a limiter outage
  // must never block a real purchase).
  if (!(await checkRateLimit(userId, "checkout-subscription-paypal", 20))) {
    return NextResponse.json(
      { error: "Too many checkout attempts — please wait a moment and try again." },
      { status: 429 },
    );
  }

  // ── Validate body ─────────────────────────────────────────────────────────
  let parsed: z.infer<typeof Body>;
  try {
    parsed = Body.parse(await request.json());
  } catch {
    return NextResponse.json({ error: "Invalid body: { planCode: string } required" }, { status: 400 });
  }

  // ── Payment-provider configuration gate ───────────────────────────────────
  // PAYPAL_* env missing → clean 503, before any DB work (mirrors the Stripe
  // route and the sibling PayPal checkout routes).
  if (!isPayPalConfigured()) {
    logError("paypal-subscription checkout: PayPal not configured", new Error("no-paypal-config"), {
      tag: "billing",
      user_id: userId,
    });
    return NextResponse.json(
      { error: PAYMENTS_UNAVAILABLE_MESSAGE },
      { status: PAYMENTS_UNAVAILABLE_STATUS },
    );
  }

  const appUrl = process.env.NEXT_PUBLIC_APP_URL;
  if (!appUrl) {
    logError("paypal-subscription checkout: NEXT_PUBLIC_APP_URL not configured", new Error("config-missing"), {
      tag: "billing",
    });
    return NextResponse.json({ error: "Server misconfigured" }, { status: 500 });
  }

  const userClient = await createClient();

  // ── Resolve plan from catalog (plan id / price server-side) ───────────────
  const plan = await getActivePlanByCode(userClient, parsed.planCode);
  if (!plan) {
    return NextResponse.json({ error: "Unknown or inactive plan" }, { status: 400 });
  }
  if (plan.currency !== "usd") {
    // FR-008: USD only. The catalog CHECK enforces this; defend in depth.
    return NextResponse.json({ error: "Non-USD plan" }, { status: 400 });
  }

  // ── PayPal plan id must be populated (bootstrap #761 run against live) ─────
  // Until the bootstrap runs, `paypal_plan_id` is NULL. Subscribing against an
  // empty plan id would 400 at PayPal — surface the standard "payments
  // unavailable" instead, exactly as an unconfigured provider does.
  if (!plan.paypalPlanId) {
    logError("paypal-subscription checkout: plan has no paypal_plan_id", new Error("no-paypal-plan-id"), {
      tag: "billing",
      user_id: userId,
      plan_code: plan.planCode,
    });
    return NextResponse.json(
      { error: PAYMENTS_UNAVAILABLE_MESSAGE },
      { status: PAYMENTS_UNAVAILABLE_STATUS },
    );
  }

  const admin = createAdminClient();

  // ── Single-active-hifz guard (spec 019 US2 / FR-007) ──────────────────────
  // A student may hold at most one active hifz subscription. Check BEFORE the
  // PayPal call so we don't create a subscription the student can't use. The
  // Stripe route enforces the same guard, so AC8 holds on both providers.
  try {
    if (await isPlanHifzProduct(admin, plan.id)) {
      await assertNoActiveHifz(admin, userId);
    }
  } catch (e) {
    if (e instanceof HifzAlreadyActiveError) {
      return NextResponse.json({ error: e.message }, { status: 409 });
    }
    throw e;
  }

  // ── Stamp the grant context into custom_id (parsed by the Phase 6 webhook) ─
  let customId: string;
  try {
    customId = buildSubscriptionCustomId({
      productType: "subscription",
      studentId: userId,
      planCode: plan.planCode,
    });
  } catch (e) {
    logError("paypal-subscription checkout: custom_id build failed", e, {
      tag: "billing",
      user_id: userId,
      plan_code: plan.planCode,
    });
    return NextResponse.json(
      { error: "Selected plan details are too long for PayPal checkout" },
      { status: 422 },
    );
  }

  // ── Create the PayPal subscription (returns the approval link) ────────────
  try {
    const subscription = await createPayPalSubscription({
      planId: plan.paypalPlanId,
      customId,
      // Idempotency (mirrors the Stripe route): a double-click / retry within
      // the same ~10-min bucket reuses the SAME PayPal-Request-Id, so PayPal
      // returns the first pending subscription instead of minting a second.
      requestId: `paypal-sub:${userId}:${plan.planCode}:${Math.floor(Date.now() / 600_000)}`,
      returnUrl: `${appUrl}/student/dashboard?subscription=success`,
      cancelUrl: `${appUrl}/student/dashboard?subscription=cancelled`,
    });

    logInfo("paypal-subscription checkout: subscription created", {
      tag: "billing",
      user_id: userId,
      plan_code: plan.planCode,
      subscription_id: subscription.subscriptionId,
    });

    getPostHogClient()?.capture({
      distinctId: userId,
      event: "checkout_initiated",
      properties: {
        plan_code: plan.planCode,
        currency: plan.currency,
        provider: "paypal",
      },
    });

    // Match the Stripe route's `{ url }` shape so the subscribe client handler
    // stays provider-uniform.
    return NextResponse.json({ url: subscription.approveUrl });
  } catch (err) {
    logError("paypal-subscription checkout: createPayPalSubscription failed", err, {
      tag: "billing",
      user_id: userId,
      plan_code: plan.planCode,
    });
    return NextResponse.json({ error: "Checkout creation failed" }, { status: 500 });
  }
}
