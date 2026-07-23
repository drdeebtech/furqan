import "server-only";

/**
 * Stripe webhook event handlers (spec 018 / 022).
 *
 * Each `handle*` function receives an `EventContext` (admin client, stripe
 * instance, event, billing_events row id) and is responsible for:
 *   - performing all DB side effects;
 *   - calling `markEvent` to finalize the billing_events row;
 *   - emitting lifecycle events post-commit (non-blocking, fail-soft).
 *
 * None of these functions perform signature verification or idempotency-ledger
 * writes — those belong to the route dispatcher.
 */

import type Stripe from "stripe";
import { z } from "zod";
import type { Json } from "@/types/supabase.generated";
import { createAdminClient } from "@/lib/supabase/admin";
import { logError, logInfo } from "@/lib/logger";
import { dispatchEffects } from "@/lib/automation/effects";
import {
  applyChargeClawbacks,
  disputeChargeId,
  holdDisputedEntries,
  paymentIntentIdOf,
} from "@/lib/domains/connect/clawback";
import { emitEvent } from "@/lib/automation/emit";
import { getPostHogClient } from "@/lib/posthog-server";
import {
  upsertMirror,
  type StripeSubscriptionSnapshot,
} from "@/lib/domains/billing/subscriptions";
import { grantCycle, buildCycleKey } from "@/lib/domains/billing/orchestrate";
import { BillingEvents } from "@/lib/domains/billing/events";
import {
  applyImmediateUpgradeGrant,
  resolvePendingTierChange,
  finalizePendingTierChange,
  type ResolvedPendingTierChange,
} from "@/lib/domains/catalog/credit-grant";

// ── Shared context ────────────────────────────────────────────────────────────

export interface EventContext {
  admin: ReturnType<typeof createAdminClient>;
  stripe: Stripe;
  event: Stripe.Event;
  billingEventId: string | null;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Update the billing_events row status (best-effort, never throws). */
/**
 * Transient infrastructure/RPC failure on a money path: THROWN so the dispatch
 * catch marks the event failed and answers 500 — Stripe redelivers and the
 * billing_events non-terminal status admits the retry. markEvent(failed)+return
 * would answer 200 and dead-end the event (Stripe only retries non-2xx);
 * that posture is reserved for DETERMINISTIC un-retryables. (Phase 5 security
 * pass P1 — the spec-040 clawback/hold paths already rethrow; this aligns the
 * older spec-018/038 paths.)
 */
export class WebhookTransientError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "WebhookTransientError";
  }
}

export async function markEvent(
  ctx: Pick<EventContext, "admin" | "billingEventId">,
  status: "processed" | "ignored" | "failed",
  errorDetail?: string,
  logTag = "stripe-webhook",
): Promise<void> {
  if (!ctx.billingEventId) return;
  const { error } = await ctx.admin
    .from("billing_events")
    .update({ status, ...(errorDetail ? { error_detail: errorDetail.slice(0, 500) } : {}) })
    .eq("id", ctx.billingEventId);
  if (error) {
    logError(`${logTag}: markEvent failed`, error, {
      tag: logTag, billing_event_id: ctx.billingEventId, status,
    });
  }
}

// ── ADR-0005: billing_events idempotency ledger (shared by all 3 provider
// webhook routes — stripe/webhook, stripe/connect-webhook, paypal/webhook) ────

/** Provider that emitted the event; matches the `billing_events.provider` CHECK. */
export type BillingEventProvider = "stripe" | "paypal";

export interface IngestBillingEventInput {
  provider: BillingEventProvider;
  /** Provider's event id — stored in the shared `stripe_event_id` UNIQUE column
   *  (Stripe and PayPal event ids never collide; see migration 20260719000100). */
  eventId: string;
  eventType: string;
  /** Event creation time in epoch ms. Stripe: `event.created * 1000`. PayPal:
   *  `Date.parse(event.create_time)` or `Date.now()` when absent — the route
   *  owns that translation; this function only ever sees a number. */
  createdMs: number;
  payload: unknown;
}

export type IngestBillingEventOutcome = "new" | "duplicate" | "redispatch";

export interface IngestBillingEventResult {
  outcome: IngestBillingEventOutcome;
  billingEventId: string | null;
}

/** billing_events statuses that mean "already fully handled" — a duplicate
 *  delivery of one of these is a no-op. Anything else (received/failed) is a
 *  prior incomplete delivery and must be re-dispatched, not dropped. */
const TERMINAL_BILLING_EVENT_STATUSES = new Set(["processed", "ignored"]);

/**
 * Insert-or-detect-duplicate against the `billing_events` idempotency ledger.
 * This is ONLY the ledger write + dedup check — routing the event to its
 * handler (dispatch) stays provider-specific and lives in each route.
 *
 * - insert succeeds → outcome 'new', billingEventId = the new row's id.
 * - insert 23505 (duplicate) + prior row is terminal (processed/ignored) →
 *   outcome 'duplicate' — the route returns 200 with no further dispatch.
 * - insert 23505 + prior row is NOT terminal (received/failed — an earlier
 *   delivery never finished) → outcome 'redispatch' — the route re-dispatches
 *   in place using the existing row's id.
 * - any other insert error → THROWN (the route maps this to its own 500
 *   "Ledger write failed" response and log line).
 */
export async function ingestBillingEvent(
  admin: ReturnType<typeof createAdminClient>,
  input: IngestBillingEventInput,
): Promise<IngestBillingEventResult> {
  const { provider, eventId, eventType, createdMs, payload } = input;

  const { data: insertedRow, error: insErr } = await admin
    .from("billing_events")
    .insert({
      stripe_event_id: eventId,
      event_type: eventType,
      stripe_event_created: new Date(createdMs).toISOString(),
      status: "received",
      payload: payload as Json,
      provider,
    })
    .select("id")
    .maybeSingle<{ id: string }>();

  if (!insErr) {
    return { outcome: "new", billingEventId: insertedRow?.id ?? null };
  }

  if (insErr.code !== "23505") {
    throw insErr;
  }

  // Duplicate delivery — check the prior row's terminal status before
  // treating this as a no-op (idempotency gap fix): a prior failed/received
  // delivery never finished and must be re-attempted, not silently dropped.
  const { data: dupRow } = await admin
    .from("billing_events")
    .select("id, status")
    .eq("stripe_event_id", eventId)
    .maybeSingle<{ id: string; status: string }>();

  if (!dupRow || TERMINAL_BILLING_EVENT_STATUSES.has(dupRow.status)) {
    return { outcome: "duplicate", billingEventId: dupRow?.id ?? null };
  }
  return { outcome: "redispatch", billingEventId: dupRow.id };
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

/**
 * Resolve the invoice's payment intent id, re-fetching the invoice with the
 * expandable `payments` list when the webhook payload omits it. Webhook event
 * payloads never include expandable lists on the dahlia API — proven live
 * 2026-07-19: every real subscription `invoice.paid` arrived without
 * `payments`, so the grant dead-ended as "failed" and paid subscribers got
 * zero credits. A retrieve failure throws transient (non-2xx → Stripe
 * redelivers) because a PAID invoice must never silently skip its grant.
 */
async function resolveInvoicePaymentIntentId(
  ctx: EventContext,
  invoice: Stripe.Invoice,
): Promise<string | null> {
  const fromEvent = invoicePaymentIntentId(invoice);
  if (fromEvent) return fromEvent;
  // List present in the payload (even empty) but carrying no PI → genuinely
  // PI-less; only an ABSENT list warrants the expanded re-fetch.
  if (Array.isArray(invoice.payments?.data) || !invoice.id) return null;
  let expanded: Stripe.Invoice;
  try {
    expanded = await ctx.stripe.invoices.retrieve(invoice.id, { expand: ["payments"] });
  } catch (err) {
    logError("stripe-webhook: invoice payments retrieve failed", err, {
      tag: "stripe-webhook", invoice_id: invoice.id,
    });
    throw new WebhookTransientError(`invoice payments retrieve failed: ${invoice.id}`);
  }
  return invoicePaymentIntentId(expanded);
}

// ── invoice.paid → grant one cycle (idempotent on cycle_key) ─────────────────

export async function handleInvoicePaid(ctx: EventContext): Promise<void> {
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

  // ── Proration invoice from an immediate tier upgrade ────────────────────
  // billing_reason 'subscription_update' = the always_invoice proration created
  // by upgrade-tier. Grant ONLY the pending delta recorded by the route (and
  // only now that the invoice is PAID) — running the full monthly grantCycle on
  // these invoices double-granted (delta at request time + a full month here,
  // distinct cycle keys). Audit 2026-07-15. Placed before the payment_intent
  // guard: proration invoices can settle from customer balance without a PI,
  // and the delta grant doesn't record one.
  if (invoice.billing_reason === "subscription_update") {
    const resolvedUpgrade = await resolveSubscription(ctx, subscriptionId, invoice);
    if (!resolvedUpgrade.mirrorId) {
      // Can be a transient subscriptions.retrieve/DB outage — retryable.
      throw new WebhookTransientError("could not resolve mirror for subscription_update invoice");
    }
    const upgrade = await applyImmediateUpgradeGrant(ctx.admin, resolvedUpgrade.mirrorId, invoice.id);
    if (!upgrade.ok && upgrade.reason !== "no_pending") {
      // RPC/DB failure while granting a PAID upgrade — must retry, never 200.
      throw new WebhookTransientError(`immediate upgrade grant failed: ${upgrade.reason}`);
    }
    await ctx.admin
      .from("billing_events")
      .update({ subscription_id: resolvedUpgrade.mirrorId })
      .eq("id", ctx.billingEventId!);
    if (upgrade.ok) {
      logInfo("stripe-webhook: immediate-upgrade delta granted on paid proration invoice", {
        tag: "billing",
        subscription_id: resolvedUpgrade.mirrorId,
        pending_id: upgrade.pendingId,
        delta_sessions: upgrade.deltaSessions,
      });
      getPostHogClient()?.capture({
        distinctId: upgrade.studentId,
        event: "subscription_tier_upgraded",
        properties: {
          subscription_id: resolvedUpgrade.mirrorId,
          new_plan_id: upgrade.planId,
          delta_sessions: upgrade.deltaSessions,
        },
      });
    } else {
      // subscription_update invoice with no pending row — e.g. a price change
      // made directly in the Stripe dashboard. Nothing to grant; benign.
      logInfo("stripe-webhook: subscription_update invoice with no pending upgrade grant", {
        tag: "billing",
        subscription_id: resolvedUpgrade.mirrorId,
        invoice_id: invoice.id,
      });
    }
    await markEvent(ctx, "processed");
    return;
  }

  const paymentIntent = await resolveInvoicePaymentIntentId(ctx, invoice);
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
    // Can be a transient subscriptions.retrieve/mirror-insert outage on a PAID
    // invoice — a 200 here would silently never grant the credits.
    throw new WebhookTransientError("could not resolve student_id/plan_id or create mirror");
  }
  const { studentId, mirrorId } = resolved;

  // Plan catalog row (binding source of credit count + price).
  const { data: plan, error: planErr } = await ctx.admin
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
  if (planErr) {
    // Transient catalog lookup failure previously masqueraded as "plan not
    // found" (the error was silently discarded) — retry instead.
    throw new WebhookTransientError(`plan lookup failed: ${planErr.message}`);
  }
  if (!plan) {
    // Deterministic: the catalog genuinely has no such plan — retrying cannot
    // fix data, so record and stop.
    await markEvent(ctx, "failed", `plan not found: ${resolved.planId}`);
    return;
  }

  const periodStartIso = new Date((invoice.period_start ?? ctx.event.created) * 1000).toISOString();
  const periodEndSec = invoice.period_end ?? ctx.event.created;
  const cycleKey = buildCycleKey({ invoiceId: invoice.id, subscriptionId, periodStartIso });

  // ── T014a: pending tier change at renewal (FR-019) ───────────────────────
  // A hifz subscription can have a tier change scheduled for renewal. When one
  // applies THIS cycle, the cycle must be granted exactly once — at the NEW
  // tier — and the payment recorded once. Routing that single grant through
  // grantCycle (below) at the resolved new plan replaces the old flow, which
  // granted the old tier here AND a second full new-tier cycle via
  // grant_hifz_cycle_credits — double-granting a whole month per tier-change
  // renewal (audit 2026-07-18).
  let effectivePlan = plan;
  let pendingTier: ResolvedPendingTierChange | null = null;
  if (plan.is_hifz_product) {
    const resolvedTier = await resolvePendingTierChange(ctx.admin, mirrorId);
    if (!resolvedTier.ok) {
      // Lookup/plan-resolve failure on a PAID invoice — retry, never 200.
      throw new WebhookTransientError(`pending tier change resolve failed: ${resolvedTier.error}`);
    }
    if (resolvedTier.pending) {
      pendingTier = resolvedTier.pending;
      const { data: newPlan, error: newPlanErr } = await ctx.admin
        .from("subscription_plans")
        .select("id, monthly_credit_count, price_cents, session_metadata")
        .eq("id", resolvedTier.pending.newPlanId)
        .maybeSingle<{
          id: string;
          monthly_credit_count: number;
          price_cents: number;
          session_metadata: unknown;
        }>();
      if (newPlanErr) {
        throw new WebhookTransientError(`new-tier plan lookup failed: ${newPlanErr.message}`);
      }
      if (!newPlan) {
        // Deterministic: the scheduled change points at a plan that no longer
        // exists — retrying cannot fix data.
        await markEvent(ctx, "failed", `new-tier plan not found: ${resolvedTier.pending.newPlanId}`);
        return;
      }
      // Grant + record the payment at the NEW tier (keep is_hifz_product).
      effectivePlan = { ...plan, ...newPlan };
    }
  }

  const result = await grantCycle(ctx.admin, {
    subscriptionId: mirrorId,
    studentId,
    planId: effectivePlan.id,
    cycleKey,
    stripePaymentIntent: paymentIntent,
    amountCents: invoice.total ?? effectivePlan.price_cents,
    creditCount: effectivePlan.monthly_credit_count,
    expiresAt: new Date(periodEndSec * 1000).toISOString(),
    sessionMetadata: (effectivePlan.session_metadata ?? {}) as Record<string, unknown>,
  });

  if (!result.ok) {
    // grantCycle failures are RPC/DB-transient; the cycle key makes the
    // redelivered grant idempotent.
    throw new WebhookTransientError(result.error);
  }

  await ctx.admin.from("billing_events").update({ subscription_id: mirrorId }).eq("id", ctx.billingEventId!);

  // Finalize the tier change only AFTER its cycle was granted at the new tier:
  // switch the subscription to the new plan + mark pending→applied. No regrant —
  // the single cycle already went through grantCycle above at the new tier.
  let activePlanId = plan.id;
  if (pendingTier) {
    const fin = await finalizePendingTierChange(
      ctx.admin,
      mirrorId,
      pendingTier.pendingId,
      pendingTier.newPlanId,
    );
    if (!fin.ok) {
      // Grant already landed (idempotent on cycleKey); retry to complete the
      // plan switch rather than 200 with a half-applied tier change.
      throw new WebhookTransientError(`pending tier change finalize failed: ${fin.error}`);
    }
    activePlanId = pendingTier.newPlanId;
    logInfo("stripe-webhook: pending tier change applied", {
      tag: "billing",
      subscription_id: mirrorId,
      pending_id: pendingTier.pendingId,
      new_plan_id: pendingTier.newPlanId,
    });
  }

  await markEvent(ctx, "processed");

  if (result.created) {
    getPostHogClient()?.capture({
      distinctId: studentId,
      event: "subscription_activated",
      properties: {
        subscription_id: mirrorId,
        plan_id: activePlanId,
        amount_cents: invoice.total ?? plan.price_cents,
      },
    });
  }

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
    // Defense-in-depth: `student_id` is server-stamped at checkout and reaches
    // us via Stripe's signature-verified API, and the subscriptions.student_id
    // FK→profiles already rejects a bogus id — but validate the shape here so a
    // malformed value fails fast and clearly rather than at the DB layer.
    const studentIdParsed = z.uuid().safeParse(sub.metadata?.student_id);
    studentId = studentIdParsed.success ? studentIdParsed.data : null;
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

// ── invoice.payment_failed → past_due, no grant, seat retained ───────────────

export async function handlePaymentFailed(ctx: EventContext): Promise<void> {
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

// ── customer.subscription.created/updated → recency-guarded mirror upsert ────

export async function handleSubscriptionLifecycle(ctx: EventContext): Promise<void> {
  const sub = ctx.event.data.object as Stripe.Subscription;
  const snap = await snapshotFromSubscription(ctx, sub);
  const mirror = await upsertMirror(ctx.admin, snap);
  if (mirror === null) {
    await markEvent(ctx, "failed", "upsertMirror returned null");
    return;
  }
  await markEvent(ctx, "processed");
}

// ── customer.subscription.deleted → canceled + canceled_at ───────────────────

export async function handleSubscriptionDeleted(ctx: EventContext): Promise<void> {
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

// ── payment_intent.succeeded → materialize one-time-paid single session ──────
//
// Spec 022 (م٥): the Stripe `payment`-mode Checkout for assessment / instant /
// specialized products. The booking + session + payment link MUST be created
// atomically — never a bare INSERT in this handler.
//
// • Idempotency: reuses the spec 018 `billing_events (stripe_event_id UNIQUE)`
//   ledger. We additionally stamp a SECOND idempotency sentinel keyed on the
//   PaymentIntent id (`pi_{id}`) into the same table — a duplicate
//   `payment_intent.succeeded` event with a NEW event id but the SAME PI id
//   must not double-create a booking. (FR-010 / SC-005).
//
// • Single creation path: assessment/specialized bookings call the atomic
//   `create_single_session_booking` SECURITY DEFINER creator (booking +
//   session + payment link in ONE transaction). instant bookings call the
//   adapted `start_instant_session_booking(p_payment_id)`.
//
// • Recovery: if the creator fails after all retries, the `payments` row is
//   left with `booking_id` NULL for reconciliation/refund (FR-013 / R-002).
//   The charge never silently vanishes — it is recorded in `payments` from
//   the moment the PI succeeded.
export async function handlePaymentIntentSucceeded(ctx: EventContext): Promise<void> {
  const pi = ctx.event.data.object as Stripe.PaymentIntent;

  // FR / Edge: USD only. A non-USD PI must never materialize a booking.
  if (pi.currency !== "usd") {
    logError("stripe-webhook: non-USD payment_intent rejected", new Error("non-usd"), {
      tag: "stripe-webhook", event_id: ctx.event.id, currency: pi.currency,
    });
    await markEvent(ctx, "failed", `non-usd currency: ${pi.currency}`);
    return;
  }

  const md = (pi.metadata ?? {}) as Record<string, string | undefined>;
  const bookingType = md.booking_type;
  const studentId = md.student_id;
  const teacherId = md.teacher_id;
  const specialty = md.specialty;
  const purpose = md.purpose;
  const targetScopeRaw = md.target_scope;
  const scheduledAt = md.scheduled_at ?? null;

  // Not a single-session payment at all: subscription-invoice PIs arrive here
  // with EMPTY metadata on every purchase (proven live 2026-07-19) and were
  // tainting the ledger as "failed". No booking key present → nothing of ours
  // to materialize → ignored. Partial metadata still fails loud below: that IS
  // a malformed single-session payment someone must look at.
  if (!bookingType && !studentId && !teacherId) {
    await markEvent(ctx, "ignored", "PI carries no single-session metadata (e.g. subscription invoice PI)");
    return;
  }

  if (!bookingType || !studentId || !teacherId) {
    await markEvent(
      ctx,
      "failed",
      `payment_intent.succeeded metadata incomplete: booking_type=${bookingType}, student_id=${studentId ? "set" : "missing"}, teacher_id=${teacherId ? "set" : "missing"}`,
    );
    return;
  }

  if (bookingType !== "assessment" && bookingType !== "instant" && bookingType !== "specialized") {
    await markEvent(ctx, "failed", `unknown booking_type in PI metadata: ${bookingType}`);
    return;
  }

  // ── PI-level idempotency sentinel ────────────────────────────────────────
  // A PI may be re-succeeded (e.g. retried capture) and emit the event with
  // a different event id while reusing the same `pi_...` id. The unique
  // stripe_event_id insert at the top of the handler dedups the exact event;
  // this sentinel dedups the PI itself so we never create two bookings for
  // one PI.
  const idempotencyKey = `pi_${pi.id}`;
  const { data: priorPi } = await ctx.admin
    .from("billing_events")
    .select("id")
    .eq("stripe_event_id", idempotencyKey)
    .maybeSingle<{ id: string }>();
  if (priorPi) {
    // A previous delivery of THIS PI inserted a sentinel. Verify it actually
    // completed — a sentinel left at "received" means a prior delivery crashed
    // mid-flight (or is concurrently in progress). Re-check the actual payment
    // state to decide: if the payment is linked to a booking, the prior
    // attempt truly succeeded; otherwise treat the sentinel as stale and
    // re-attempt. Without this recovery check, any transient failure after
    // sentinel insert would permanently block recovery (CodeRabbit #1).
    const { data: priorPayment } = await ctx.admin
      .from("payments")
      .select("id, booking_id")
      .eq("stripe_payment_intent", pi.id)
      .maybeSingle<{ id: string; booking_id: string | null }>();
    if (priorPayment?.booking_id) {
      await markEvent(ctx, "processed", `duplicate PI ${pi.id} — payment already linked to booking ${priorPayment.booking_id}`);
      return;
    }
    // Sentinel is stale (prior delivery crashed before linking the booking).
    // Release it so this delivery can re-attempt materialization. The UNIQUE
    // stripe_event_id on the original event row still prevents exact
    // redelivery from double-processing.
    await ctx.admin.from("billing_events").delete().eq("id", priorPi.id);
    // Fall through to re-attempt: insert a fresh sentinel owned by THIS delivery.
    const { error: reinsertErr } = await ctx.admin.from("billing_events").insert({
      stripe_event_id: idempotencyKey,
      event_type: "payment_intent.succeeded.pi",
      stripe_event_created: new Date(ctx.event.created * 1000).toISOString(),
      status: "received",
      payload: { pi_id: pi.id, booking_type: bookingType, student_id: studentId, recovered_from: priorPi.id } as unknown as Json,
    });
    if (reinsertErr) {
      if (reinsertErr.code === "23505") {
        // Lost the reinsert race with another concurrent recovery — let the other delivery own it.
        await markEvent(ctx, "processed", `duplicate PI ${pi.id} — reinsert race-lost`);
        return;
      }
      logError("stripe-webhook: PI sentinel reinsert failed", reinsertErr, {
        tag: "stripe-webhook", pi_id: pi.id,
      });
      await markEvent(ctx, "failed", "PI sentinel reinsert failed");
      return;
    }
  } else {
    // Insert the sentinel (UNIQUE stripe_event_id guarantees single-owner).
    const { error: sentinelErr } = await ctx.admin.from("billing_events").insert({
      stripe_event_id: idempotencyKey,
      event_type: "payment_intent.succeeded.pi",
      stripe_event_created: new Date(ctx.event.created * 1000).toISOString(),
      status: "received",
      payload: { pi_id: pi.id, booking_type: bookingType, student_id: studentId } as unknown as Json,
    });
    if (sentinelErr) {
      if (sentinelErr.code === "23505") {
        // Lost the race with a concurrent delivery of the same PI — another
        // worker owns the materialization. Safe no-op.
        await markEvent(ctx, "processed", `duplicate PI ${pi.id} — race-lost`);
        return;
      }
      logError("stripe-webhook: PI sentinel insert failed", sentinelErr, {
        tag: "stripe-webhook", pi_id: pi.id,
      });
      await markEvent(ctx, "failed", "PI sentinel insert failed");
      return;
    }
  }

  // ── Record the payment (always — even if booking creation later fails) ───
  // `payments.booking_id` starts NULL and is linked inside the atomic creator.
  // A failed creator leaves this row with booking_id NULL for reconciliation.
  const amountUsd = pi.amount_received != null ? pi.amount_received / 100 : 0;
  const { data: paymentRow, error: payErr } = await ctx.admin
    .from("payments")
    .insert({
      student_id: studentId,
      amount_usd: amountUsd,
      amount_before_tax: amountUsd,
      tax_amount: 0,
      tax_rate: 0,
      provider: "stripe",
      status: "succeeded",
      stripe_payment_intent: pi.id,
      paid_at: new Date(ctx.event.created * 1000).toISOString(),
    })
    .select("id")
    .maybeSingle<{ id: string }>();
  if (payErr || !paymentRow) {
    if (payErr?.code === "23505") {
      // A `payments.stripe_payment_intent` UNIQUE conflict means a prior
      // delivery already recorded this payment — reuse that row.
      const { data: existing } = await ctx.admin
        .from("payments")
        .select("id, booking_id")
        .eq("stripe_payment_intent", pi.id)
        .maybeSingle<{ id: string; booking_id: string | null }>();
      if (existing?.booking_id) {
        // Already linked → fully idempotent, nothing to do.
        await markEvent(ctx, "processed", `payment already linked to booking ${existing.booking_id}`);
        return;
      }
      if (!existing) {
        await markEvent(ctx, "failed", "payment UNIQUE conflict but no existing row");
        return;
      }
      // Payment exists but not linked — try to link via the creator below.
      // Capture the result so we finalize event status (CodeRabbit #2).
      const conflictResult = await materializeBooking(ctx, {
        paymentId: existing.id,
        bookingType,
        studentId,
        teacherId,
        specialty: specialty ?? null,
        purpose: (purpose as "review" | "consolidate_surah" | "memorize_mutoon" | "test_juz_mutashabihat" | null) ?? null,
        targetScopeRaw: targetScopeRaw ?? null,
        scheduledAt,
      });
      if (!conflictResult.ok) {
        // Release the sentinel so a future retry can re-attempt (CodeRabbit #1).
        await ctx.admin.from("billing_events").delete().eq("stripe_event_id", idempotencyKey);
        await markEvent(ctx, "failed", conflictResult.error);
        return;
      }
      await markEvent(ctx, "processed");
      return;
    }
    logError("stripe-webhook: payments insert failed", payErr, {
      tag: "stripe-webhook", pi_id: pi.id,
    });
    await markEvent(ctx, "failed", "payments insert failed");
    return;
  }

  const result = await materializeBooking(ctx, {
    paymentId: paymentRow.id,
    bookingType,
    studentId,
    teacherId,
    specialty: specialty ?? null,
    purpose: (purpose as "review" | "consolidate_surah" | "memorize_mutoon" | "test_juz_mutashabihat" | null) ?? null,
    targetScopeRaw: targetScopeRaw ?? null,
    scheduledAt,
  });
  if (!result.ok) {
    // Release the sentinel so a future retry of this PI can re-attempt
    // (CodeRabbit #1). The payments row stays with booking_id NULL for
    // reconciliation/refund per FR-013. The original event's UNIQUE
    // stripe_event_id still prevents exact-event redelivery from
    // double-processing.
    await ctx.admin.from("billing_events").delete().eq("stripe_event_id", idempotencyKey);
    await markEvent(ctx, "failed", result.error);
    return;
  }
  await markEvent(ctx, "processed");
}

// ── payment_intent.succeeded with product_type='prepaid_hours' → grant wallet (spec 038) ──
//
// Dispatched from the webhook route ONLY when the PI metadata carries
// `product_type=prepaid_hours` (set at /api/stripe/checkout/prepaid-hours).
// The single-session handler above is bypassed for these PIs so the two
// one-time-payment paths stay cleanly separated.
//
// H2 reconciliation — verify EVERY field that could drift between checkout and
// success BEFORE granting:
//   • currency = usd
//   • payment_status / status = succeeded (delayed-payment methods that land as
//     'processing' must NOT grant — they re-fire as 'succeeded' later)
//   • amount_received = hours × metadata.rate_usd × 100 (client-tamper guard)
//   • student_id is a valid UUID and the student profile exists (ownership)
//   • metadata is complete (product_type, student_id, hours, rate_usd)
//
// H1 idempotency: `grant_prepaid_hours` itself is idempotent on the Stripe
// PaymentIntent id (the DB UNIQUE partial index on student_packages.
// stripe_payment_intent_id). The route-level billing_events UNIQUE on
// event.id dedups exact redelivery; this handler does not need its own
// sentinel.
//
// NEVER grants without a matching pending record. Here the "pending record" is
// the Stripe Checkout Session + its server-stamped metadata (the same pattern
// the single-session handler uses). If the metadata is absent or malformed,
// the PI did not originate from our checkout route → fail-closed.
export async function handlePrepaidHoursGrant(ctx: EventContext): Promise<void> {
  const pi = ctx.event.data.object as Stripe.PaymentIntent;

  // FR / Edge: USD only.
  if (pi.currency !== "usd") {
    logError("stripe-webhook: prepaid_hours non-USD PI rejected", new Error("non-usd"), {
      tag: "stripe-webhook",
      event_id: ctx.event.id,
      currency: pi.currency,
    });
    await markEvent(ctx, "failed", `non-usd currency: ${pi.currency}`);
    return;
  }

  // H2: only grant on a truly succeeded PI. A PI in `processing` (async method)
  // must wait — Stripe re-fires payment_intent.succeeded when it settles.
  if (pi.status !== "succeeded") {
    await markEvent(ctx, "ignored", `pi status not succeeded: ${pi.status}`);
    return;
  }

  const md = (pi.metadata ?? {}) as Record<string, string | undefined>;
  const productType = md.product_type;
  const studentIdRaw = md.student_id;
  const hoursRaw = md.hours;
  const rateUsdRaw = md.rate_usd;

  if (productType !== "prepaid_hours") {
    await markEvent(ctx, "failed", `prepaid handler called with wrong product_type: ${productType}`);
    return;
  }

  // Metadata completeness (H2 pending-record shape).
  if (!studentIdRaw || !hoursRaw || !rateUsdRaw) {
    await markEvent(ctx, "failed", "prepaid_hours PI metadata incomplete");
    return;
  }

  // student_id shape — fail fast on malformed.
  const studentIdParsed = z.uuid().safeParse(studentIdRaw);
  if (!studentIdParsed.success) {
    await markEvent(ctx, "failed", `prepaid_hours PI metadata student_id not a uuid: ${studentIdRaw}`);
    return;
  }
  const studentId = studentIdParsed.data;

  const hours = Number(hoursRaw);
  const rateUsd = Number(rateUsdRaw);
  if (!Number.isInteger(hours) || hours <= 0 || !Number.isFinite(rateUsd) || rateUsd <= 0) {
    await markEvent(ctx, "failed", `prepaid_hours PI metadata numeric fields invalid: hours=${hoursRaw}, rate=${rateUsdRaw}`);
    return;
  }

  // H2 amount reconciliation (fail-closed on tampering). pi.amount_received is
  // in cents; the expected total is hours × per-hour rate × 100. A 1-cent
  // mismatch is rejected — the checkout route rounds cleanly so any drift is a
  // real discrepancy, not a rounding artifact.
  const expectedAmountCents = Math.round(hours * rateUsd * 100);
  const receivedCents = pi.amount_received ?? 0;
  if (receivedCents !== expectedAmountCents) {
    logError(
      "stripe-webhook: prepaid_hours amount mismatch (tamper/price-change)",
      new Error("amount-mismatch"),
      {
        tag: "stripe-webhook",
        event_id: ctx.event.id,
        pi_id: pi.id,
        expected_cents: expectedAmountCents,
        received_cents: receivedCents,
      },
    );
    await markEvent(
      ctx,
      "failed",
      `amount mismatch: expected ${expectedAmountCents}, received ${receivedCents}`,
    );
    return;
  }

  // H2 ownership: the student_id stamped at checkout must resolve to a real
  // profile. The metadata was set by OUR checkout route and signature-verified
  // by Stripe, so a bogus id here means either a deleted account or a
  // misconfiguration — fail-closed either way. We do NOT auto-create accounts.
  const { data: profile, error: profileErr } = await ctx.admin
    .from("profiles")
    .select("id, role")
    .eq("id", studentId)
    .maybeSingle<{ id: string; role: string | null }>();
  if (profileErr) {
    logError("stripe-webhook: prepaid_hours profile lookup failed", profileErr, {
      tag: "stripe-webhook",
      pi_id: pi.id,
      student_id: studentId,
    });
    await markEvent(ctx, "failed", "profile lookup failed");
    return;
  }
  if (!profile) {
    await markEvent(ctx, "failed", `no profile for student_id ${studentId} — cannot grant`);
    return;
  }
  if (profile.role !== "student") {
    await markEvent(ctx, "failed", `student_id ${studentId} role is ${profile.role}, not student`);
    return;
  }

  // H1 idempotent grant: the DB function inserts a NEW lot keyed on
  // stripe_payment_intent_id (UNIQUE); a redelivery returns the existing lot
  // id without appending a duplicate grant event. We pass the FROZEN rate from
  // metadata (R1) — never a re-read of the current setting.
  const { data: lotId, error: grantErr } = await ctx.admin.rpc("grant_prepaid_hours", {
    p_payment_intent: pi.id,
    p_student: studentId,
    p_hours: hours,
    p_rate: rateUsd,
    p_provider: "stripe",
  });

  if (grantErr || !lotId) {
    logError("stripe-webhook: grant_prepaid_hours RPC failed", grantErr ?? new Error("no id"), {
      tag: "stripe-webhook",
      pi_id: pi.id,
      student_id: studentId,
      hours,
      rate_usd: rateUsd,
    });
    throw new WebhookTransientError(
      grantErr?.message ?? "grant_prepaid_hours returned no id",
    );
  }

  // Record the payment row for audit (mirrors single-session: payments is the
  // money audit trail). Idempotent on stripe_payment_intent (UNIQUE) so a
  // redelivery that re-runs this handler (rare — billing_events dedups first)
  // is a no-op. A failure here is NOT silently swallowed: if the audit row
  // can't be written, the event is marked failed so Stripe retries — losing
  // the audit trail is worse than a retry.
  const { error: payErr } = await ctx.admin.from("payments").upsert(
    {
      student_id: studentId,
      amount_usd: receivedCents / 100,
      amount_before_tax: receivedCents / 100,
      tax_amount: 0,
      tax_rate: 0,
      provider: "stripe",
      status: "succeeded",
      stripe_payment_intent: pi.id,
      paid_at: new Date(ctx.event.created * 1000).toISOString(),
    },
    { onConflict: "stripe_payment_intent", ignoreDuplicates: true },
  );
  if (payErr) {
    logError("stripe-webhook: prepaid_hours payments audit upsert failed", payErr, {
      tag: "stripe-webhook",
      pi_id: pi.id,
      student_id: studentId,
    });
    throw new WebhookTransientError(`payments upsert failed: ${payErr.message}`);
  }

  logInfo("stripe-webhook: prepaid_hours granted", {
    tag: "stripe-webhook",
    pi_id: pi.id,
    student_id: studentId,
    lot_id: lotId as string,
    hours,
    rate_usd: rateUsd,
  });

  await markEvent(ctx, "processed");
}

// ── Fix #2: subscription refund → revoke unused sessions + cancel the plan ───
//
// A FULLY-refunded subscription invoice charge means the student's money was
// returned, so per owner decision we take back their UNUSED sessions and cancel
// the subscription ("we're done here"). Attended sessions are untouched:
// `sessions_used` and the confirmed bookings are history; we only flip the
// still-`active` grants to `cancelled` so their remaining capacity can no longer
// be booked or debited (both selectActivePackage and the confirm-time deduct
// trigger filter status='active').
//
// Scope guards:
//   • Only subscription charges (charge.invoice present) — prepaid one-time
//     charges carry no invoice and are handled by the reconcile path.
//   • Only FULL refunds (charge.refunded) — a partial refund leaves sessions +
//     plan intact and is logged.
//
// Redelivery-safe: charge.refunded re-delivers the cumulative refunds list, and
// every step converges to the same end state — the payment flip is by-PI, the
// revoke carries `WHERE status='active'`, the mirror flip carries
// `WHERE status != 'canceled'`, and the Stripe cancel treats an already-cancelled
// subscription as success.
export async function revokeAndCancelOnSubscriptionRefund(
  ctx: EventContext,
  charge: Stripe.Charge,
): Promise<void> {
  if (!charge.refunded) {
    // Partial refund — owner decision is full-refund-only. Leave everything
    // intact; surface it so a partial refund is never silently a no-op.
    logInfo("stripe-webhook: partial refund — subscription sessions + plan left intact", {
      tag: "billing",
      charge_id: charge.id,
      amount: charge.amount,
      amount_refunded: charge.amount_refunded,
    });
    return;
  }

  const piId = typeof charge.payment_intent === "string" ? charge.payment_intent : null;
  if (!piId) return;

  // Route locally by the charge's payment intent — dahlia charges carry no
  // invoice link. The subscription cycle grant records the PI on
  // `stripe_payment_intent_id` (and, unlike prepaid lots, a `subscription_id`);
  // prepaid one-off refunds are handled by the reconcile path above.
  const { data: grant, error: grantErr } = await ctx.admin
    .from("student_packages")
    .select("subscription_id")
    .eq("stripe_payment_intent_id", piId)
    .not("subscription_id", "is", null)
    .limit(1)
    .maybeSingle<{ subscription_id: string | null }>();
  if (grantErr) {
    throw new WebhookTransientError(`refund: subscription grant lookup failed: ${grantErr.message}`);
  }
  if (!grant?.subscription_id) return; // not a subscription charge we granted
  const subscriptionId = grant.subscription_id;

  // 1. Flip the payment to refunded (idempotent on the PI; piId is non-null here).
  //    Independent of the mirror: a fully-refunded charge must reconcile locally
  //    even when the subscription can't be mapped to a Stripe id.
  const { error: payErr } = await ctx.admin
    .from("payments")
    .update({ status: "refunded" })
    .eq("stripe_payment_intent", piId);
  if (payErr) throw new WebhookTransientError(`refund: payment flip failed: ${payErr.message}`);

  // 2. Revoke UNUSED capacity: flip this subscription's still-active grants to
  //    'cancelled'. sessions_used + confirmed bookings (attended lessons) are
  //    untouched. WHERE status='active' makes this a no-op on redelivery.
  const { error: revokeErr } = await ctx.admin
    .from("student_packages")
    .update({ status: "cancelled" })
    .eq("subscription_id", subscriptionId)
    .eq("status", "active");
  if (revokeErr) throw new WebhookTransientError(`refund: session revoke failed: ${revokeErr.message}`);

  // 3. Cancel the subscription in Stripe. Needs the mirror's stripe_subscription_id;
  //    if the mirror can't be mapped, local records are ALREADY reconciled above —
  //    log and stop rather than silently drop the reversal.
  const { data: mirror, error: mirrorErr } = await ctx.admin
    .from("subscriptions")
    .select("stripe_subscription_id, status")
    .eq("id", subscriptionId)
    .maybeSingle<{ stripe_subscription_id: string; status: string }>();
  if (mirrorErr) {
    throw new WebhookTransientError(`refund: subscription mirror lookup failed: ${mirrorErr.message}`);
  }
  if (!mirror?.stripe_subscription_id) {
    logError("stripe-webhook: refunded subscription grant has no mirror — reconciled locally, not cancelled at Stripe", new Error("no mirror"), {
      tag: "billing",
      subscription_id: subscriptionId,
      charge_id: charge.id,
    });
    return;
  }
  const stripeSubId = mirror.stripe_subscription_id;

  //    Idempotent: an already-cancelled sub (e.g. the admin cancelled in the
  //    dashboard first) is treated as success, never a permanent 500.
  try {
    await ctx.stripe.subscriptions.cancel(stripeSubId);
  } catch (err) {
    const code = (err as { code?: string; statusCode?: number })?.code;
    const status = (err as { statusCode?: number })?.statusCode;
    const alreadyGone =
      code === "resource_missing" ||
      status === 404 ||
      /no such subscription|already canceled/i.test(err instanceof Error ? err.message : "");
    if (!alreadyGone) {
      throw new WebhookTransientError(
        `refund: stripe subscription cancel failed: ${err instanceof Error ? err.message : "unknown"}`,
      );
    }
    logInfo("stripe-webhook: refund cancel — subscription already cancelled at Stripe", {
      tag: "billing",
      stripe_subscription_id: stripeSubId,
    });
  }

  // 4. Reflect the cancellation on the mirror immediately (the async
  //    customer.subscription.deleted will also land, idempotently).
  const { error: subFlipErr } = await ctx.admin
    .from("subscriptions")
    .update({ status: "canceled" })
    .eq("id", subscriptionId)
    .neq("status", "canceled");
  if (subFlipErr) throw new WebhookTransientError(`refund: mirror status flip failed: ${subFlipErr.message}`);

  logInfo("stripe-webhook: subscription refund processed — sessions revoked + plan cancelled", {
    tag: "billing",
    subscription_id: subscriptionId,
    stripe_subscription_id: stripeSubId,
    charge_id: charge.id,
  });
}

// ── charge.refunded → finalize admin refund saga OR reconcile external (spec 038 R8/H5) ──
//
// Two paths in one handler:
//   • Admin saga: the refund object's metadata carries `refund_request_id` (set
//     by the T5.4 admin action that called stripe.refunds.create with
//     idempotency_key = refund_request_id). We finalize the pending
//     prepaid_refund_requests row → status='succeeded' + 'refunded' ledger event.
//     Hours were already voided at reserve; finalize is bookkeeping.
//   • H5 external: no refund_request_id in metadata → a Stripe-dashboard refund
//     or other out-of-band reversal. If the PI maps to a prepaid_hours lot, we
//     void that lot's still-remaining hours via reconcile_external_prepaid_refund
//     so the wallet cannot stay spendable after money is reversed.
//
// Idempotency: finalize is a no-op on already-succeeded requests; reconcile is a
// no-op on lots with 0 remaining. The route-level billing_events UNIQUE on
// event.id dedups exact redelivery.
export async function handleChargeRefunded(ctx: EventContext): Promise<void> {
  const charge = ctx.event.data.object as Stripe.Charge;

  // FR / Edge: USD only.
  if (charge.currency !== "usd") {
    logError("stripe-webhook: charge.refunded non-USD rejected", new Error("non-usd"), {
      tag: "stripe-webhook",
      event_id: ctx.event.id,
      currency: charge.currency,
    });
    await markEvent(ctx, "failed", `non-usd currency: ${charge.currency}`);
    return;
  }

  const piId = typeof charge.payment_intent === "string" ? charge.payment_intent : null;
  const refunds = charge.refunds?.data ?? [];

  if (refunds.length === 0) {
    await markEvent(ctx, "ignored", "charge.refunded with no refund objects");
    return;
  }

  // Walk every refund on this charge. Redelivery safety: finalize/reconcile are
  // both idempotent, so processing a refund twice is a no-op.
  for (const refund of refunds) {
    const refundMd = (refund.metadata ?? {}) as Record<string, string | undefined>;
    const requestId = refundMd.refund_request_id;

    // Single-session admin refund: correlate via refund_kind + finalize, then
    // emit booking.cancelled (post-commit, fail-soft) if the booking was cancelled.
    if (refundMd.refund_kind === "single_session" && requestId) {
      const { data, error } = await ctx.admin.rpc("finalize_single_session_refund", {
        p_refund_request_id: requestId,
        p_stripe_ref: refund.id,
      });
      const result = data as {
        did_cancel?: boolean;
        booking_id?: string;
        student_id?: string;
        teacher_id?: string;
      } | null;
      if (error) {
        // Match the sibling prepaid paths: a 500 makes Stripe redeliver so the
        // refund is finalized. Swallowing + markEvent("processed") would strand it.
        throw new WebhookTransientError(`finalize single-session: ${error.message}`);
      } else if (result?.did_cancel && result.booking_id) {
        emitEvent("booking.cancelled", "booking", result.booking_id, {
          student_id: result.student_id,
          teacher_id: result.teacher_id,
        }).catch((e) => logError("emit booking.cancelled failed", e, { tag: "billing" }));
      }
      continue; // handled — do not fall through to prepaid/H5
    }

    if (requestId) {
      // Admin saga (T5.1/T5.2). Finalize.
      const { error } = await ctx.admin.rpc("finalize_prepaid_refund", {
        p_refund_request_id: requestId,
        p_stripe_ref: refund.id,
      });
      if (error) {
        logError("stripe-webhook: finalize_prepaid_refund failed", error, {
          tag: "stripe-webhook",
          refund_request_id: requestId,
        });
        throw new WebhookTransientError(`finalize ${requestId}: ${error.message}`);
      }
      continue;
    }

    // H5 external: no refund_request_id. Reconcile only if this is a prepaid lot.
    if (piId) {
      const { data: lot, error: lotErr } = await ctx.admin
        .from("student_packages")
        .select("id")
        .eq("stripe_payment_intent_id", piId)
        .eq("product_type", "prepaid_hours")
        .maybeSingle<{ id: string }>();
      if (lotErr) {
        // Transient lookup failure must NOT be treated as "no lot" — that
        // would leave the wallet spendable. THROW so the dispatch 500s and
        // Stripe actually redelivers (a 200 would dead-end the event).
        logError("stripe-webhook: charge.refunded prepaid-lot lookup failed", lotErr, {
          tag: "stripe-webhook",
          pi_id: piId,
        });
        throw new WebhookTransientError(`prepaid lot lookup: ${lotErr.message}`);
      }
      if (lot) {
        const { error } = await ctx.admin.rpc("reconcile_external_prepaid_refund", {
          p_payment_intent: piId,
        });
        if (error) {
          logError("stripe-webhook: reconcile_external_prepaid_refund failed", error, {
            tag: "stripe-webhook",
            pi_id: piId,
          });
          throw new WebhookTransientError(`reconcile external: ${error.message}`);
        }
      }

      // H5 (single-session): a Stripe-dashboard refund carries no request id.
      // reconcile_external_single_session_refund no-ops unless the PI maps to a
      // single-session (student_package_id IS NULL) stripe booking.
      const { data, error } = await ctx.admin.rpc("reconcile_external_single_session_refund", {
        p_payment_intent: piId,
      });
      const result = data as {
        did_cancel?: boolean;
        booking_id?: string;
        student_id?: string;
        teacher_id?: string;
      } | null;
      if (error) {
        throw new WebhookTransientError(`reconcile external single-session: ${error.message}`);
      } else if (result?.did_cancel && result.booking_id) {
        emitEvent("booking.cancelled", "booking", result.booking_id, {
          student_id: result.student_id,
          teacher_id: result.teacher_id,
        }).catch((e) => logError("emit booking.cancelled failed", e, { tag: "billing" }));
      }
    }
  }

  // ── Fix #2: subscription-side revocation (student) ────────────────────────
  // A full refund of a subscription invoice charge revokes the student's unused
  // sessions and cancels the plan. No-op for prepaid/one-off charges (no invoice)
  // and for partial refunds. Fail-closed: throws → dispatch 500s → Stripe retries.
  await revokeAndCancelOnSubscriptionRefund(ctx, charge);

  // ── Spec 040 FR-013/014: teacher clawback (Connect ledger) ────────────────
  // After the student-side prepaid path, reverse the teacher's share of each
  // refund proportionally. One shared root-cause path (plan Phase 3): the
  // clawback module is idempotent per (refund, entry) in the DB, so walking
  // the cumulative refunds list Stripe re-delivers on every charge.refunded
  // is replay-safe. Dormant until entries carry funding_charge_id (FR-021).
  for (const refund of refunds) {
    try {
      await applyChargeClawbacks(ctx, {
        chargeId: charge.id,
        paymentIntentId: paymentIntentIdOf(charge.payment_intent),
        sourceReferenceId: refund.id,
        reclaimedCents: refund.amount,
        chargeAmountCents: charge.amount,
        source: "refund",
      });
    } catch (err) {
      // RETHROW (CodeRabbit critical): marking failed and returning would let
      // the dispatcher 200 and Stripe would never redeliver — a dead-ended
      // money path. The dispatch catch marks the event failed and 500s.
      logError("stripe-webhook: teacher clawback failed", err, {
        tag: "stripe-webhook",
        charge_id: charge.id,
        refund_id: refund.id,
      });
      throw err;
    }
  }

  await markEvent(ctx, "processed");
}

// ── charge.dispute.created → H5 external reversal (chargeback) ────────────────
//
// A dispute/chargeback reverses money (provisionally) outside our admin saga.
// If the disputed PI maps to a prepaid_hours lot, void its remaining hours via
// reconcile_external_prepaid_refund. We do NOT un-void if the dispute is later
// won — the merchant would re-grant manually (out of scope here). Only
// `charge.dispute.created` triggers the void; `.updated`/`.funds_reinstated`
// stay informational/ignored, while `.closed` now routes to
// handleChargeDisputeClosed (spec 040 FR-015 — teacher side only).
//
// Spec 040 FR-015 (teacher side): before any student-side logic, every
// pending/manual_due Connect entry funded by the disputed charge moves to
// held — SC-005's one-webhook-delivery latency — so no sweep can pay a
// disputed entry. Dormant until entries carry funding_charge_id (FR-021).
export async function handleChargeDisputed(ctx: EventContext): Promise<void> {
  const dispute = ctx.event.data.object as Stripe.Dispute;

  if (dispute.currency !== "usd") {
    logError("stripe-webhook: charge.dispute non-USD ignored", new Error("non-usd"), {
      tag: "stripe-webhook",
      event_id: ctx.event.id,
      currency: dispute.currency,
    });
    await markEvent(ctx, "ignored", `non-usd dispute: ${dispute.currency}`);
    return;
  }

  const disputedChargeId = disputeChargeId(dispute);
  const disputedPaymentIntentId = paymentIntentIdOf(dispute.payment_intent);
  // Entries stamp pi_ refs (materialization migration 20260809), so a dispute
  // resolving ONLY a payment_intent must still place the hold (review P3).
  if (disputedChargeId || disputedPaymentIntentId) {
    try {
      await holdDisputedEntries(ctx, disputedChargeId, disputedPaymentIntentId, dispute.id);
    } catch (err) {
      // RETHROW — same money-path rule as the refund clawback above: the
      // dispatch catch marks failed + 500 so Stripe redelivers the hold.
      logError("stripe-webhook: dispute hold failed", err, {
        tag: "stripe-webhook",
        charge_id: disputedChargeId,
        dispute_id: dispute.id,
      });
      throw err;
    }
  }

  const piId = typeof dispute.payment_intent === "string" ? dispute.payment_intent : null;
  if (!piId) {
    // The FR-015 hold above already ran; 'ignored' describes the student-side
    // prepaid outcome only.
    await markEvent(ctx, "ignored", "dispute has no payment_intent");
    return;
  }

  // Only void if this is actually a prepaid lot — avoids a no-op RPC (and the
  // log noise) for non-prepaid disputes that route through this handler.
  const { data: lot, error: lotErr } = await ctx.admin
    .from("student_packages")
    .select("id")
    .eq("stripe_payment_intent_id", piId)
    .eq("product_type", "prepaid_hours")
    .maybeSingle<{ id: string }>();
  if (lotErr) {
    // Transient lookup failure must NOT be treated as "no lot" — that would
    // leave the wallet spendable through the dispute. THROW so the dispatch
    // 500s and Stripe actually redelivers.
    logError("stripe-webhook: dispute prepaid-lot lookup failed", lotErr, {
      tag: "stripe-webhook",
      pi_id: piId,
    });
    throw new WebhookTransientError(`dispute lot lookup: ${lotErr.message}`);
  }
  if (!lot) {
    await markEvent(ctx, "processed", "dispute not on a prepaid lot; ignored");
    return;
  }

  const { error } = await ctx.admin.rpc("reconcile_external_prepaid_refund", {
    p_payment_intent: piId,
  });
  if (error) {
    logError("stripe-webhook: dispute reconcile failed", error, {
      tag: "stripe-webhook",
      pi_id: piId,
    });
    throw new WebhookTransientError(`dispute reconcile: ${error.message}`);
  }

  await markEvent(ctx, "processed");
}

/**
 * Call the appropriate atomic creator to materialize the booking. The creator
 * also links `payments.booking_id` in the SAME transaction. Returns
 * `{ ok: false, error }` on failure — the caller leaves the `payments` row
 * intact with `booking_id` NULL for reconciliation/refund (FR-013).
 */
async function materializeBooking(
  ctx: EventContext,
  args: {
    paymentId: string;
    bookingType: "assessment" | "instant" | "specialized";
    studentId: string;
    teacherId: string;
    specialty: string | null;
    purpose: "review" | "consolidate_surah" | "memorize_mutoon" | "test_juz_mutashabihat" | null;
    targetScopeRaw: string | null;
    scheduledAt: string | null;
  },
): Promise<{ ok: true } | { ok: false; error: string }> {
  const admin = ctx.admin;

  if (args.bookingType === "instant") {
    // Instant path: adapted start_instant_session_booking with p_payment_id.
    const effectiveScheduledAt = args.scheduledAt ?? new Date().toISOString();
    const { data: bookingId, error: rpcErr } = await admin.rpc(
      "start_instant_session_booking",
      {
        p_student_id: args.studentId,
        p_teacher_id: args.teacherId,
        p_session_type: "hifz" as const,
        p_duration_min: 30,
        p_rate_snapshot: 0,
        p_amount_usd: 0,
        p_scheduled_at: effectiveScheduledAt,
        p_payment_id: args.paymentId,
      },
    );
    if (rpcErr || !bookingId) {
      logError("single-session webhook: instant creator failed", rpcErr ?? new Error("no id"), {
        tag: "stripe-webhook", pi_id_hint: args.paymentId, booking_type: "instant",
      });
      return { ok: false, error: rpcErr?.message ?? "instant creator returned no id" };
    }
    const dateLabel = new Date(effectiveScheduledAt).toLocaleDateString("ar");
    await Promise.allSettled([
      dispatchEffects("booking.created", {
        teacherId: args.teacherId,
        entityId: bookingId as string,
        dateLabel,
      }),
      emitEvent("booking.created", "booking", bookingId as string, {
        student_id: args.studentId,
        teacher_id: args.teacherId,
        session_type: "hifz",
        scheduled_at: effectiveScheduledAt,
      }).catch((err) =>
        logError("single-session webhook: emit booking.created failed", err, {
          tag: "stripe-webhook", booking_type: "instant",
        }),
      ),
    ]);
    return { ok: true };
  }

  // assessment / specialized: atomic create_single_session_booking.
  let targetScopeJson: unknown = null;
  if (args.targetScopeRaw) {
    try {
      targetScopeJson = JSON.parse(args.targetScopeRaw);
    } catch {
      return { ok: false, error: "target_scope metadata is not valid JSON" };
    }
  }

  const { data: bookingId, error: rpcErr } = await admin.rpc(
    "create_single_session_booking",
    {
      p_student_id: args.studentId,
      p_teacher_id: args.teacherId,
      p_booking_product_type: args.bookingType,
      p_payment_id: args.paymentId,
      p_specialty: args.specialty ?? undefined,
      p_purpose: args.purpose ?? undefined,
      p_target_scope: targetScopeJson as never,
    },
  );
  if (rpcErr || !bookingId) {
    logError("single-session webhook: creator failed", rpcErr ?? new Error("no id"), {
      tag: "stripe-webhook", payment_id: args.paymentId, booking_type: args.bookingType,
    });
    // Recovery path (FR-013): leave the payments row with booking_id NULL.
    return { ok: false, error: rpcErr?.message ?? "creator returned no id" };
  }
  return { ok: true };
}
