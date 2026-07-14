import { NextResponse } from "next/server";
import type Stripe from "stripe";
import StripeSdk from "stripe";
import type { Json } from "@/types/supabase.generated";
import { createAdminClient } from "@/lib/supabase/admin";
import { logError } from "@/lib/logger";
import {
  handleInvoicePaid,
  handlePaymentFailed,
  handleSubscriptionLifecycle,
  handleSubscriptionDeleted,
  handlePaymentIntentSucceeded,
  handlePrepaidHoursGrant,
  handleChargeRefunded,
  handleChargeDisputed,
  markEvent,
  type EventContext,
} from "@/lib/domains/billing/webhook-handlers";

export const maxDuration = 60;

/**
 * POST /api/stripe/webhook — signature-verified Stripe ingestion (spec 018).
 *
 * No financial side effect before signature verification (NFR-001). The grant
 * is service-role-only via the SECURITY DEFINER `grant_subscription_cycle`;
 * this route never writes `student_packages` directly. `billing_events`
 * (`stripe_event_id` UNIQUE) is the idempotency ledger — a duplicate delivery
 * is a 200 no-op. See contracts/webhook.contract.md.
 *
 * NOTE: API version `2026-06-24.dahlia` restructured several fields off the
 * Invoice/Subscription top level: the subscription id lives on
 * `invoice.parent.subscription_details.subscription` (or the line item), the
 * payment intent on `invoice.payments[].payment.payment_intent`, and the
 * period/price on `subscription.items.data[0]`. These accesses were verified
 * against node_modules/stripe type defs (AGENTS.md: verify unfamiliar APIs).
 */
export async function POST(request: Request) {
  const sig = request.headers.get("stripe-signature");
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  const apiKey = process.env.STRIPE_SECRET_KEY;

  // Missing config → 503 (distinct from a forged signature's 400). Never 200:
  // silently succeeding with no verification would be an NFR-001 violation.
  if (!sig || !secret || !apiKey) {
    logError("stripe-webhook: not configured", new Error("config-missing"), {
      tag: "stripe-webhook", missing: [
        !sig && "sig", !secret && "secret", !apiKey && "key",
      ].filter(Boolean).join(","),
    });
    return NextResponse.json({ error: "Stripe webhook not configured" }, { status: 503 });
  }

  // ── Gate 1: raw body + signature verification (fail-closed 400) ───────────
  // Webhook route builds its own Stripe instance so a bad key returns a clean
  // 400 here instead of throwing at import time (see stripe/client.ts).
  const stripe = new StripeSdk(apiKey, { apiVersion: "2026-06-24.dahlia" });
  const rawBody = await request.text();
  let event: Stripe.Event;
  try {
    event = stripe.webhooks.constructEvent(rawBody, sig, secret);
  } catch (err) {
    // Forged or malformed → 400, ZERO side effects (NFR-001).
    // no security-alert here: unauthenticated path, flood vector (see PR #686 review)
    logError("stripe-webhook: signature verification failed", err, {
      tag: "stripe-webhook", kind: "bad-sig",
    });
    return NextResponse.json({ error: "Invalid signature" }, { status: 400 });
  }

  const admin = createAdminClient();

  // ── Gate 2: idempotency ledger insert ─────────────────────────────────────
  // UNIQUE(stripe_event_id): a duplicate delivery is already-processed → 200 no-op.
  const { data: eventRow, error: insErr } = await admin
    .from("billing_events")
    .insert({
      stripe_event_id: event.id,
      event_type: event.type,
      stripe_event_created: new Date(event.created * 1000).toISOString(),
      status: "received",
      payload: event as unknown as Json,
    })
    .select("id")
    .maybeSingle();

  if (insErr) {
    if (insErr.code === "23505") {
      // Check terminal status before treating as a no-op (idempotency gap fix).
      // A prior failed delivery writes a non-terminal row; a retry must re-attempt.
      const { data: dupRow } = await admin
        .from("billing_events")
        .select("id, status")
        .eq("stripe_event_id", event.id)
        .maybeSingle<{ id: string; status: string }>();
      if (!dupRow || dupRow.status === "processed" || dupRow.status === "ignored") {
        return NextResponse.json({ received: true, duplicate: true });
      }
      const retryCtx: EventContext = { admin, stripe, event, billingEventId: dupRow.id };
      return dispatch(retryCtx);
    }
    logError("stripe-webhook: billing_events insert failed", insErr, {
      tag: "stripe-webhook", event_id: event.id, event_type: event.type,
    });
    return NextResponse.json({ error: "Ledger write failed" }, { status: 500 });
  }

  // ── Dispatch ──────────────────────────────────────────────────────────────
  const ctx: EventContext = { admin, stripe, event, billingEventId: eventRow?.id ?? null };
  return dispatch(ctx);
}

/** Route the event type to the appropriate handler. */
async function dispatch(ctx: EventContext): Promise<NextResponse> {
  const { event } = ctx;
  try {
    switch (event.type) {
      case "invoice.paid":
        await handleInvoicePaid(ctx);
        break;
      case "invoice.payment_failed":
        await handlePaymentFailed(ctx);
        break;
      case "customer.subscription.created":
      case "customer.subscription.updated":
        await handleSubscriptionLifecycle(ctx);
        break;
      case "customer.subscription.deleted":
        await handleSubscriptionDeleted(ctx);
        break;
      case "payment_intent.succeeded":
        // Spec 038: PI metadata routes one-time payments. `product_type=
        // prepaid_hours` (set at /api/stripe/checkout/prepaid-hours) goes to
        // the wallet grant path; everything else is the spec-022 single-session
        // booking materializer. The peek is safe — unknown shapes fall through
        // to handlePaymentIntentSucceeded which has its own metadata checks.
        if (isPrepaidHoursPi(event)) {
          await handlePrepaidHoursGrant(ctx);
        } else {
          await handlePaymentIntentSucceeded(ctx);
        }
        break;
      case "charge.refunded":
        // Spec 038 R8/H5: finalize the admin refund saga (when metadata carries
        // a refund_request_id) OR reconcile an external Stripe-side refund by
        // voiding the prepaid lot's remaining hours.
        await handleChargeRefunded(ctx);
        break;
      case "charge.dispute.created":
        // Spec 038 H5: chargeback voids the prepaid lot's remaining hours.
        // Other dispute events (.updated/.closed/.funds_reinstated) are
        // informational → default branch marks them ignored.
        await handleChargeDisputed(ctx);
        break;
      default:
        await markEvent(ctx, "ignored");
        break;
    }
  } catch (err) {
    // Unexpected crash: mark failed and 500 so Stripe retries (idempotency
    // makes a retry safe — the billing_events row already guards re-entry).
    logError("stripe-webhook: dispatch crashed", err, {
      tag: "stripe-webhook", event_id: event.id, event_type: event.type,
    });
    await markEvent(ctx, "failed", err instanceof Error ? err.message : "dispatch crashed");
    return NextResponse.json({ error: "Dispatch failed" }, { status: 500 });
  }
  return NextResponse.json({ received: true });
}

/**
 * Spec 038: does this `payment_intent.succeeded` event carry prepaid-hours
 * checkout metadata? The value is server-stamped at our checkout route and
 * signature-verified by Stripe, so reading it here is safe. Returns false for
 * any other PI shape (single-session bookings, subscription PI flows, etc.),
 * which then route to the existing handler.
 */
function isPrepaidHoursPi(event: Stripe.Event): boolean {
  const obj = event.data.object as { metadata?: Record<string, unknown> } | null;
  return obj?.metadata?.product_type === "prepaid_hours";
}
