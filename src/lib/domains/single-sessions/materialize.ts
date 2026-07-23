import "server-only";

import { dispatchEffects } from "@/lib/automation/effects";
import { emitEvent } from "@/lib/automation/emit";
import { logError } from "@/lib/logger";
import type { createAdminClient } from "@/lib/supabase/admin";
import type { SpecializedPurpose } from "./pricing";

/**
 * Task 8 (round-2 architecture plan) — the single-session "materialize" seam.
 *
 * Both money-path call sites choose between the two atomic creator RPCs
 * (`start_instant_session_booking` / `create_single_session_booking`),
 * assemble their args, parse `target_scope`, and map the assessment
 * duplicate-race error the same way:
 *   - `handlePaymentIntentSucceeded` (webhook-handlers.ts) — the PAID path,
 *     after a Stripe Checkout payment succeeds.
 *   - `POST /api/stripe/checkout/single-session` (route.ts) — the ZERO-PRICE
 *     path, when the configured price is 0 and no Stripe Checkout is needed.
 *
 * VERIFIED DRIFT (2026-07-23): the two sites had drifted on the
 * `booking.created` emit — NOT on the "free evaluation"/assessment path as
 * originally suspected. Direct read of both files (+ a repo-wide grep for
 * every `booking.created` emitter and a trigger search on `bookings`, both
 * clean) confirms:
 *   - webhook `instant`: emits `booking.created` (dispatchEffects + emitEvent).
 *   - route zero-price `instant`: did NOT emit. <- the actual bug, fixed here.
 *   - webhook `assessment`/`specialized`: never emitted.
 *   - route zero-price `assessment`/`specialized`: never emitted either.
 *     No drift on this pair — both already agreed (on "never"). This function
 *     preserves that: only `instant` emits, matching the paid webhook exactly
 *     (byte-identical paid-path behavior).
 *
 * Logging is intentionally left to the CALLERS (not here): the two sites
 * already used different log tags/messages/conditions before this extraction
 * (e.g. the route skips `logError` on the duplicate-race message, the webhook
 * did not), so centralizing logging here would itself be a silent paid-path
 * behavior change. Callers get a structured `code` to decide what to log.
 */

export type SingleSessionBookingType = "assessment" | "instant" | "specialized";

export interface MaterializeSingleSessionInput {
  studentId: string;
  teacherId: string;
  bookingType: SingleSessionBookingType;
  /** null for the zero-price direct-create path (no charge to link). */
  paymentId: string | null;
  specialty?: string | null;
  purpose?: SpecializedPurpose | null;
  /** Raw JSON string (Stripe metadata format) — parsed here, once. */
  targetScopeRaw?: string | null;
  /** ISO timestamp; instant only. Defaults to "now" when omitted. */
  scheduledAt?: string | null;
}

export type MaterializeSingleSessionResult =
  | { ok: true; bookingId: string }
  | { ok: false; code: "invalid_target_scope"; error: string; cause: unknown }
  | { ok: false; code: "duplicate_active_assessment"; error: string; cause: unknown }
  | { ok: false; code: "rpc_failed"; error: string; cause: unknown };

/**
 * Call the appropriate atomic creator RPC to materialize a single-session
 * booking (+ link the payment, when one exists, in the SAME transaction).
 * Best-effort emits `booking.created` for `instant` bookings only, matching
 * the paid webhook path exactly (see module docstring for the verified
 * drift). Never throws — RPC/emit failures return `{ ok: false }` or are
 * swallowed (post-commit, fail-soft) respectively.
 */
export async function materializeSingleSessionBooking(
  admin: ReturnType<typeof createAdminClient>,
  input: MaterializeSingleSessionInput,
): Promise<MaterializeSingleSessionResult> {
  if (input.bookingType === "instant") {
    const effectiveScheduledAt = input.scheduledAt ?? new Date().toISOString();
    const { data: bookingId, error: rpcErr } = await admin.rpc(
      "start_instant_session_booking",
      {
        p_student_id: input.studentId,
        p_teacher_id: input.teacherId,
        p_session_type: "hifz" as const,
        p_duration_min: 30,
        p_rate_snapshot: 0,
        p_amount_usd: 0,
        p_scheduled_at: effectiveScheduledAt,
        p_payment_id: input.paymentId ?? undefined,
      },
    );
    if (rpcErr || !bookingId) {
      return { ok: false, code: "rpc_failed", error: rpcErr?.message ?? "instant creator returned no id", cause: rpcErr ?? new Error("no id") };
    }
    const bookingIdStr = bookingId as string;
    const dateLabel = new Date(effectiveScheduledAt).toLocaleDateString("ar");
    await Promise.allSettled([
      dispatchEffects("booking.created", {
        teacherId: input.teacherId,
        entityId: bookingIdStr,
        dateLabel,
      }),
      emitEvent("booking.created", "booking", bookingIdStr, {
        student_id: input.studentId,
        teacher_id: input.teacherId,
        session_type: "hifz",
        scheduled_at: effectiveScheduledAt,
      }).catch((err) =>
        logError("single-session materialize: emit booking.created failed", err, {
          tag: "single-sessions",
          booking_type: "instant",
        }),
      ),
    ]);
    return { ok: true, bookingId: bookingIdStr };
  }

  // assessment / specialized: atomic create_single_session_booking.
  let targetScopeJson: unknown = null;
  if (input.targetScopeRaw) {
    try {
      targetScopeJson = JSON.parse(input.targetScopeRaw);
    } catch (err) {
      return { ok: false, code: "invalid_target_scope", error: "target_scope metadata is not valid JSON", cause: err };
    }
  }

  const { data: bookingId, error: rpcErr } = await admin.rpc(
    "create_single_session_booking",
    {
      p_student_id: input.studentId,
      p_teacher_id: input.teacherId,
      p_booking_product_type: input.bookingType,
      p_payment_id: input.paymentId ?? undefined,
      p_specialty: input.specialty ?? undefined,
      p_purpose: input.purpose ?? undefined,
      p_target_scope: targetScopeJson as never,
    },
  );
  if (rpcErr || !bookingId) {
    if (rpcErr?.message?.includes("uniq_active_assessment_per_student")) {
      return { ok: false, code: "duplicate_active_assessment", error: rpcErr.message, cause: rpcErr };
    }
    return { ok: false, code: "rpc_failed", error: rpcErr?.message ?? "creator returned no id", cause: rpcErr ?? new Error("no id") };
  }
  return { ok: true, bookingId: bookingId as string };
}
