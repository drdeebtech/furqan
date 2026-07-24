import { NextResponse } from "next/server";
import type Stripe from "stripe";
import { z } from "zod";
import { createAdminClient } from "@/lib/supabase/admin";
import { emitEvent } from "@/lib/automation/emit";
import {
  markEvent,
  ingestBillingEvent,
  WebhookTransientError,
  revokeAndCancelOnSubscriptionRefund,
} from "@/lib/domains/billing/webhook-handlers";
import { BillingEvents } from "@/lib/domains/billing/events";
import { buildCycleKey, grantCycle } from "@/lib/domains/billing/orchestrate";
import { getActivePlanByCode } from "@/lib/domains/billing/plans";
import {
  shouldApplyEvent,
  upsertMirror,
  type StripeSubscriptionSnapshot,
} from "@/lib/domains/billing/subscriptions";
import { logError, logInfo } from "@/lib/logger";
import {
  cancelPayPalSubscription,
  getPayPalSubscription,
  isPayPalWebhookConfigured,
  verifyPayPalWebhookSignature,
} from "@/lib/paypal/client";
import {
  grantPaypalPrepaidCapture,
  grantPaypalSingleSessionCapture,
  parseRefundCaptureId,
} from "@/lib/paypal/grant";
import { parseSubscriptionCustomId } from "@/lib/paypal/subscription-custom-id";

export const maxDuration = 60;

/**
 * POST /api/paypal/webhook — signature-verified PayPal ingestion (spec 039 2b).
 *
 * Mirrors /api/stripe/webhook exactly in posture:
 *   1. config gate → 503 if PAYPAL_WEBHOOK_ID missing
 *   2. raw body + signature verify → 400 on failure, ZERO side effects
 *   3. billing_events idempotency ledger (UNIQUE stripe_event_id stores the
 *      PayPal event id; provider='paypal') → 200 duplicate on redelivery
 *   4. dispatch by event_type:
 *        PAYMENT.CAPTURE.COMPLETED → grantPaypalPrepaidCapture
 *        PAYMENT.CAPTURE.REFUNDED/DENIED/REVERSED → ignored (later phase)
 *        default → ignored
 *   5. always 200 {received:true} so PayPal stops retrying (except 503/400)
 *
 * The money grant is idempotent on student_packages.provider_payment_ref
 * (the capture id), proven in walk_2b.sql — this ledger is the fast dedup +
 * audit trail, not the source of truth for the grant.
 */

// ── Event shape (zod at the boundary) ────────────────────────────────────────
// We only validate the fields we actually read; the full payload is stored
// verbatim in billing_events.payload for audit. `.passthrough()` keeps every
// PayPal field so the audit row is complete.
const PaypalEventSchema = z
  .object({
    id: z.string(),
    event_type: z.string(),
    create_time: z.string().optional(),
    resource: z.unknown().optional(),
  })
  .passthrough();

/** Capture resource shape for PAYMENT.CAPTURE.COMPLETED. */
const CaptureResourceSchema = z
  .object({
    id: z.string(),
    amount: z.object({ value: z.string() }).optional(),
    custom_id: z.string().nullable().optional(),
    // PayPal stamps the originating ORDER id here on a capture event; used only
    // for the payments audit row (optional — absence just skips that row).
    supplementary_data: z
      .object({
        related_ids: z.object({ order_id: z.string().optional() }).optional(),
      })
      .optional(),
  })
  .passthrough();

/**
 * Refund / reversal resource (PAYMENT.CAPTURE.REFUNDED / .REVERSED). `id` here
 * is the REFUND id — the ORIGINAL capture id (our idempotency key /
 * provider_payment_ref) lives on the `rel="up"` HATEOAS link.
 */
const RefundResourceSchema = z
  .object({
    id: z.string().optional(),
    links: z.array(z.object({ href: z.string(), rel: z.string() })).optional(),
  })
  .passthrough();

/** PayPal subscription resource shape for BILLING.SUBSCRIPTION.* events. */
const SubscriptionResourceSchema = z
  .object({
    id: z.string().optional(),
    billing_agreement_id: z.string().optional(),
  })
  .passthrough();

/** Money event resource for PAYMENT.SALE.COMPLETED. */
const SaleCompletedResourceSchema = z
  .object({
    id: z.string(),
    billing_agreement_id: z.string(),
    amount: z.object({
      total: z.string(),
      currency: z.string().optional(),
      currency_code: z.string().optional(),
    }),
  })
  .passthrough();

/** Money reversal resource for PAYMENT.SALE.REFUNDED. */
const SaleRefundedResourceSchema = z
  .object({
    id: z.string().optional(),
    sale_id: z.string().optional(),
    billing_agreement_id: z.string().optional(),
    amount: z
      .object({
        total: z.string().optional(),
        currency: z.string().optional(),
        currency_code: z.string().optional(),
      })
      .optional(),
    links: z.array(z.object({ href: z.string(), rel: z.string() })).optional(),
  })
  .passthrough();

interface CompletedCapture {
  captureId: string;
  amountUsd: number;
  customId: string;
  orderId: string | null;
}

type AdminClient = ReturnType<typeof createAdminClient>;
type PaypalEvent = z.infer<typeof PaypalEventSchema>;

type PaypalEventStatus =
  | "active"
  | "past_due"
  | "canceled";

interface PaypalMirrorRow {
  id: string;
  student_id: string;
  plan_id: string;
  last_event_at: string;
}

function paypalEventCreatedMs(event: PaypalEvent): number {
  const parsed = event.create_time ? Date.parse(event.create_time) : NaN;
  return Number.isFinite(parsed) ? parsed : Date.now();
}

function amountStringToCents(amount: string): number | null {
  if (!/^(?:0|[1-9]\d*)(?:\.\d{1,2})?$/.test(amount)) return null;
  const [dollarsRaw, centsRaw = ""] = amount.split(".");
  const dollars = Number(dollarsRaw);
  const cents = Number(centsRaw.padEnd(2, "0"));
  if (!Number.isSafeInteger(dollars) || !Number.isSafeInteger(cents)) return null;
  const total = dollars * 100 + cents;
  return Number.isSafeInteger(total) && total > 0 ? total : null;
}

function amountCurrency(amount: { currency?: string; currency_code?: string }): string | null {
  return (amount.currency ?? amount.currency_code ?? null)?.toUpperCase() ?? null;
}

function normalizeIso(value: string | null): string | null {
  if (!value) return null;
  const ms = Date.parse(value);
  return Number.isFinite(ms) ? new Date(ms).toISOString() : null;
}

async function validateStudentProfile(
  admin: AdminClient,
  studentId: string,
): Promise<{ ok: true } | { ok: false; reason: string; retryable: boolean }> {
  const { data: profile, error: profileErr } = await admin
    .from("profiles")
    .select("id, role")
    .eq("id", studentId)
    .maybeSingle<{ id: string; role: string | null }>();
  if (profileErr) {
    logError("paypal-webhook: profile lookup failed", profileErr, {
      tag: "paypal-webhook",
      student_id: studentId,
    });
    return { ok: false, reason: "profile lookup failed", retryable: true };
  }
  if (!profile) {
    return { ok: false, reason: `no profile for student_id ${studentId}`, retryable: false };
  }
  if (profile.role !== "student") {
    return {
      ok: false,
      reason: `student_id ${studentId} role is ${profile.role}, not student`,
      retryable: false,
    };
  }
  return { ok: true };
}

async function readPaypalMirror(
  admin: AdminClient,
  subscriptionId: string,
): Promise<PaypalMirrorRow | null> {
  const { data, error } = await admin
    .from("subscriptions")
    .select("id, student_id, plan_id, last_event_at")
    .eq("provider", "paypal")
    .eq("provider_subscription_id", subscriptionId)
    .maybeSingle<PaypalMirrorRow>();
  if (error) {
    throw new WebhookTransientError(`paypal mirror lookup failed: ${error.message}`);
  }
  return data ?? null;
}

async function paypalSnapshotFromSubscription(
  admin: AdminClient,
  subscriptionId: string,
  status: PaypalEventStatus,
  eventCreatedMs: number,
): Promise<
  | { ok: true; snap: StripeSubscriptionSnapshot }
  | { ok: false; reason: string; retryable: boolean }
> {
  let subscription: Awaited<ReturnType<typeof getPayPalSubscription>>;
  try {
    subscription = await getPayPalSubscription(subscriptionId);
  } catch (err) {
    logError("paypal-webhook: get subscription failed", err, {
      tag: "paypal-webhook",
      subscription_id: subscriptionId,
    });
    throw new WebhookTransientError(`paypal subscription retrieve failed: ${subscriptionId}`);
  }

  if (!subscription.customId) {
    return { ok: false, reason: "subscription missing custom_id", retryable: false };
  }
  const parsed = parseSubscriptionCustomId(subscription.customId);
  if (
    !parsed ||
    (parsed.productType !== "subscription" && parsed.productType !== "subscription_upgrade")
  ) {
    return { ok: false, reason: "bad subscription custom_id", retryable: false };
  }

  const plan = await getActivePlanByCode(admin, parsed.planCode);
  if (!plan) {
    return { ok: false, reason: `plan not found: ${parsed.planCode}`, retryable: false };
  }

  const profile = await validateStudentProfile(admin, parsed.studentId);
  if (!profile.ok) return profile;

  return {
    ok: true,
    snap: {
      provider: "paypal",
      providerSubscriptionId: subscriptionId,
      providerCustomerId: null,
      stripeSubscriptionId: subscriptionId,
      stripeCustomerId: "",
      status,
      currentPeriodStart: normalizeIso(subscription.currentPeriodStart),
      currentPeriodEnd: normalizeIso(subscription.currentPeriodEnd),
      cancelAtPeriodEnd: false,
      eventCreatedSeconds: Math.floor(eventCreatedMs / 1000),
      studentId: parsed.studentId,
      planId: plan.id,
    },
  };
}

function subscriptionIdFromEvent(event: PaypalEvent): string | null {
  const parsed = SubscriptionResourceSchema.safeParse(event.resource);
  if (!parsed.success) return null;
  return parsed.data.id ?? parsed.data.billing_agreement_id ?? null;
}

async function handleSingleSessionCapture(
  admin: ReturnType<typeof createAdminClient>,
  eventId: string,
  billingEventId: string | null,
  capture: CompletedCapture,
): Promise<{ retryable: boolean }> {
  const grant = await grantPaypalSingleSessionCapture(admin, {
    captureId: capture.captureId,
    amountUsd: capture.amountUsd,
    customId: capture.customId,
    orderId: capture.orderId,
  });
  if (grant.ok) {
    logInfo("paypal-webhook: single_session granted", {
      tag: "paypal-webhook",
      event_id: eventId,
      capture_id: capture.captureId,
      booking_id: grant.bookingId,
      duplicate: grant.duplicate,
    });
    await markEvent(
      { admin, billingEventId },
      "processed",
      undefined,
      "paypal-webhook",
    );
    return { retryable: false };
  }

  logError(
    "paypal-webhook: single_session grant failed",
    new Error(grant.reason),
    {
      tag: "paypal-webhook",
      event_id: eventId,
      capture_id: capture.captureId,
      reason: grant.reason,
    },
  );
  await markEvent(
    { admin, billingEventId },
    "failed",
    grant.reason,
    "paypal-webhook",
  );
  return {
    retryable: [
      "grant failed",
      "payment insert failed",
      "payment lookup failed",
      "price lookup failed",
      "profile lookup failed",
    ].includes(grant.reason),
  };
}


export async function POST(request: Request) {
  // ── Gate 1: config ─────────────────────────────────────────────────────────
  if (!isPayPalWebhookConfigured()) {
    logError(
      "paypal-webhook: not configured",
      new Error("config-missing"),
      { tag: "paypal-webhook", missing: "PAYPAL_WEBHOOK_ID" },
    );
    return NextResponse.json(
      { error: "PayPal webhook not configured" },
      { status: 503 },
    );
  }

  // ── Gate 1.5: require PayPal transmission headers BEFORE the outbound verify ─
  // verifyPayPalWebhookSignature makes an OUTBOUND call to PayPal on every
  // request. A flood of header-less POSTs would each burn an outbound call (and
  // fail anyway). Reject up front when any transmission header is absent — zero
  // outbound, zero side effects (fix #4).
  const requiredPayPalHeaders = [
    "paypal-auth-algo",
    "paypal-cert-url",
    "paypal-transmission-id",
    "paypal-transmission-sig",
    "paypal-transmission-time",
  ];
  if (requiredPayPalHeaders.some((h) => !request.headers.get(h))) {
    return NextResponse.json({ error: "Missing PayPal signature headers" }, { status: 400 });
  }

  // ── Gate 2: raw body + signature verification ──────────────────────────────
  const rawBody = await request.text();
  let verified: boolean;
  try {
    verified = await verifyPayPalWebhookSignature(request.headers, rawBody);
  } catch (err) {
    // verifyPayPalWebhookSignature throws ONLY on a config problem (missing
    // webhook id / api base) — map to 503, same as Stripe's missing-secret gate.
    logError("paypal-webhook: signature verification threw", err, {
      tag: "paypal-webhook",
      kind: "verify-threw",
    });
    return NextResponse.json(
      { error: "PayPal webhook not configured" },
      { status: 503 },
    );
  }
  if (!verified) {
    // Forged or malformed → 400, ZERO side effects (NFR-001).
    // no security-alert here: unauthenticated path, flood vector (see PR #686 review)
    logError(
      "paypal-webhook: signature verification failed",
      new Error("bad-sig"),
      { tag: "paypal-webhook", kind: "bad-sig" },
    );
    return NextResponse.json({ error: "Invalid signature" }, { status: 400 });
  }

  // ── Parse the verified event ───────────────────────────────────────────────
  let eventRaw: unknown;
  try {
    eventRaw = JSON.parse(rawBody);
  } catch (err) {
    logError("paypal-webhook: body not valid JSON after verify", err, {
      tag: "paypal-webhook",
    });
    return NextResponse.json({ error: "Malformed body" }, { status: 400 });
  }

  const parsedEvent = PaypalEventSchema.safeParse(eventRaw);
  if (!parsedEvent.success) {
    // Verified by PayPal but missing id/event_type — can't dedup or dispatch.
    logError(
      "paypal-webhook: verified event missing id/event_type",
      new Error("bad-shape"),
      { tag: "paypal-webhook", issues: parsedEvent.error.flatten() },
    );
    return NextResponse.json({ error: "Malformed event" }, { status: 400 });
  }
  const event = parsedEvent.data;

  const admin = createAdminClient();

  // ── Gate 3: idempotency ledger insert (ADR-0005: shared Billing seam) ──────
  // UNIQUE(stripe_event_id): a duplicate delivery is already-processed → 200
  // no-op. PayPal event ids are stored in the same column as Stripe event ids
  // (they never collide); provider='paypal' tags the row for admin filtering.
  const createdMs = event.create_time ? new Date(event.create_time).getTime() : Date.now();
  let ingest: Awaited<ReturnType<typeof ingestBillingEvent>>;
  try {
    ingest = await ingestBillingEvent(admin, {
      provider: "paypal",
      eventId: event.id,
      eventType: event.event_type,
      createdMs,
      payload: event,
    });
  } catch (insErr) {
    logError("paypal-webhook: billing_events insert failed", insErr, {
      tag: "paypal-webhook",
      event_id: event.id,
      event_type: event.event_type,
    });
    return NextResponse.json({ error: "Ledger write failed" }, { status: 500 });
  }

  if (ingest.outcome === "duplicate") {
    return NextResponse.json({ received: true, duplicate: true });
  }

  return dispatch(admin, event, ingest.billingEventId);
}

/** PAYMENT.CAPTURE.COMPLETED → tamper-guarded, idempotent prepaid-hours grant.
 *
 * Returns `{ retryable }` so the dispatcher can decide whether to surface a
 * non-2xx and let PayPal retry. Only reasons that can be FIXED by a retry are
 * retryable: a transient RPC failure (`grant failed`) or a transient profile
 * lookup (`profile lookup failed`). Permanent reasons (bad custom_id, amount
 * mismatch, no profile, not a student, missing custom_id) stay 2xx — retrying
 * cannot help, and PayPal would retry forever.
 */
async function handleCaptureCompleted(
  admin: ReturnType<typeof createAdminClient>,
  event: z.infer<typeof PaypalEventSchema>,
  billingEventId: string | null,
): Promise<{ retryable: boolean }> {
  const resourceParsed = CaptureResourceSchema.safeParse(event.resource);
  if (!resourceParsed.success) {
    logError(
      "paypal-webhook: PAYMENT.CAPTURE.COMPLETED resource malformed",
      new Error("bad-resource"),
      { tag: "paypal-webhook", event_id: event.id, issues: resourceParsed.error.flatten() },
    );
    await markEvent({ admin, billingEventId }, "failed", "capture resource malformed", "paypal-webhook");
    return { retryable: false };
  }
  const capture = resourceParsed.data;
  const amountUsd = capture.amount?.value ? Number(capture.amount.value) : NaN;
  const customId = capture.custom_id ?? null;
  const orderId =
    capture.supplementary_data?.related_ids?.order_id ?? null;

  if (customId?.startsWith("single_session:")) {
    return handleSingleSessionCapture(
      admin,
      event.id,
      billingEventId,
      {
        captureId: capture.id,
        amountUsd,
        customId,
        orderId,
      },
    );
  }

  const result = await grantPaypalPrepaidCapture(admin, {
    captureId: capture.id,
    amountUsd,
    customId,
    orderId,
  });

  if (result.ok) {
    logInfo("paypal-webhook: prepaid_hours granted", {
      tag: "paypal-webhook",
      event_id: event.id,
      capture_id: capture.id,
      lot_id: result.lotId,
    });
    await markEvent({ admin, billingEventId }, "processed", undefined, "paypal-webhook");
    return { retryable: false };
  }

  logError("paypal-webhook: prepaid grant failed", new Error(result.reason), {
    tag: "paypal-webhook",
    event_id: event.id,
    capture_id: capture.id,
    reason: result.reason,
  });
  await markEvent({ admin, billingEventId }, "failed", result.reason, "paypal-webhook");
  // Retryable iff a retry could plausibly succeed — transient DB / lookup
  // failures only. Everything else is a permanent config/tamper/ownership
  // rejection that a redelivery will hit identically.
  const retryable =
    result.reason === "grant failed" || result.reason === "profile lookup failed";
  return { retryable };
}

/**
 * PAYMENT.CAPTURE.REFUNDED / .REVERSED → void the funded lot's remaining hours.
 *
 * Money reversed OUTSIDE our saga (PayPal-side refund / dispute) must not leave
 * a spendable wallet. reconcile_external_prepaid_refund is provider-neutral
 * (keyed on provider_payment_ref = the capture id) and idempotent (0-remaining
 * → no-op, no duplicate 'refunded' event).
 */
async function handleExternalRefund(
  admin: ReturnType<typeof createAdminClient>,
  event: z.infer<typeof PaypalEventSchema>,
  billingEventId: string | null,
): Promise<{ retryable: boolean }> {
  const refundParsed = RefundResourceSchema.safeParse(event.resource);
  const captureId = refundParsed.success
    ? parseRefundCaptureId(refundParsed.data.links)
    : null;
  if (!captureId) {
    logError(
      "paypal-webhook: refund/reversal missing capture id (rel=up)",
      new Error("no-capture-id"),
      { tag: "paypal-webhook", event_id: event.id, event_type: event.event_type },
    );
    await markEvent({ admin, billingEventId }, "failed", "refund missing capture id", "paypal-webhook");
    // Permanent — PayPal sent a refund event with no up-link; a redelivery
    // will look identical. Keep 2xx so PayPal stops retrying.
    return { retryable: false };
  }
  const { error: reconErr } = await admin.rpc("reconcile_external_prepaid_refund", {
    p_payment_intent: captureId,
  });
  if (reconErr) {
    logError("paypal-webhook: reconcile_external_prepaid_refund failed", reconErr, {
      tag: "paypal-webhook",
      event_id: event.id,
      capture_id: captureId,
    });
    await markEvent({ admin, billingEventId }, "failed", reconErr.message, "paypal-webhook");
    // Transient RPC failure — a retry may succeed. Surface 500 so PayPal
    // redelivers (billing_events dedup makes a retry safe).
    return { retryable: true };
  }
  logInfo("paypal-webhook: external refund reconciled (hours voided)", {
    tag: "paypal-webhook",
    event_id: event.id,
    capture_id: captureId,
  });
  await markEvent({ admin, billingEventId }, "processed", undefined, "paypal-webhook");
  return { retryable: false };
}

async function handlePaypalSubscriptionEvent(
  admin: AdminClient,
  event: PaypalEvent,
  billingEventId: string | null,
  status: PaypalEventStatus,
  opts: { emit?: typeof BillingEvents.PastDue | typeof BillingEvents.Canceled } = {},
): Promise<void> {
  const subscriptionId = subscriptionIdFromEvent(event);
  if (!subscriptionId) {
    await markEvent({ admin, billingEventId }, "failed", "subscription id missing", "paypal-webhook");
    return;
  }

  const eventCreatedMs = paypalEventCreatedMs(event);
  const eventIso = new Date(eventCreatedMs).toISOString();
  const existing = await readPaypalMirror(admin, subscriptionId);

  if (existing) {
    const lastEventMs = Date.parse(existing.last_event_at);
    if (
      Number.isFinite(lastEventMs) &&
      !shouldApplyEvent(eventCreatedMs, lastEventMs)
    ) {
      await markEvent({ admin, billingEventId }, "processed", "stale event ignored", "paypal-webhook");
      return;
    }

    if (event.event_type !== "BILLING.SUBSCRIPTION.UPDATED") {
      const { error } = await admin
        .from("subscriptions")
        .update({
          status,
          last_event_at: eventIso,
          ...(status === "canceled" ? { canceled_at: eventIso } : {}),
        })
        .eq("id", existing.id);
      if (error) {
        throw new WebhookTransientError(`paypal subscription status update failed: ${error.message}`);
      }
      await markEvent({ admin, billingEventId }, "processed", undefined, "paypal-webhook");
      if (opts.emit) {
        emitEvent(opts.emit, "subscription", existing.id, {
          subscription_id: existing.id,
          student_id: existing.student_id,
        }).catch((err) => logError(`emit ${opts.emit} failed`, err, { tag: "billing" }));
      }
      return;
    }
  }

  const snapshot = await paypalSnapshotFromSubscription(
    admin,
    subscriptionId,
    status,
    eventCreatedMs,
  );
  if (!snapshot.ok) {
    await markEvent({ admin, billingEventId }, "failed", snapshot.reason, "paypal-webhook");
    if (snapshot.retryable) {
      throw new WebhookTransientError(snapshot.reason);
    }
    return;
  }

  const mirror = await upsertMirror(admin, snapshot.snap);
  if (!mirror) {
    await markEvent({ admin, billingEventId }, "failed", "upsertMirror returned null", "paypal-webhook");
    return;
  }

  await markEvent({ admin, billingEventId }, "processed", undefined, "paypal-webhook");
  if (opts.emit) {
    emitEvent(opts.emit, "subscription", mirror.id, {
      subscription_id: mirror.id,
      student_id: mirror.studentId,
    }).catch((err) => logError(`emit ${opts.emit} failed`, err, { tag: "billing" }));
  }
}

async function resolvePaypalMirrorForGrant(args: {
  admin: AdminClient;
  subscriptionId: string;
  eventCreatedMs: number;
  studentId: string;
  planId: string;
  currentPeriodStart: string;
  currentPeriodEnd: string;
}): Promise<string | null> {
  const existing = await readPaypalMirror(args.admin, args.subscriptionId);
  if (existing) {
    if (existing.student_id !== args.studentId || existing.plan_id !== args.planId) {
      return null;
    }
    return existing.id;
  }

  const mirror = await upsertMirror(args.admin, {
    provider: "paypal",
    providerSubscriptionId: args.subscriptionId,
    providerCustomerId: null,
    stripeSubscriptionId: args.subscriptionId,
    stripeCustomerId: "",
    status: "active",
    currentPeriodStart: args.currentPeriodStart,
    currentPeriodEnd: args.currentPeriodEnd,
    cancelAtPeriodEnd: false,
    eventCreatedSeconds: Math.floor(args.eventCreatedMs / 1000),
    studentId: args.studentId,
    planId: args.planId,
  });
  if (mirror) return mirror.id;

  const winner = await readPaypalMirror(args.admin, args.subscriptionId);
  return winner?.id ?? null;
}

async function handlePaypalSaleCompleted(
  admin: AdminClient,
  event: PaypalEvent,
  billingEventId: string | null,
): Promise<void> {
  const resourceParsed = SaleCompletedResourceSchema.safeParse(event.resource);
  if (!resourceParsed.success) {
    await markEvent({ admin, billingEventId }, "failed", "sale resource malformed", "paypal-webhook");
    return;
  }
  const sale = resourceParsed.data;
  const currency = amountCurrency(sale.amount);
  if (currency !== "USD") {
    await markEvent(
      { admin, billingEventId },
      "failed",
      `non-usd currency: ${currency ?? "missing"}`,
      "paypal-webhook",
    );
    return;
  }
  const amountCents = amountStringToCents(sale.amount.total);
  if (!amountCents) {
    await markEvent({ admin, billingEventId }, "failed", "sale amount malformed", "paypal-webhook");
    return;
  }

  let subscription: Awaited<ReturnType<typeof getPayPalSubscription>>;
  try {
    subscription = await getPayPalSubscription(sale.billing_agreement_id);
  } catch (err) {
    logError("paypal-webhook: sale subscription lookup failed", err, {
      tag: "paypal-webhook",
      event_id: event.id,
      subscription_id: sale.billing_agreement_id,
    });
    throw new WebhookTransientError(`paypal subscription retrieve failed: ${sale.billing_agreement_id}`);
  }

  const periodStartIso = normalizeIso(subscription.currentPeriodStart);
  const periodEndIso = normalizeIso(subscription.currentPeriodEnd);
  if (!periodStartIso || !periodEndIso) {
    throw new WebhookTransientError(`paypal subscription period missing: ${sale.billing_agreement_id}`);
  }
  if (!subscription.customId) {
    await markEvent({ admin, billingEventId }, "failed", "subscription missing custom_id", "paypal-webhook");
    return;
  }

  const parsed = parseSubscriptionCustomId(subscription.customId);
  if (
    !parsed ||
    (parsed.productType !== "subscription" && parsed.productType !== "subscription_upgrade")
  ) {
    await markEvent({ admin, billingEventId }, "failed", "bad subscription custom_id", "paypal-webhook");
    return;
  }

  const profile = await validateStudentProfile(admin, parsed.studentId);
  if (!profile.ok) {
    await markEvent({ admin, billingEventId }, "failed", profile.reason, "paypal-webhook");
    if (profile.retryable) {
      throw new WebhookTransientError(profile.reason);
    }
    return;
  }

  const plan = await getActivePlanByCode(admin, parsed.planCode);
  if (!plan) {
    await markEvent({ admin, billingEventId }, "failed", `plan not found: ${parsed.planCode}`, "paypal-webhook");
    return;
  }

  const mirrorId = await resolvePaypalMirrorForGrant({
    admin,
    subscriptionId: sale.billing_agreement_id,
    eventCreatedMs: paypalEventCreatedMs(event),
    studentId: parsed.studentId,
    planId: plan.id,
    currentPeriodStart: periodStartIso,
    currentPeriodEnd: periodEndIso,
  });
  if (!mirrorId) {
    await markEvent({ admin, billingEventId }, "failed", "could not resolve paypal subscription mirror", "paypal-webhook");
    return;
  }

  const cycleKey = buildCycleKey({
    invoiceId: sale.id,
    subscriptionId: sale.billing_agreement_id,
    periodStartIso,
  });
  const result = await grantCycle(admin, {
    subscriptionId: mirrorId,
    studentId: parsed.studentId,
    planId: plan.id,
    cycleKey,
    stripePaymentIntent: sale.id,
    provider: "paypal",
    providerRef: sale.id,
    amountCents,
    creditCount: plan.monthlyCreditCount,
    expiresAt: periodEndIso,
    sessionMetadata: plan.sessionMetadata,
  });
  if (!result.ok) {
    throw new WebhookTransientError(result.error);
  }

  if (billingEventId) {
    await admin.from("billing_events").update({ subscription_id: mirrorId }).eq("id", billingEventId);
  }
  await markEvent({ admin, billingEventId }, "processed", undefined, "paypal-webhook");

  emitEvent(
    result.created ? BillingEvents.Activated : BillingEvents.Renewed,
    "subscription",
    mirrorId,
    {
      student_id: parsed.studentId,
      plan_id: plan.id,
      cycle_key: cycleKey,
      grant_id: result.grantId,
    },
  ).catch((err) => logError("emit paypal subscription activated/renewed failed", err, { tag: "billing" }));
}

function saleIdFromRefundResource(
  resource: z.infer<typeof SaleRefundedResourceSchema>,
): string | null {
  if (resource.sale_id) return resource.sale_id;
  const up = resource.links?.find((link) => link.rel === "up");
  const match = up?.href.match(/\/sales?\/([^/?]+)/);
  return match?.[1] ?? resource.id ?? null;
}

async function handlePaypalSaleRefunded(
  admin: AdminClient,
  event: PaypalEvent,
  billingEventId: string | null,
): Promise<void> {
  const resourceParsed = SaleRefundedResourceSchema.safeParse(event.resource);
  if (!resourceParsed.success) {
    await markEvent({ admin, billingEventId }, "failed", "sale refund resource malformed", "paypal-webhook");
    return;
  }
  const refund = resourceParsed.data;
  const saleId = saleIdFromRefundResource(refund);
  if (!saleId) {
    await markEvent({ admin, billingEventId }, "failed", "refund missing sale id", "paypal-webhook");
    return;
  }

  const { data: payment, error: paymentErr } = await admin
    .from("payments")
    .select("amount_usd")
    .eq("paypal_sale_id", saleId)
    .maybeSingle<{ amount_usd: number }>();
  if (paymentErr) {
    throw new WebhookTransientError(`paypal refund payment lookup failed: ${paymentErr.message}`);
  }
  if (!payment) {
    await markEvent({ admin, billingEventId }, "processed", "refund not for a local subscription sale", "paypal-webhook");
    return;
  }

  const currency = refund.amount ? amountCurrency(refund.amount) : "USD";
  if (currency !== "USD") {
    await markEvent(
      { admin, billingEventId },
      "failed",
      `non-usd refund currency: ${currency ?? "missing"}`,
      "paypal-webhook",
    );
    return;
  }
  const refundedCents = refund.amount?.total
    ? amountStringToCents(refund.amount.total)
    : Math.round(payment.amount_usd * 100);
  if (!refundedCents) {
    await markEvent({ admin, billingEventId }, "failed", "refund amount malformed", "paypal-webhook");
    return;
  }
  const originalCents = Math.round(payment.amount_usd * 100);
  if (refundedCents < originalCents) {
    logInfo("paypal-webhook: partial subscription refund left sessions + plan intact", {
      tag: "billing",
      sale_id: saleId,
      refunded_cents: refundedCents,
      original_cents: originalCents,
    });
    await markEvent({ admin, billingEventId }, "processed", "partial refund ignored", "paypal-webhook");
    return;
  }

  await revokeAndCancelOnSubscriptionRefund(
    { admin },
    {
      id: saleId,
      currency: "usd",
      refunded: true,
      payment_intent: saleId,
      amount: originalCents,
      amount_refunded: refundedCents,
    } as Stripe.Charge,
    {
      provider: "paypal",
      grantPaymentRefColumn: "provider_payment_ref",
      paymentColumn: "paypal_sale_id",
      cancelProviderSubscription: async (subscriptionId) => {
        await cancelPayPalSubscription(subscriptionId, "Subscription payment fully refunded");
      },
    },
  );

  await markEvent({ admin, billingEventId }, "processed", undefined, "paypal-webhook");
}

/** Route the event type to the appropriate handler.
 *
 * Retry semantics: PayPal redelivers ONLY on non-2xx. A handler returns
 * `{ retryable: true }` when a redelivery could plausibly fix the failure
 * (transient DB / lookup); we then return 500 so PayPal retries. Permanent
 * failures and all success/ignored paths stay 2xx so PayPal stops retrying.
 * billing_events UNIQUE on event.id makes a retry safe (re-dispatch in place
 * on a non-terminal prior delivery).
 */
async function dispatch(
  admin: ReturnType<typeof createAdminClient>,
  event: z.infer<typeof PaypalEventSchema>,
  billingEventId: string | null,
): Promise<NextResponse> {
  try {
    switch (event.event_type) {
      case "PAYMENT.CAPTURE.COMPLETED": {
        const { retryable } = await handleCaptureCompleted(admin, event, billingEventId);
        if (retryable) {
          return NextResponse.json(
            { error: "Grant failed (retryable)" },
            { status: 500 },
          );
        }
        break;
      }

      case "PAYMENT.CAPTURE.REFUNDED":
      case "PAYMENT.CAPTURE.REVERSED": {
        const { retryable } = await handleExternalRefund(admin, event, billingEventId);
        if (retryable) {
          return NextResponse.json(
            { error: "Refund reconcile failed (retryable)" },
            { status: 500 },
          );
        }
        break;
      }

      case "PAYMENT.CAPTURE.DENIED": {
        // The capture never completed → no lot was ever granted (grant fires
        // only on PAYMENT.CAPTURE.COMPLETED). Nothing to void; audit + move on.
        logInfo("paypal-webhook: capture denied (no grant existed)", {
          tag: "paypal-webhook",
          event_id: event.id,
        });
        await markEvent({ admin, billingEventId }, "ignored", event.event_type, "paypal-webhook");
        break;
      }

      case "BILLING.SUBSCRIPTION.ACTIVATED": {
        await handlePaypalSubscriptionEvent(admin, event, billingEventId, "active");
        break;
      }

      case "BILLING.SUBSCRIPTION.UPDATED": {
        await handlePaypalSubscriptionEvent(admin, event, billingEventId, "active");
        break;
      }

      case "BILLING.SUBSCRIPTION.CANCELLED":
      case "BILLING.SUBSCRIPTION.EXPIRED": {
        await handlePaypalSubscriptionEvent(admin, event, billingEventId, "canceled", {
          emit: BillingEvents.Canceled,
        });
        break;
      }

      case "BILLING.SUBSCRIPTION.SUSPENDED": {
        await handlePaypalSubscriptionEvent(admin, event, billingEventId, "past_due");
        break;
      }

      case "BILLING.SUBSCRIPTION.PAYMENT.FAILED": {
        await handlePaypalSubscriptionEvent(admin, event, billingEventId, "past_due", {
          emit: BillingEvents.PastDue,
        });
        break;
      }

      case "PAYMENT.SALE.COMPLETED": {
        await handlePaypalSaleCompleted(admin, event, billingEventId);
        break;
      }

      case "PAYMENT.SALE.REFUNDED": {
        await handlePaypalSaleRefunded(admin, event, billingEventId);
        break;
      }

      default: {
        await markEvent({ admin, billingEventId }, "ignored", event.event_type, "paypal-webhook");
        break;
      }
    }
  } catch (err) {
    // Unexpected crash: mark failed and 500 so PayPal retries (idempotency
    // makes a retry safe — billing_events guards re-entry).
    logError("paypal-webhook: dispatch crashed", err, {
      tag: "paypal-webhook",
      event_id: event.id,
      event_type: event.event_type,
    });
    await markEvent(
      { admin, billingEventId },
      "failed",
      err instanceof Error ? err.message : "dispatch crashed",
      "paypal-webhook",
    );
    return NextResponse.json({ error: "Dispatch failed" }, { status: 500 });
  }

  return NextResponse.json({ received: true });
}
