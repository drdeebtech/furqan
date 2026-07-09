"use server";

import { randomUUID } from "crypto";
import { z } from "zod";
import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/auth/require-admin";
import { createAdminClient } from "@/lib/supabase/admin";
import { getStripe } from "@/lib/stripe/client";
import { logError } from "@/lib/logger";

/**
 * T5.4 — admin "approve refund" for prepaid-hour wallets (spec 038, Phase 5).
 *
 * A thin, fail-closed wrapper over the verified refund saga DB functions plus
 * ONE Stripe refund call:
 *   1. reserve_prepaid_refund — voids the hours now, opens a `pending` request
 *      (idempotent on refundRequestId; pro-rated at the lot's FROZEN rate).
 *   2. stripe.refunds.create — idempotencyKey = refundRequestId (a retry never
 *      double-refunds); metadata.refund_request_id lets the `charge.refunded`
 *      webhook correlate back and call finalize_prepaid_refund. We do NOT
 *      finalize here — the webhook is the single source of truth (R8), which
 *      avoids a non-atomic Stripe/DB window.
 *   3. On Stripe failure — release_prepaid_refund restores the voided hours.
 *      Fail-closed: if release itself fails, hours stay voided and an operator
 *      reconciles (held-than-spent is the safe side for an in-flight refund).
 *
 * Stripe-only: this path refunds through Stripe, so the lot must be a Stripe
 * purchase. A PayPal lot (NULL stripe_payment_intent_id) is rejected before any
 * void — those are refunded through PayPal, not here.
 */

const Input = z.object({
  lotId: z.uuid(),
  hours: z.number().int().positive(),
});

type RefundResult =
  | { ok: true; amountUsd: number; refundRequestId: string }
  | { ok: false; error: string };

export async function approvePrepaidRefund(raw: {
  lotId: string;
  hours: number;
}): Promise<RefundResult> {
  // Authorize inside the action — never trust a client-side route gate.
  await requireAdmin();

  const parsed = Input.safeParse(raw);
  if (!parsed.success) {
    return { ok: false, error: "invalid input" };
  }
  const { lotId, hours } = parsed.data;

  const admin = createAdminClient();

  // Fetch + guard FIRST. This action refunds via Stripe, so the lot must be a
  // Stripe purchase; a PayPal lot has a NULL stripe_payment_intent_id and must
  // be refunded through PayPal. Guarding here avoids voiding hours for a refund
  // this path cannot complete. reserve_prepaid_refund still re-locks and
  // re-validates the balance, so this pre-read is only a guard, not the
  // authoritative money op.
  const { data: lot, error: lotErr } = await admin
    .from("student_packages")
    .select("id, stripe_payment_intent_id, rate_paid_usd")
    .eq("id", lotId)
    .eq("product_type", "prepaid_hours")
    .maybeSingle();

  if (lotErr) {
    return { ok: false, error: lotErr.message };
  }
  if (!lot) {
    return { ok: false, error: "lot not found or not a prepaid-hours lot" };
  }
  if (!lot.stripe_payment_intent_id) {
    return {
      ok: false,
      error: "PayPal-purchased hours must be refunded via PayPal, not this action",
    };
  }

  const refundRequestId = randomUUID();

  try {
    // 1. Reserve — voids the hours, opens the pending saga row.
    const { data: amountUsd, error: reserveErr } = await admin.rpc("reserve_prepaid_refund", {
      p_lot: lotId,
      p_hours: hours,
      p_refund_request_id: refundRequestId,
    });
    if (reserveErr || amountUsd == null) {
      return { ok: false, error: reserveErr?.message ?? "reserve failed" };
    }

    // 2. Issue the Stripe refund. The charge.refunded webhook finalizes.
    const stripe = getStripe();
    try {
      await stripe.refunds.create(
        {
          payment_intent: lot.stripe_payment_intent_id,
          amount: Math.round(Number(amountUsd) * 100),
          metadata: { refund_request_id: refundRequestId },
        },
        { idempotencyKey: refundRequestId },
      );
      revalidatePath("/admin");
      return { ok: true, amountUsd: Number(amountUsd), refundRequestId };
    } catch (stripeErr) {
      // 3. Stripe failed — release the reservation so the hours come back.
      const { error: releaseErr } = await admin.rpc("release_prepaid_refund", {
        p_refund_request_id: refundRequestId,
      });
      if (releaseErr) {
        logError("approvePrepaidRefund: release failed after Stripe error", releaseErr, {
          tag: "refund",
          refund_request_id: refundRequestId,
        });
      }
      return {
        ok: false,
        error: stripeErr instanceof Error ? stripeErr.message : "stripe refund failed",
      };
    }
  } catch (err) {
    logError("approvePrepaidRefund crashed", err, { tag: "refund" });
    return { ok: false, error: err instanceof Error ? err.message : "crashed" };
  }
}
