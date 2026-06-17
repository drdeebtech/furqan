import { NextResponse } from "next/server";
import { z } from "zod";
import { requireRole } from "@/lib/auth/require-admin";
import { UnauthenticatedError, ForbiddenError } from "@/lib/auth/errors";
import { createAdminClient } from "@/lib/supabase/admin";
import { getStripe } from "@/lib/stripe/client";
import { canUpgradeImmediately, scheduleRenewalChange } from "@/lib/domains/catalog/tier-changes";
import { grantHifzCycleCredits } from "@/lib/domains/catalog/credit-grant";
import { logError, logInfo } from "@/lib/logger";

export const maxDuration = 60;

const Body = z.object({
  subscriptionId: z.uuid(),
  toPackageId: z.uuid(),
});

/**
 * POST /api/subscriptions/upgrade-tier — Spec 019 US5 T022.
 *
 * Immediate upgrade (same product_category, sessions increasing):
 *   - stripe.subscriptions.update with proration_behavior:'always_invoice'
 *   - grantHifzCycleCredits for delta sessions with 'upgrade_'+invoice.id key
 *
 * Deferred (type mismatch or not an upgrade):
 *   - scheduleRenewalChange inserts pending_tier_changes
 *
 * Auth: student role only. Subscription ownership verified by student_id = userId.
 */
export async function POST(request: Request) {
  let userId: string;
  try {
    ({ id: userId } = await requireRole("student"));
  } catch (e) {
    if (e instanceof UnauthenticatedError) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    if (e instanceof ForbiddenError) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
    throw e;
  }

  let parsed: z.infer<typeof Body>;
  try {
    parsed = Body.parse(await request.json());
  } catch {
    return NextResponse.json(
      { error: "Invalid body: { subscriptionId, toPackageId } required" },
      { status: 400 },
    );
  }

  const admin = createAdminClient();

  // ── Resolve current subscription (ownership check) ─────────────────────────
  const { data: sub, error: subErr } = await admin
    .from("subscriptions")
    .select("id, stripe_subscription_id, plan_id, student_id, current_period_end")
    .eq("id", parsed.subscriptionId)
    .eq("student_id", userId)
    .not("status", "in", "(canceled,incomplete_expired)")
    .maybeSingle();

  if (subErr || !sub) {
    return NextResponse.json({ error: "Subscription not found" }, { status: 404 });
  }

  if (!sub.stripe_subscription_id) {
    return NextResponse.json({ error: "Subscription has no Stripe link" }, { status: 422 });
  }

  // ── Resolve current package + plan ─────────────────────────────────────────
  const [currentPkgRes, currentPlanRes] = await Promise.all([
    admin
      .from("packages")
      .select("id, product_category")
      .eq("subscription_plan_id", sub.plan_id)
      .eq("is_hifz_product", true)
      .maybeSingle(),
    admin
      .from("subscription_plans")
      .select("id, sessions_per_month, stripe_price_id")
      .eq("id", sub.plan_id)
      .maybeSingle(),
  ]);

  if (currentPkgRes.error || currentPlanRes.error) {
    logError("upgrade-tier: current plan lookup failed", currentPkgRes.error ?? currentPlanRes.error, {
      tag: "billing",
      subscription_id: parsed.subscriptionId,
    });
    return NextResponse.json({ error: "Failed to load current plan" }, { status: 500 });
  }
  const currentPkg = currentPkgRes.data;
  const currentPlan = currentPlanRes.data;

  if (!currentPkg || !currentPlan) {
    return NextResponse.json({ error: "Current plan not found" }, { status: 422 });
  }

  // ── Resolve new package + plan ─────────────────────────────────────────────
  const { data: newPkg, error: newPkgErr } = await admin
    .from("packages")
    .select("id, product_category, subscription_plan_id")
    .eq("id", parsed.toPackageId)
    .eq("is_hifz_product", true)
    .maybeSingle();

  if (newPkgErr || !newPkg?.subscription_plan_id) {
    return NextResponse.json({ error: "Target package not found" }, { status: 404 });
  }

  if (newPkg.id === currentPkg.id) {
    return NextResponse.json({ error: "Already on this tier" }, { status: 422 });
  }

  const { data: newPlan, error: newPlanErr } = await admin
    .from("subscription_plans")
    .select("id, sessions_per_month, stripe_price_id")
    .eq("id", newPkg.subscription_plan_id)
    .maybeSingle();

  if (newPlanErr || !newPlan) {
    return NextResponse.json({ error: "Target plan not found" }, { status: 404 });
  }

  // ── Eligibility check ──────────────────────────────────────────────────────
  if (!currentPkg.product_category || currentPlan.sessions_per_month == null) {
    return NextResponse.json({ error: "Current plan missing required tier data" }, { status: 422 });
  }
  if (!newPkg.product_category || newPlan.sessions_per_month == null) {
    return NextResponse.json({ error: "Target plan missing required tier data" }, { status: 422 });
  }

  if (!sub.current_period_end) {
    return NextResponse.json({ error: "Current subscription missing period end date" }, { status: 422 });
  }

  const eligibility = canUpgradeImmediately(
    {
      subscriptionId: sub.id,
      stripeSubscriptionId: sub.stripe_subscription_id,
      planId: sub.plan_id,
      packageId: currentPkg.id,
      productCategory: currentPkg.product_category,
      sessionsPerMonth: currentPlan.sessions_per_month,
      currentPeriodEnd: sub.current_period_end,
    },
    {
      packageId: parsed.toPackageId,
      planId: newPlan.id,
      productCategory: newPkg.product_category,
      sessionsPerMonth: newPlan.sessions_per_month,
    },
  );

  if (!eligibility.allowed) {
    const changeReason =
      eligibility.reason === "type_mismatch"
        ? ("type_change" as const)
        : ("downgrade" as const);

    const scheduled = await scheduleRenewalChange(admin, {
      subscriptionId: sub.id,
      studentId: userId,
      fromPackageId: currentPkg.id,
      toPackageId: parsed.toPackageId,
      changeReason,
    });

    if (!scheduled) {
      return NextResponse.json({ error: "Failed to schedule tier change" }, { status: 500 });
    }

    return NextResponse.json({ result: "scheduled", pendingId: scheduled.id });
  }

  // ── Immediate upgrade via Stripe proration ─────────────────────────────────
  if (!newPlan.stripe_price_id) {
    return NextResponse.json({ error: "Target plan has no Stripe price" }, { status: 422 });
  }

  const stripe = getStripe();

  let invoiceId: string;
  try {
    // Expand items in retrieve; expand latest_invoice in update so we read the
    // proration invoice that was just created (the separate list endpoint is
    // eventually consistent and can return the pre-upgrade invoice).
    const stripeSub = await stripe.subscriptions.retrieve(sub.stripe_subscription_id, {
      expand: ["items"],
    });
    const itemId = stripeSub.items.data[0]?.id;
    if (!itemId) throw new Error("subscription has no items");

    const updatedSub = await stripe.subscriptions.update(sub.stripe_subscription_id, {
      items: [{ id: itemId, price: newPlan.stripe_price_id }],
      proration_behavior: "always_invoice",
      expand: ["latest_invoice"],
    });

    const latestInvoice = updatedSub.latest_invoice;
    invoiceId =
      latestInvoice && typeof latestInvoice === "object" && "id" in latestInvoice
        ? (latestInvoice as { id: string }).id
        : `${sub.id}-${newPlan.id}`;
  } catch (err) {
    logError("upgrade-tier: Stripe update failed", err, {
      tag: "billing",
      subscription_id: sub.id,
    });
    return NextResponse.json({ error: "Stripe upgrade failed" }, { status: 502 });
  }

  // ── Sync local plan_id immediately (don't wait for webhook) ──────────────────
  // The webhook will also update this via upsertMirror, but the local row would
  // show the old plan_id until delivery (seconds–minutes), allowing a second
  // "upgrade" from an already-upgraded tier in that window (HIGH fix).
  const { error: syncErr } = await admin
    .from("subscriptions")
    .update({ plan_id: newPlan.id })
    .eq("id", sub.id);

  if (syncErr) {
    logError("upgrade-tier: local plan sync failed after Stripe update", syncErr, {
      tag: "billing",
      subscription_id: sub.id,
      new_plan_id: newPlan.id,
    });
    return NextResponse.json(
      { error: "Upgrade applied in Stripe but local sync failed — contact support" },
      { status: 500 },
    );
  }

  // ── Grant delta credits for the remainder of this cycle ────────────────────
  const billingCycleKey = `upgrade_${invoiceId}`;
  const grantResult = await grantHifzCycleCredits(admin, sub.id, newPlan.id, billingCycleKey, eligibility.deltaSessions);

  if (!grantResult.ok) {
    logError("upgrade-tier: delta credit grant failed", new Error(grantResult.error), {
      tag: "billing",
      subscription_id: sub.id,
      invoice_id: invoiceId,
    });
    return NextResponse.json(
      { error: "Upgrade applied in Stripe but credit grant failed — contact support" },
      { status: 500 },
    );
  }

  logInfo("upgrade-tier: immediate upgrade applied", {
    tag: "billing",
    subscription_id: sub.id,
    new_plan_id: newPlan.id,
    delta_sessions: eligibility.deltaSessions,
  });

  return NextResponse.json({
    result: "upgraded",
    newPlanId: newPlan.id,
    deltaSessions: eligibility.deltaSessions,
  });
}
