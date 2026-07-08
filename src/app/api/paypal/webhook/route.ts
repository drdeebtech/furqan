import { NextResponse } from "next/server";
import { z } from "zod";
import type { Json } from "@/types/supabase.generated";
import { createAdminClient } from "@/lib/supabase/admin";
import { logError, logInfo } from "@/lib/logger";
import {
  isPayPalWebhookConfigured,
  verifyPayPalWebhookSignature,
} from "@/lib/paypal/client";
import { grantPaypalPrepaidCapture, parseRefundCaptureId } from "@/lib/paypal/grant";

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


type BillingEventStatus = "received" | "processed" | "ignored" | "failed";

/** Update a billing_events row's status (best-effort, never throws). */
async function markEvent(
  admin: ReturnType<typeof createAdminClient>,
  eventId: string,
  status: BillingEventStatus,
  errorDetail?: string,
): Promise<void> {
  const { error } = await admin
    .from("billing_events")
    .update({
      status,
      ...(errorDetail ? { error_detail: errorDetail } : {}),
    })
    .eq("stripe_event_id", eventId);
  if (error) {
    logError("paypal-webhook: markEvent failed", error, {
      tag: "paypal-webhook",
      event_id: eventId,
      status,
    });
  }
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

  // ── Gate 3: idempotency ledger insert ──────────────────────────────────────
  // UNIQUE(stripe_event_id): a duplicate delivery is already-processed → 200
  // no-op. PayPal event ids are stored in the same column as Stripe event ids
  // (they never collide); provider='paypal' tags the row for admin filtering.
  const createdIso = event.create_time ?? new Date().toISOString();
  const { error: insErr } = await admin
    .from("billing_events")
    .insert({
      stripe_event_id: event.id,
      event_type: event.event_type,
      stripe_event_created: createdIso,
      status: "received",
      payload: event as unknown as Json,
      provider: "paypal",
    });

  if (insErr) {
    if (insErr.code === "23505") {
      // Duplicate delivery. Check the prior row's terminal status — a prior
      // failed/received delivery should be re-attempted (mirror Stripe route).
      const { data: dupRow } = await admin
        .from("billing_events")
        .select("id, status")
        .eq("stripe_event_id", event.id)
        .maybeSingle<{ id: string; status: string }>();
      if (!dupRow || dupRow.status === "processed" || dupRow.status === "ignored") {
        return NextResponse.json({ received: true, duplicate: true });
      }
      // Non-terminal prior delivery — re-dispatch in place.
      return dispatch(admin, event);
    }
    logError("paypal-webhook: billing_events insert failed", insErr, {
      tag: "paypal-webhook",
      event_id: event.id,
      event_type: event.event_type,
    });
    return NextResponse.json({ error: "Ledger write failed" }, { status: 500 });
  }

  return dispatch(admin, event);
}

/** PAYMENT.CAPTURE.COMPLETED → tamper-guarded, idempotent prepaid-hours grant. */
async function handleCaptureCompleted(
  admin: ReturnType<typeof createAdminClient>,
  event: z.infer<typeof PaypalEventSchema>,
): Promise<void> {
  const resourceParsed = CaptureResourceSchema.safeParse(event.resource);
  if (!resourceParsed.success) {
    logError(
      "paypal-webhook: PAYMENT.CAPTURE.COMPLETED resource malformed",
      new Error("bad-resource"),
      { tag: "paypal-webhook", event_id: event.id, issues: resourceParsed.error.flatten() },
    );
    await markEvent(admin, event.id, "failed", "capture resource malformed");
    return;
  }
  const capture = resourceParsed.data;
  const amountUsd = capture.amount?.value ? Number(capture.amount.value) : NaN;
  const customId = capture.custom_id ?? null;

  const result = await grantPaypalPrepaidCapture(admin, {
    captureId: capture.id,
    amountUsd,
    customId,
  });

  if (result.ok) {
    logInfo("paypal-webhook: prepaid_hours granted", {
      tag: "paypal-webhook",
      event_id: event.id,
      capture_id: capture.id,
      lot_id: result.lotId,
    });
    await markEvent(admin, event.id, "processed");
  } else {
    logError("paypal-webhook: prepaid grant failed", new Error(result.reason), {
      tag: "paypal-webhook",
      event_id: event.id,
      capture_id: capture.id,
      reason: result.reason,
    });
    await markEvent(admin, event.id, "failed", result.reason);
  }
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
): Promise<void> {
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
    await markEvent(admin, event.id, "failed", "refund missing capture id");
    return;
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
    await markEvent(admin, event.id, "failed", reconErr.message);
  } else {
    logInfo("paypal-webhook: external refund reconciled (hours voided)", {
      tag: "paypal-webhook",
      event_id: event.id,
      capture_id: captureId,
    });
    await markEvent(admin, event.id, "processed");
  }
}

/** Route the event type to the appropriate handler. */
async function dispatch(
  admin: ReturnType<typeof createAdminClient>,
  event: z.infer<typeof PaypalEventSchema>,
): Promise<NextResponse> {
  try {
    switch (event.event_type) {
      case "PAYMENT.CAPTURE.COMPLETED":
        await handleCaptureCompleted(admin, event);
        break;

      case "PAYMENT.CAPTURE.REFUNDED":
      case "PAYMENT.CAPTURE.REVERSED":
        await handleExternalRefund(admin, event);
        break;

      case "PAYMENT.CAPTURE.DENIED": {
        // The capture never completed → no lot was ever granted (grant fires
        // only on PAYMENT.CAPTURE.COMPLETED). Nothing to void; audit + move on.
        logInfo("paypal-webhook: capture denied (no grant existed)", {
          tag: "paypal-webhook",
          event_id: event.id,
        });
        await markEvent(admin, event.id, "ignored", event.event_type);
        break;
      }

      default: {
        await markEvent(admin, event.id, "ignored", event.event_type);
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
      admin,
      event.id,
      "failed",
      err instanceof Error ? err.message : "dispatch crashed",
    );
    return NextResponse.json({ error: "Dispatch failed" }, { status: 500 });
  }

  return NextResponse.json({ received: true });
}
