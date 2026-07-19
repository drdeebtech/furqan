import { NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getStripe } from "@/lib/stripe/client";
import { getActivePlanByCode } from "@/lib/domains/billing";
import { requireRole } from "@/lib/auth/require-admin";
import { UnauthenticatedError, ForbiddenError } from "@/lib/auth/errors";
import { assertNoActiveHifz, HifzAlreadyActiveError, isPlanHifzProduct, resolveStudentFamilyDiscount } from "@/lib/actions/subscriptions/create-hifz-subscription";
import { logError } from "@/lib/logger";
import { getPostHogClient } from "@/lib/posthog-server";

export const maxDuration = 60;

const Body = z.object({
  planCode: z.string().min(1).max(120),
});

/**
 * POST /api/stripe/checkout — subscription-mode Checkout (spec 018 US1).
 *
 * Identity from the session only (FR-010); price/credit come from the catalog,
 * never the client. No grant happens here — the grant is webhook-driven (the
 * webhook may even precede the redirect). See contracts/checkout.contract.md.
 */
export async function POST(request: Request) {
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

  // ── Validate body ─────────────────────────────────────────────────────────
  let parsed: z.infer<typeof Body>;
  try {
    parsed = Body.parse(await request.json());
  } catch {
    return NextResponse.json({ error: "Invalid body: { planCode: string } required" }, { status: 400 });
  }

  const appUrl = process.env.NEXT_PUBLIC_APP_URL;
  if (!appUrl) {
    logError("checkout: NEXT_PUBLIC_APP_URL not configured", new Error("config-missing"), {
      tag: "billing",
    });
    return NextResponse.json({ error: "Server misconfigured" }, { status: 500 });
  }

  const userClient = await createClient();

  // ── Resolve plan from catalog (price/credits server-side) ─────────────────
  const plan = await getActivePlanByCode(userClient, parsed.planCode);
  if (!plan) {
    return NextResponse.json({ error: "Unknown or inactive plan" }, { status: 400 });
  }
  if (plan.currency !== "usd") {
    // FR-008: USD only. The catalog CHECK enforces this, but defend in depth.
    return NextResponse.json({ error: "Non-USD plan" }, { status: 400 });
  }

  const stripe = getStripe();
  const admin = createAdminClient();

  // Idempotency window (R6): a double-click / retry within the same ~10-min
  // bucket reuses the SAME Stripe key → Stripe returns the first Checkout
  // Session instead of creating a second one, so the student is never
  // double-charged. The coupon below shares this bucket so an idempotent
  // replay sends identical params (a fresh coupon id would break the key).
  const idemBucket = Math.floor(Date.now() / 600_000);

  // ── Single-active-hifz guard (spec 019 US2 / FR-007) ──────────────────────
  // A student may hold at most one active hifz subscription. Check BEFORE the
  // Stripe call so we don't waste a checkout session the user can't complete.
  // The DB partial unique index is the concurrency backstop (FR-009).
  try {
    const hifzProduct = await isPlanHifzProduct(admin, plan.id);
    if (hifzProduct) {
      await assertNoActiveHifz(admin, userId);
    }
  } catch (e) {
    if (e instanceof HifzAlreadyActiveError) {
      return NextResponse.json({ error: e.message }, { status: 409 });
    }
    throw e;
  }

  // ── Guardian family discount (spec 019 US4) ──────────────────────────────
  let stripeCouponId: string | undefined;
  {
    const { data: pkg, error: pkgErr } = await admin
      .from("packages")
      .select("product_category")
      .eq("subscription_plan_id", plan.id)
      .eq("is_hifz_product", true)
      .maybeSingle();
    if (pkgErr) {
      logError("checkout: package category lookup failed", pkgErr, {
        tag: "billing",
        user_id: userId,
        plan_id: plan.id,
      });
    }
    const productCategory = pkg?.product_category ?? null;

    if (productCategory) {
      const discountRes = await resolveStudentFamilyDiscount(admin, userId, productCategory);
      if (discountRes.applies) {
        try {
          const coupon = await stripe.coupons.create(
            {
              percent_off: discountRes.discountPct,
              duration: "once",
              metadata: {
                discount_type: discountRes.discountType,
                setting_key: discountRes.settingKey,
              },
            },
            { idempotencyKey: `coupon:${userId}:${discountRes.discountType}:${idemBucket}` },
          );
          stripeCouponId = coupon.id;
        } catch (err) {
          logError("checkout: guardian discount coupon creation failed", err, {
            tag: "billing",
            user_id: userId,
          });
          // Non-fatal: proceed without discount rather than blocking checkout
        }
      }
    }
  }

  // ── Email for the Stripe customer record (best-effort) ────────────────────
  let email: string | undefined;
  try {
    const { data } = await userClient.auth.getUser();
    email = data.user?.email ?? undefined;
  } catch {
    email = undefined;
  }

  // ── Resolve/create stripe_customers mapping (race-safe, R6) ───────────────
  const stripeCustomerId = await ensureStripeCustomer(admin, stripe, userId, email);
  if (!stripeCustomerId.ok) {
    return NextResponse.json({ error: "Failed to resolve customer" }, { status: 500 });
  }

  // ── Create subscription-mode Checkout Session ────────────────────────────
  try {
    const session = await stripe.checkout.sessions.create({
      mode: "subscription",
      customer: stripeCustomerId.value,
      line_items: [{ price: plan.stripePriceId, quantity: 1 }],
      ...(stripeCouponId ? { discounts: [{ coupon: stripeCouponId }] } : {}),
      client_reference_id: userId,
      metadata: { student_id: userId, plan_code: plan.planCode },
      subscription_data: { metadata: { student_id: userId, plan_code: plan.planCode } },
      success_url: `${appUrl}/student/dashboard?subscription=success`,
      cancel_url: `${appUrl}/student/dashboard?subscription=cancelled`,
    }, { idempotencyKey: `sub-checkout:${userId}:${plan.planCode}:${idemBucket}` });

    if (!session.url) {
      logError("checkout: Stripe returned no url", new Error("no url"), {
        tag: "billing", user_id: userId, plan_code: plan.planCode,
      });
      return NextResponse.json({ error: "Checkout session has no url" }, { status: 502 });
    }

    getPostHogClient()?.capture({
      distinctId: userId,
      event: "checkout_initiated",
      properties: {
        plan_code: plan.planCode,
        currency: plan.currency,
        has_discount: !!stripeCouponId,
      },
    });

    return NextResponse.json({ url: session.url });
  } catch (err) {
    logError("checkout: stripe.checkout.sessions.create failed", err, {
      tag: "billing", user_id: userId, plan_code: plan.planCode,
    });
    return NextResponse.json({ error: "Checkout creation failed" }, { status: 500 });
  }
}

/**
 * Get-or-create the stripe_customers mapping for a user. Race-safe: the dual
 * UNIQUE (user_id, stripe_customer_id) is the concurrency backstop (R6). On a
 * concurrent-insert conflict we re-read the winner rather than surfacing an
 * error to the user.
 */
async function ensureStripeCustomer(
  admin: ReturnType<typeof createAdminClient>,
  stripe: ReturnType<typeof getStripe>,
  userId: string,
  email: string | undefined,
): Promise<{ ok: true; value: string } | { ok: false }> {
  // Fast path: existing mapping.
  const { data: existing } = await admin
    .from("stripe_customers")
    .select("stripe_customer_id")
    .eq("user_id", userId)
    .maybeSingle();
  if (existing?.stripe_customer_id) {
    return { ok: true, value: existing.stripe_customer_id };
  }

  // Create the Stripe customer.
  const customer = await stripe.customers.create({
    metadata: { user_id: userId },
    ...(email ? { email } : {}),
  });

  // Insert mapping; ON CONFLICT handles the concurrent-create race (R6).
  const { data: inserted, error } = await admin
    .from("stripe_customers")
    .insert({ user_id: userId, stripe_customer_id: customer.id })
    .select("stripe_customer_id")
    .maybeSingle();

  if (!error) {
    return { ok: true, value: inserted?.stripe_customer_id ?? customer.id };
  }
  if (error.code === "23505") {
    // Lost the race — re-read the winner.
    const { data: winner } = await admin
      .from("stripe_customers")
      .select("stripe_customer_id")
      .eq("user_id", userId)
      .maybeSingle();
    if (winner?.stripe_customer_id) {
      return { ok: true, value: winner.stripe_customer_id };
    }
  }
  logError("ensureStripeCustomer insert failed", error, { tag: "billing", user_id: userId });
  return { ok: false };
}
