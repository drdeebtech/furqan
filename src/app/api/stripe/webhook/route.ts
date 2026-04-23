import { NextResponse } from "next/server";
import { fulfillPackagePurchase } from "@/lib/stripe/fulfillment";
import { createAdminClient } from "@/lib/supabase/admin";

async function logEvent(eventType: string, status: "succeeded" | "failed", payload: unknown, error?: string, entityId?: string) {
  const supabase = createAdminClient();
  const now = new Date().toISOString();
  await supabase.from("automation_logs").insert({
    workflow_name: "stripe-webhook",
    event_name: eventType,
    entity_type: "stripe_event",
    entity_id: entityId ?? null,
    status,
    payload_json: payload,
    error_message: error ?? null,
    started_at: now,
    finished_at: now,
  } as never);
}

export const maxDuration = 60;

/**
 * Stripe webhook handler shell.
 *
 * STATUS: Stripe SDK is NOT installed. This route accepts and logs events but
 * does NOT verify signatures yet. DO NOT deploy with live Stripe webhooks
 * pointed at this route until the TODOs below are resolved.
 *
 * When Stripe keys arrive (Sprint 1):
 *   1. Install: npm i stripe
 *   2. Uncomment the signature verification block
 *   3. Replace the event-parsing stub with `stripe.webhooks.constructEvent()`
 *   4. Set STRIPE_WEBHOOK_SECRET env var
 *
 * The fulfillment logic is already wired — only the Stripe SDK glue is pending.
 */
export async function POST(request: Request) {
  const body = await request.text();

  // TODO(Sprint 1): Verify Stripe signature
  // const sig = request.headers.get("stripe-signature");
  // if (!sig || !process.env.STRIPE_WEBHOOK_SECRET) {
  //   return NextResponse.json({ error: "Missing signature" }, { status: 400 });
  // }
  // const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!);
  // let event: Stripe.Event;
  // try {
  //   event = stripe.webhooks.constructEvent(body, sig, process.env.STRIPE_WEBHOOK_SECRET);
  // } catch (e) {
  //   return NextResponse.json({ error: "Invalid signature" }, { status: 400 });
  // }

  // Until Stripe SDK is installed, accept the raw JSON payload.
  let event: { type: string; data: { object: Record<string, unknown> } };
  try {
    event = JSON.parse(body);
  } catch {
    return NextResponse.json({ error: "Invalid payload" }, { status: 400 });
  }

  // Route by event type. Add cases as Stripe events are wired.
  switch (event.type) {
    case "checkout.session.completed": {
      const session = event.data.object;
      const metadata = (session.metadata ?? {}) as { user_id?: string; package_id?: string };
      const paymentIntentId = session.payment_intent as string | undefined;
      const amountTotal = session.amount_total as number | undefined;

      if (!metadata.user_id || !metadata.package_id || !paymentIntentId || amountTotal == null) {
        await logEvent(event.type, "failed", event.data.object, "Missing required metadata");
        return NextResponse.json({ error: "Missing required metadata" }, { status: 400 });
      }

      const result = await fulfillPackagePurchase({
        userId: metadata.user_id,
        packageId: metadata.package_id,
        stripePaymentIntentId: paymentIntentId,
        amountUsd: amountTotal / 100, // Stripe returns cents
        currency: (session.currency as string | undefined)?.toUpperCase() ?? "USD",
      });

      await logEvent(event.type, result.ok ? "succeeded" : "failed", { metadata, result }, result.error, paymentIntentId);

      if (!result.ok) {
        return NextResponse.json({ error: result.error }, { status: 500 });
      }
      return NextResponse.json({ fulfilled: true, ...result });
    }

    case "checkout.session.expired":
    case "payment_intent.payment_failed": {
      await logEvent(event.type, "succeeded", event.data.object);
      return NextResponse.json({ received: true });
    }

    default:
      await logEvent(event.type, "succeeded", { unhandled: true });
      return NextResponse.json({ received: true, unhandled: event.type });
  }
}
