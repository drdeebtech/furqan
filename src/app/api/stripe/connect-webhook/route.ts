import { NextResponse } from "next/server";
import type Stripe from "stripe";
import StripeSdk from "stripe";
import { createAdminClient } from "@/lib/supabase/admin";
import { logError } from "@/lib/logger";
import {
  markEvent,
  ingestBillingEvent,
  type EventContext,
} from "@/lib/domains/billing/webhook-handlers";
import {
  handleConnectAccountUpdated,
  handleConnectPayoutEvent,
} from "@/lib/domains/billing/connect-webhook-handlers";
import { createConnectAccountsStore } from "@/lib/domains/connect/connect-accounts-store";

export const maxDuration = 60;

/**
 * POST /api/stripe/connect-webhook — Stripe Connect (connected-account)
 * event ingestion (spec 040 Phase 3, FR-018/FR-020).
 *
 * Mirrors /api/stripe/webhook's shell exactly: no side effect before raw-body
 * signature verification (fail-closed 400), `billing_events (stripe_event_id
 * UNIQUE)` as the shared idempotency ledger, thin dispatch. Separate endpoint,
 * separate secret (`STRIPE_CONNECT_WEBHOOK_SECRET`) — this endpoint handles
 * CONNECTED-ACCOUNT events only (they always carry `event.account`). Platform
 * events — `charge.*` refunds/disputes AND `transfer.*` (Transfer objects
 * live on the PLATFORM account; adversarial-review finding) — are processed
 * only by /api/stripe/webhook (one authoritative path). The `event.account`
 * guard below refuses anything else BEFORE the shared ledger write, so a
 * misconfigured subscription can never terminally mark a platform money
 * event 'ignored' from this endpoint.
 *
 * DORMANT until the owner creates the live Connect webhook endpoint and sets
 * the secret (Phase 6 checklist); unset secret → 503, never silent success.
 */
export async function POST(request: Request) {
  const sig = request.headers.get("stripe-signature");
  const secret = process.env.STRIPE_CONNECT_WEBHOOK_SECRET;
  const apiKey = process.env.STRIPE_SECRET_KEY;

  if (!sig || !secret || !apiKey) {
    logError("connect-webhook: not configured", new Error("config-missing"), {
      tag: "connect-webhook",
      missing: [!sig && "sig", !secret && "secret", !apiKey && "key"].filter(Boolean).join(","),
    });
    return NextResponse.json({ error: "Connect webhook not configured" }, { status: 503 });
  }

  // ── Gate 1: raw body + signature verification (fail-closed 400) ───────────
  const stripe = new StripeSdk(apiKey, { apiVersion: "2026-06-24.dahlia" });
  const rawBody = await request.text();
  let event: Stripe.Event;
  try {
    event = stripe.webhooks.constructEvent(rawBody, sig, secret);
  } catch (err) {
    // no security-alert here: unauthenticated path, flood vector (see PR #686 review)
    logError("connect-webhook: signature verification failed", err, {
      tag: "connect-webhook",
      kind: "bad-sig",
    });
    return NextResponse.json({ error: "Invalid signature" }, { status: 400 });
  }

  // ── Gate 1.5: connected-account guard (BEFORE any ledger write) ──────────
  // A platform event misdelivered here (operator subscribed this endpoint to
  // platform types) must not touch the shared billing_events ledger: the
  // default→ignored branch would otherwise terminally mark an event the
  // platform route still needs to process (silent money loss). Connected-
  // account events always carry `event.account`.
  if (!event.account) {
    logError("connect-webhook: event without event.account refused (platform event misdelivered?)", null, {
      tag: "connect-webhook",
      event_id: event.id,
      event_type: event.type,
    });
    return NextResponse.json({ received: true, skipped: "not-a-connected-account-event" });
  }

  const admin = createAdminClient();

  // ── Gate 2: shared idempotency ledger (ADR-0005: shared Billing seam) ────
  let ingest: Awaited<ReturnType<typeof ingestBillingEvent>>;
  try {
    ingest = await ingestBillingEvent(admin, {
      provider: "stripe",
      eventId: event.id,
      eventType: event.type,
      createdMs: event.created * 1000,
      payload: event,
    });
  } catch (insErr) {
    logError("connect-webhook: billing_events insert failed", insErr, {
      tag: "connect-webhook",
      event_id: event.id,
      event_type: event.type,
    });
    return NextResponse.json({ error: "Ledger write failed" }, { status: 500 });
  }

  if (ingest.outcome === "duplicate") {
    return NextResponse.json({ received: true, duplicate: true });
  }

  return dispatch({ admin, stripe, event, billingEventId: ingest.billingEventId });
}

/** Route the connected-account event to its handler. */
async function dispatch(ctx: EventContext): Promise<NextResponse> {
  const { event } = ctx;
  try {
    switch (event.type) {
      case "account.updated":
        await handleConnectAccountUpdated(ctx, createConnectAccountsStore());
        break;
      case "payout.paid":
      case "payout.failed":
        await handleConnectPayoutEvent(ctx);
        break;
      default:
        await markEvent(ctx, "ignored");
        break;
    }
  } catch (err) {
    // Loud retryable failure: mark failed + 500 so Stripe redelivers (the
    // ledger's non-terminal-status retry path makes this safe), including the
    // deliberate unknown-our-account throw in handleConnectAccountUpdated.
    logError("connect-webhook: dispatch crashed", err, {
      tag: "connect-webhook",
      event_id: event.id,
      event_type: event.type,
    });
    await markEvent(ctx, "failed", err instanceof Error ? err.message : "dispatch crashed");
    return NextResponse.json({ error: "Dispatch failed" }, { status: 500 });
  }
  return NextResponse.json({ received: true });
}
