import { NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { getStripe, isStripeConfigured } from "@/lib/stripe/client";
import { requireRole } from "@/lib/auth/require-admin";
import { checkRateLimit } from "@/lib/security/rate-limit";
import { UnauthenticatedError, ForbiddenError } from "@/lib/auth/errors";
import { logError, logInfo } from "@/lib/logger";
import { isFeatureEnabled } from "@/lib/settings";
import {
  resolvePrepaidQuote,
  PrepaidHoursOutOfRangeError,
} from "@/lib/domains/billing/prepaid-quote";
import {
  PAYMENTS_UNAVAILABLE_MESSAGE,
  PAYMENTS_UNAVAILABLE_STATUS,
} from "@/lib/payments/provider-unavailable";

export const maxDuration = 60;

/**
 * Spec 038 — Prepaid Hour Wallet, Phase 3 (purchase flow).
 *
 * "Buy hours" checkout: a logged-in student pays once via Stripe `mode:"payment"`
 * for a bundle of 1:1 individual-session hours at the flat `prepaid_hours_rate_usd`
 * rate. On `payment_intent.succeeded` the webhook calls `grant_prepaid_hours`
 * (Phase 2 DB fn) which is idempotent on the Stripe PaymentIntent id (H1).
 *
 * Reuse base: src/app/api/stripe/checkout/single-session/route.ts (the one-time
 * payment pattern). Server computes the amount; the body never carries price,
 * rate, or currency. `studentId` comes from `requireRole("student")`, never from
 * input, and is stamped into Stripe metadata so the webhook can re-derive it
 * server-side (FR-005).
 *
 * Feature flag (R10): `prepaid_hours_purchase_enabled` in platform_settings,
 * default OFF (missing key → isFeatureEnabled returns false). Flip to "true"
 * AFTER the Phase 1 migration is confirmed applied. Until then the route
 * returns 404 so the surface is invisible to students.
 */

// ── Body schema (FR-016 zod at the boundary) ─────────────────────────────────
// The client sends ONLY hours. Amount, rate, and currency are NEVER accepted
// from the client — they are server-derived (fail-closed, FR-002). `hours` is
// clamped to the custom min/max from platform_settings below.
const PrepaidCheckoutSchema = z
  .object({
    hours: z.number().int().finite().positive(),
  })
  .strict();

type PrepaidCheckout = z.infer<typeof PrepaidCheckoutSchema>;

// The rate/bounds parsing (defensive parse + inverted-bounds RESET) and the
// amountCents computation live in resolvePrepaidQuote
// (@/lib/domains/billing/prepaid-quote), shared with the PayPal prepaid
// route. This is the CHARGE path — a stale local copy bills the wrong
// amount.

/**
 * POST /api/stripe/checkout/prepaid-hours
 *
 * Creates a Stripe Checkout session in **payment** mode for a prepaid-hour
 * bundle. Returns `{ checkoutUrl }` on success.
 */
export async function POST(request: Request) {
  // ── Feature flag (R10) ────────────────────────────────────────────────────
  // Default OFF — the surface is invisible until an admin flips the setting to
  // "true" in platform_settings. 404 (not 501) so the route's existence is not
  // leaked while disabled.
  const enabled = await isFeatureEnabled("prepaid_hours_purchase_enabled");
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

  // Per-user rate limit (fix #4): cap Checkout-session creation. Fail-open so a
  // limiter outage never blocks a real purchase.
  if (!(await checkRateLimit(studentId, "checkout-prepaid-hours", 20))) {
    return NextResponse.json(
      { error: "Too many attempts — please wait a moment and try again." },
      { status: 429 },
    );
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

  // ── Rate + bounds + amount (server-only; FR-002) ──────────────────────────
  let rateUsd: number;
  let amountCents: number;
  try {
    ({ rateUsd, amountCents } = await resolvePrepaidQuote(body.hours));
  } catch (e) {
    if (e instanceof PrepaidHoursOutOfRangeError) {
      return NextResponse.json(
        { success: false, error: e.message },
        { status: 422 },
      );
    }
    throw e;
  }

  // ── Stripe configuration gates ─────────────────────────────────────────────
  if (!isStripeConfigured()) {
    logError(
      "prepaid-hours checkout: Stripe not configured",
      new Error("no-stripe-key"),
      { tag: "prepaid-hours" },
    );
    return NextResponse.json(
      { success: false, error: PAYMENTS_UNAVAILABLE_MESSAGE },
      { status: PAYMENTS_UNAVAILABLE_STATUS },
    );
  }

  const appUrl = process.env.NEXT_PUBLIC_APP_URL;
  if (!appUrl) {
    logError(
      "prepaid-hours checkout: NEXT_PUBLIC_APP_URL not configured",
      new Error("config-missing"),
      { tag: "prepaid-hours" },
    );
    return NextResponse.json(
      { success: false, error: "Server misconfigured" },
      { status: 500 },
    );
  }

  // student email (best-effort) — same pattern as single-session.
  const userClient = await createClient();
  let email: string | undefined;
  try {
    const { data } = await userClient.auth.getUser();
    email = data.user?.email ?? undefined;
  } catch {
    email = undefined;
  }

  // ── Stripe Checkout session (mode: payment, one-time) ─────────────────────
  // metadata + payment_intent_data.metadata are BOTH set so the webhook can
  // re-derive ownership and the frozen rate from either the session or the PI.
  // `rate_usd` is the FROZEN rate snapshot (R1) — the webhook uses THIS value,
  // not a re-read of the setting, so a mid-flight admin rate change cannot
  // desync the charged amount from the granted lot's rate_paid_usd.
  const stripeMetadata: Record<string, string> = {
    product_type: "prepaid_hours",
    student_id: studentId,
    hours: String(body.hours),
    rate_usd: rateUsd.toFixed(2),
  };

  const stripe = getStripe();
  // 10-min double-submit window: a repeated click reuses the SAME Stripe key,
  // so Stripe returns the first session instead of charging the wallet twice.
  const idemBucket = Math.floor(Date.now() / 600_000);

  try {
    const session = await stripe.checkout.sessions.create({
      mode: "payment",
      ...(email ? { customer_email: email } : {}),
      client_reference_id: studentId,
      line_items: [
        {
          quantity: body.hours,
          price_data: {
            currency: "usd",
            unit_amount: Math.round(rateUsd * 100), // per-hour unit price
            product_data: {
              name: `Prepaid hour wallet — ${body.hours} × 60-min 1:1 session${body.hours === 1 ? "" : "s"}`,
            },
          },
        },
      ],
      metadata: stripeMetadata,
      payment_intent_data: { metadata: stripeMetadata },
      success_url: `${appUrl}/student/dashboard?prepaid_hours=success`,
      cancel_url: `${appUrl}/student/dashboard?prepaid_hours=cancelled`,
    }, { idempotencyKey: `prepaid:${studentId}:${body.hours}:${idemBucket}` });

    if (!session.url) {
      logError(
        "prepaid-hours checkout: Stripe returned no url",
        new Error("no url"),
        { tag: "prepaid-hours", student_id: studentId },
      );
      return NextResponse.json(
        { success: false, error: "Checkout session has no url" },
        { status: 502 },
      );
    }

    logInfo("prepaid-hours checkout: session created", {
      tag: "prepaid-hours",
      student_id: studentId,
      hours: body.hours,
      rate_usd: rateUsd,
      amount_cents: amountCents,
    });

    return NextResponse.json({ success: true, data: { checkoutUrl: session.url } });
  } catch (err) {
    logError("prepaid-hours checkout: stripe.checkout.sessions.create failed", err, {
      tag: "prepaid-hours",
      student_id: studentId,
      hours: body.hours,
    });
    return NextResponse.json(
      { success: false, error: "Checkout creation failed" },
      { status: 500 },
    );
  }
}
