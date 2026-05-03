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
 * Stripe webhook handler — HARD-DISABLED.
 *
 * STATUS: Stripe SDK is not installed and signature verification is not wired.
 * Returning 501 unconditionally so this route CANNOT silently start accepting
 * unsigned payloads when STRIPE_SECRET_KEY / STRIPE_WEBHOOK_SECRET land in env
 * (which would otherwise let any anonymous POST grant a paid package via the
 * `checkout.session.completed` branch).
 *
 * Sprint 1 implementation:
 *   1. `npm i stripe`
 *   2. Replace this body with the verifier + handler skeleton below
 *   3. Set STRIPE_WEBHOOK_SECRET in Vercel env
 *
 *   import Stripe from "stripe";
 *   export async function POST(request: Request) {
 *     const sig = request.headers.get("stripe-signature");
 *     const secret = process.env.STRIPE_WEBHOOK_SECRET;
 *     const apiKey = process.env.STRIPE_SECRET_KEY;
 *     if (!sig || !secret || !apiKey) {
 *       return NextResponse.json({ error: "Stripe not configured" }, { status: 503 });
 *     }
 *     const body = await request.text();
 *     const stripe = new Stripe(apiKey);
 *     let event: Stripe.Event;
 *     try {
 *       event = stripe.webhooks.constructEvent(body, sig, secret);
 *     } catch {
 *       return NextResponse.json({ error: "Invalid signature" }, { status: 400 });
 *     }
 *     // ... switch on event.type, call fulfillPackagePurchase, logEvent, etc.
 *   }
 *
 * `fulfillPackagePurchase` and `logEvent` remain importable for that Sprint 1
 * wiring; do not delete the imports.
 */
export async function POST(_request: Request) {
  return NextResponse.json(
    { error: "Stripe webhook not implemented" },
    { status: 501 },
  );
}

// Keep referenced so the imports above don't get tree-shaken / lint-stripped
// before Sprint 1 needs them. Removing this line will produce unused-import
// errors that flag the Sprint 1 reviewer to wire them up properly.
void fulfillPackagePurchase;
void logEvent;
