"use server";

import { randomUUID } from "crypto";
import { z } from "zod";
import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/auth/require-admin";
import { createAdminClient } from "@/lib/supabase/admin";
import { getStripe } from "@/lib/stripe/client";
import { logError } from "@/lib/logger";

/**
 * Admin "refund single session" — a thin, fail-closed wrapper over the refund
 * saga DB functions plus ONE Stripe refund (mirrors approvePrepaidRefund):
 *   1. reserve_single_session_refund — opens a `pending` saga row (idempotent
 *      on refundRequestId; guards status pending/confirmed, single-session-only,
 *      + a Stripe payment). Does NOT cancel the booking — the webhook does.
 *   2. stripe.refunds.create — idempotencyKey = refundRequestId; NO `amount`
 *      → full-charge refund; metadata.refund_kind='single_session' lets the
 *      charge.refunded webhook correlate and call finalize_single_session_refund.
 *   3. On ANY failure after a successful reserve — release_single_session_refund
 *      closes the pending row. Skipping this would leave a live `pending` row
 *      that the unique index turns into a permanent block on future refunds for
 *      the booking. Fail-closed: log if release itself errors.
 */
const Input = z.object({ bookingId: z.uuid() });

type RefundResult =
  | { ok: true; amountUsd: number; refundRequestId: string }
  | { ok: false; error: string };

export async function approveSingleSessionRefund(raw: {
  bookingId: string;
}): Promise<RefundResult> {
  await requireAdmin();

  const parsed = Input.safeParse(raw);
  if (!parsed.success) return { ok: false, error: "invalid input" };
  const { bookingId } = parsed.data;

  const admin = createAdminClient();
  const refundRequestId = randomUUID();

  // Release a reservation opened above; called on every post-reserve failure so
  // no orphaned `pending` row blocks future refunds for this booking.
  const release = async (): Promise<void> => {
    const { error: releaseErr } = await admin.rpc("release_single_session_refund", {
      p_refund_request_id: refundRequestId,
    });
    if (releaseErr) {
      logError("approveSingleSessionRefund: release failed", releaseErr, {
        tag: "refund",
        refund_request_id: refundRequestId,
      });
    }
  };

  try {
    const { data: amountUsd, error: reserveErr } = await admin.rpc(
      "reserve_single_session_refund",
      {
        p_booking: bookingId,
        p_refund_request_id: refundRequestId,
      },
    );
    if (reserveErr || amountUsd == null) {
      // Nothing to release — reserve did not open a row on failure.
      return { ok: false, error: reserveErr?.message ?? "reserve failed" };
    }

    // From here a `pending` row exists: every failure path must release.
    try {
      const { data: reqRow, error: piErr } = await admin
        .from("single_session_refund_requests")
        .select("stripe_payment_intent")
        .eq("id", refundRequestId)
        .single();
      if (piErr || !reqRow) {
        await release();
        return { ok: false, error: piErr?.message ?? "request row missing" };
      }

      const stripe = getStripe();
      await stripe.refunds.create(
        {
          payment_intent: reqRow.stripe_payment_intent,
          metadata: {
            refund_request_id: refundRequestId,
            refund_kind: "single_session",
          },
        },
        { idempotencyKey: refundRequestId },
      );
      revalidatePath("/admin");
      return { ok: true, amountUsd: Number(amountUsd), refundRequestId };
    } catch (postReserveErr) {
      // PI lookup throw, getStripe() throw, or the Stripe refund throw — all
      // leave a live reservation. Release it, then surface the error.
      await release();
      return {
        ok: false,
        error:
          postReserveErr instanceof Error ? postReserveErr.message : "stripe refund failed",
      };
    }
  } catch (err) {
    logError("approveSingleSessionRefund crashed", err, { tag: "refund" });
    return { ok: false, error: err instanceof Error ? err.message : "crashed" };
  }
}
