import { NextResponse } from "next/server";
import type Stripe from "stripe";
import StripeSdk from "stripe";
import type { Json } from "@/types/supabase.generated";
import { createAdminClient } from "@/lib/supabase/admin";
import { logError, logInfo } from "@/lib/logger";
import { emitEvent } from "@/lib/automation/emit";
import {
  upsertMirror,
  grantCycle,
  buildCycleKey,
  BillingEvents,
  type StripeSubscriptionSnapshot,
} from "@/lib/domains/billing";
import { applyPendingTierChangeAtRenewal } from "@/lib/domains/catalog/credit-grant";

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
 * NOTE: API version `2026-05-27.dahlia` restructured several fields off the
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
  const stripe = new StripeSdk(apiKey, { apiVersion: "2026-05-27.dahlia" });
  const rawBody = await request.text();
  let event: Stripe.Event;
  try {
    event = stripe.webhooks.constructEvent(rawBody, sig, secret);
  } catch (err) {
    // Forged or malformed → 400, ZERO side effects (NFR-001).
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
      try {
        switch (event.type) {
          case "invoice.paid":            await handleInvoicePaid(retryCtx); break;
          case "invoice.payment_failed":  await handlePaymentFailed(retryCtx); break;
          case "customer.subscription.created":
          case "customer.subscription.updated": await handleSubscriptionLifecycle(retryCtx); break;
          case "customer.subscription.deleted": await handleSubscriptionDeleted(retryCtx); break;
          default: await markEvent(retryCtx, "ignored"); break;
        }
      } catch (err) {
        logError("stripe-webhook: retry dispatch crashed", err, {
          tag: "stripe-webhook", event_id: event.id, event_type: event.type,
        });
        await markEvent(retryCtx, "failed", err instanceof Error ? err.message : "retry dispatch crashed");
        return NextResponse.json({ error: "Retry dispatch failed" }, { status: 500 });
      }
      return NextResponse.json({ received: true });
    }
    logError("stripe-webhook: billing_events insert failed", insErr, {
      tag: "stripe-webhook", event_id: event.id, event_type: event.type,
    });
    return NextResponse.json({ error: "Ledger write failed" }, { status: 500 });
  }

  // ── Dispatch ──────────────────────────────────────────────────────────────
  const ctx: EventContext = { admin, stripe, event, billingEventId: eventRow?.id ?? null };
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

interface EventContext {
  admin: ReturnType<typeof createAdminClient>;
  stripe: Stripe;
  event: Stripe.Event;
  billingEventId: string | null;
}

/** Update the billing_events row status (best-effort, never throws). */
async function markEvent(
  ctx: EventContext,
  status: "processed" | "ignored" | "failed",
  errorDetail?: string,
): Promise<void> {
  if (!ctx.billingEventId) return;
  const { error } = await ctx.admin
    .from("billing_events")
    .update({ status, ...(errorDetail ? { error_detail: errorDetail } : {}) })
    .eq("id", ctx.billingEventId);
  if (error) {
    logError("stripe-webhook: markEvent failed", error, {
      tag: "stripe-webhook", billing_event_id: ctx.billingEventId, status,
    });
  }
}

/** Extract the subscription id from a dahlia-era invoice. */
function invoiceSubscriptionId(invoice: Stripe.Invoice): string | null {
  const fromParent = invoice.parent?.subscription_details?.subscription;
  if (typeof fromParent === "string") return fromParent;
  const fromLine = invoice.lines?.data?.[0]?.subscription;
  return typeof fromLine === "string" ? fromLine : null;
}

/** Extract the payment intent id from a dahlia-era invoice's payments list. */
function invoicePaymentIntentId(invoice: Stripe.Invoice): string | null {
  const payments = invoice.payments?.data ?? [];
  for (const p of payments) {
    const pi = p.payment?.payment_intent;
    if (typeof pi === "string") return pi;
  }
  return null;
}

// ── invoice.paid → grant one cycle (idempotent on cycle_key) ────────────────
async function handleInvoicePaid(ctx: EventContext): Promise<void> {
  const invoice = ctx.event.data.object as Stripe.Invoice;

  // FR-008: USD only. A non-USD invoice must never grant.
  if (invoice.currency !== "usd") {
    logError("stripe-webhook: non-USD invoice rejected", new Error("non-usd"), {
      tag: "stripe-webhook", event_id: ctx.event.id, currency: invoice.currency,
    });
    await markEvent(ctx, "failed", `non-usd currency: ${invoice.currency}`);
    return;
  }

  const subscriptionId = invoiceSubscriptionId(invoice);
  if (!subscriptionId) {
    await markEvent(ctx, "failed", "invoice has no subscription id");
    return;
  }

  const paymentIntent = invoicePaymentIntentId(invoice);
  if (!paymentIntent) {
    await markEvent(ctx, "failed", "invoice has no payment_intent");
    return;
  }

  // Resolve student_id + plan_id, ENSURING a mirror row exists (the grant fn
  // needs a real subscriptions.id FK). `customer.subscription.created` normally
  // lands first, but ordering isn't guaranteed — create-on-demand, race-safe
  // via the stripe_subscription_id UNIQUE.
  const resolved = await resolveSubscription(ctx, subscriptionId, invoice);
  if (!resolved.studentId || !resolved.planId || !resolved.mirrorId) {
    await markEvent(ctx, "failed", "could not resolve student_id/plan_id or create mirror");
    return;
  }
  const { studentId, mirrorId } = resolved;

  // Plan catalog row (binding source of credit count + price).
  const { data: plan } = await ctx.admin
    .from("subscription_plans")
    .select("id, monthly_credit_count, price_cents, session_metadata, is_hifz_product")
    .eq("id", resolved.planId)
    .maybeSingle<{
      id: string;
      monthly_credit_count: number;
      price_cents: number;
      session_metadata: unknown;
      is_hifz_product: boolean | null;
    }>();
  if (!plan) {
    await markEvent(ctx, "failed", `plan not found: ${resolved.planId}`);
    return;
  }

  const periodStartIso = new Date((invoice.period_start ?? ctx.event.created) * 1000).toISOString();
  const periodEndSec = invoice.period_end
    ?? ctx.event.created;
  const cycleKey = buildCycleKey({ invoiceId: invoice.id, subscriptionId, periodStartIso });

  const result = await grantCycle(ctx.admin, {
    subscriptionId: mirrorId,
    studentId,
    planId: plan.id,
    cycleKey,
    stripePaymentIntent: paymentIntent,
    amountCents: invoice.total ?? plan.price_cents,
    creditCount: plan.monthly_credit_count,
    expiresAt: new Date(periodEndSec * 1000).toISOString(),
    sessionMetadata: (plan.session_metadata ?? {}) as Record<string, unknown>,
  });

  if (!result.ok) {
    await markEvent(ctx, "failed", result.error);
    return;
  }

  await ctx.admin.from("billing_events").update({ subscription_id: mirrorId }).eq("id", ctx.billingEventId!);

  // ── T014a: Apply pending tier change at renewal (FR-019) ────────────────
  // If this is a hifz product and there's a pending tier change, apply it now:
  // transition pending→applied, switch subscription to new plan, re-grant credits.
  // The WHERE status='pending' guard makes this replay-safe.
  let activePlanId = plan.id;
  if (plan.is_hifz_product) {
    const tierResult = await applyPendingTierChangeAtRenewal(ctx.admin, mirrorId, invoice.id);
    if (tierResult.ok) {
      activePlanId = tierResult.newPlanId;
      logInfo("stripe-webhook: pending tier change applied", {
        tag: "billing",
        subscription_id: mirrorId,
        pending_id: tierResult.pendingId,
        new_plan_id: tierResult.newPlanId,
      });
    } else if (tierResult.reason !== "no_pending") {
      logError("stripe-webhook: pending tier change failed", new Error(tierResult.reason), {
        tag: "billing",
        subscription_id: mirrorId,
        error: tierResult.error,
      });
      await markEvent(ctx, "failed", `pending tier change failed: ${tierResult.reason}`);
      throw new Error(`pending tier change failed: ${tierResult.reason}`);
    }
  }

  await markEvent(ctx, "processed");

  // Post-commit, non-blocking lifecycle emit (Principle III). First paid cycle
  // = activation; subsequent = renewal.
  emitEvent(
    result.created ? BillingEvents.Activated : BillingEvents.Renewed,
    "subscription",
    mirrorId,
    { student_id: studentId, plan_id: activePlanId, cycle_key: cycleKey, grant_id: result.grantId },
  ).catch((err) => logError("emit subscription.activated/renewed failed", err, { tag: "billing" }));
}

/**
 * Resolve student_id + plan_id + guarantee a subscriptions mirror row exists.
 * The mirror is authoritative; when absent (first invoice may precede
 * `customer.subscription.created`), student_id comes from the Stripe
 * subscription's checkout-stamped metadata, plan_id from its first price, then
 * a mirror row is created (race-safe via stripe_subscription_id UNIQUE).
 */
async function resolveSubscription(
  ctx: EventContext,
  subscriptionId: string,
  invoice: Stripe.Invoice,
): Promise<{ studentId: string | null; planId: string | null; mirrorId: string | null }> {
  const { data: mirror } = await ctx.admin
    .from("subscriptions")
    .select("id, student_id, plan_id")
    .eq("stripe_subscription_id", subscriptionId)
    .maybeSingle<{ id: string; student_id: string; plan_id: string }>();
  if (mirror) {
    return { studentId: mirror.student_id, planId: mirror.plan_id, mirrorId: mirror.id };
  }

  // Retrieve the subscription: metadata.student_id + items[0].price.id.
  let studentId: string | null = null;
  let priceId: string | null = null;
  try {
    const sub = await ctx.stripe.subscriptions.retrieve(subscriptionId);
    studentId = (sub.metadata?.student_id as string | undefined) ?? null;
    priceId = sub.items?.data?.[0]?.price?.id ?? null;
  } catch (err) {
    logError("stripe-webhook: subscriptions.retrieve failed", err, {
      tag: "stripe-webhook", subscription_id: subscriptionId,
    });
  }

  let planId: string | null = null;
  if (priceId) {
    const { data: planByPrice } = await ctx.admin
      .from("subscription_plans")
      .select("id")
      .eq("stripe_price_id", priceId)
      .maybeSingle<{ id: string }>();
    planId = planByPrice?.id ?? null;
  }

  if (!studentId || !planId) {
    return { studentId, planId, mirrorId: null };
  }

  // Create the mirror so the grant fn has a real subscriptions.id FK.
  const customerId = typeof invoice.customer === "string" ? invoice.customer : "";
  const { data: created, error } = await ctx.admin
    .from("subscriptions")
    .insert({
      student_id: studentId,
      plan_id: planId,
      stripe_subscription_id: subscriptionId,
      stripe_customer_id: customerId,
      status: "active",
      current_period_start: invoice.period_start ? new Date(invoice.period_start * 1000).toISOString() : null,
      current_period_end: invoice.period_end ? new Date(invoice.period_end * 1000).toISOString() : null,
      last_event_at: new Date(ctx.event.created * 1000).toISOString(),
    })
    .select("id")
    .maybeSingle<{ id: string }>();

  if (error && error.code === "23505") {
    // Lost the race with a concurrent sub.created — re-read the winner.
    const { data: winner } = await ctx.admin
      .from("subscriptions")
      .select("id")
      .eq("stripe_subscription_id", subscriptionId)
      .maybeSingle<{ id: string }>();
    return { studentId, planId, mirrorId: winner?.id ?? null };
  }
  if (error || !created) {
    logError("stripe-webhook: mirror create-on-demand failed", error ?? new Error("no row"), {
      tag: "stripe-webhook", subscription_id: subscriptionId,
    });
    return { studentId, planId, mirrorId: null };
  }
  return { studentId, planId, mirrorId: created.id };
}

// ── invoice.payment_failed → past_due, no grant, seat retained ──────────────
async function handlePaymentFailed(ctx: EventContext): Promise<void> {
  const invoice = ctx.event.data.object as Stripe.Invoice;
  const subscriptionId = invoiceSubscriptionId(invoice);
  if (subscriptionId) {
    // Recency-guarded update: only flip if this event is at least as new as the
    // last applied event. Read-then-update with the event timestamp as a floor.
    const eventIso = new Date(ctx.event.created * 1000).toISOString();
    const { data: existing } = await ctx.admin
      .from("subscriptions")
      .select("id, last_event_at")
      .eq("stripe_subscription_id", subscriptionId)
      .maybeSingle<{ id: string; last_event_at: string }>();
    if (existing && Date.parse(eventIso) >= Date.parse(existing.last_event_at)) {
      await ctx.admin
        .from("subscriptions")
        .update({ status: "past_due", last_event_at: eventIso })
        .eq("id", existing.id);
    }
  }
  await markEvent(ctx, "processed");
  if (subscriptionId) {
    emitEvent(
      BillingEvents.PastDue,
      "subscription",
      subscriptionId,
      { subscription_id: subscriptionId },
    ).catch((err) => logError("emit subscription.past_due failed", err, { tag: "billing" }));
  }
}

// ── customer.subscription.created/updated → recency-guarded mirror upsert ───
async function handleSubscriptionLifecycle(ctx: EventContext): Promise<void> {
  const sub = ctx.event.data.object as Stripe.Subscription;
  const snap = await snapshotFromSubscription(ctx, sub);
  const mirror = await upsertMirror(ctx.admin, snap);
  if (mirror === null) {
    await markEvent(ctx, "failed", "upsertMirror returned null");
    return;
  }
  await markEvent(ctx, "processed");
}

// ── customer.subscription.deleted → canceled + canceled_at ──────────────────
async function handleSubscriptionDeleted(ctx: EventContext): Promise<void> {
  const sub = ctx.event.data.object as Stripe.Subscription;
  const snap = await snapshotFromSubscription(ctx, sub, { forceCanceled: true });
  const mirror = await upsertMirror(ctx.admin, snap);
  if (mirror === null) {
    await markEvent(ctx, "failed", "upsertMirror returned null");
    return;
  }
  await markEvent(ctx, "processed");
  emitEvent(
    BillingEvents.Canceled,
    "subscription",
    sub.id,
    { subscription_id: sub.id, student_id: snap.studentId },
  ).catch((err) => logError("emit subscription.canceled failed", err, { tag: "billing" }));
}

/** Build a mirror snapshot from a Stripe subscription object. */
async function snapshotFromSubscription(
  ctx: EventContext,
  sub: Stripe.Subscription,
  opts?: { forceCanceled?: boolean },
): Promise<StripeSubscriptionSnapshot> {
  // Period + price live on the subscription item in this API version.
  const item = sub.items?.data?.[0];
  const priceId = item?.price?.id ?? null;
  const periodStart = item?.current_period_start;
  const periodEnd = item?.current_period_end;

  // Resolve student_id: Stripe metadata (stamped at checkout) first, then the
  // existing mirror.
  let studentId = (sub.metadata?.student_id as string | undefined) ?? "";
  if (!studentId) {
    const { data: mirror } = await ctx.admin
      .from("subscriptions")
      .select("student_id")
      .eq("stripe_subscription_id", sub.id)
      .maybeSingle<{ student_id: string }>();
    studentId = mirror?.student_id ?? "";
  }
  if (!studentId) {
    throw new Error(`student_id not found for subscription ${sub.id} — metadata and mirror both empty`);
  }

  let planId: string | null = null;
  if (priceId) {
    const { data: plan } = await ctx.admin
      .from("subscription_plans")
      .select("id")
      .eq("stripe_price_id", priceId)
      .maybeSingle<{ id: string }>();
    planId = plan?.id ?? null;
  }

  return {
    stripeSubscriptionId: sub.id,
    stripeCustomerId: typeof sub.customer === "string" ? sub.customer : "",
    status: opts?.forceCanceled ? "canceled" : sub.status,
    currentPeriodStart: periodStart ? new Date(periodStart * 1000).toISOString() : null,
    currentPeriodEnd: periodEnd ? new Date(periodEnd * 1000).toISOString() : null,
    cancelAtPeriodEnd: sub.cancel_at_period_end,
    eventCreatedSeconds: ctx.event.created,
    studentId,
    planId,
  };
}
