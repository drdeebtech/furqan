import "server-only";

/**
 * PayPal capture → prepaid-hour grant (spec 039 Phase 2b).
 *
 * Mirrors `handlePrepaidHoursGrant` in src/lib/domains/billing/webhook-handlers.ts:
 * same fail-closed reconciliation order —
 *   1. parse + validate the FROZEN custom_id (product_type, student, hours, rate)
 *   2. TAMPER GUARD: charged amount must equal hours × rate (cents-equal)
 *   3. ownership: the student_id must resolve to a real profile with role 'student'
 *   4. idempotent grant via `grant_prepaid_hours(p_provider='paypal')`
 *
 * Idempotency is guaranteed by the DB function (a duplicate captureId returns
 * the existing lot — no double grant). No extra sentinel here.
 *
 * Never logs secrets. Never trusts client-supplied amount/rate — only the
 * custom_id stamped at checkout (signature-verified by PayPal) and the
 * capture amount reported by PayPal's API.
 */

import { z } from "zod";
import { createAdminClient } from "@/lib/supabase/admin";
import { logError } from "@/lib/logger";
import { assertPrepaidGrantValid } from "@/lib/domains/billing/prepaid-guard";

// ── types ────────────────────────────────────────────────────────────────────

/** Supabase service-role client (RLS-bypassing; server-only). */
type AdminClient = ReturnType<typeof createAdminClient>;

export interface ParsedPrepaidCustomId {
  studentId: string;
  hours: number;
  rate: number;
}

export type GrantPaypalPrepaidCaptureResult =
  | { ok: true; lotId: string }
  | { ok: false; reason: string };

export interface GrantPaypalPrepaidCaptureArgs {
  captureId: string;
  amountUsd: number;
  customId: string | null;
  /**
   * PayPal ORDER id — from the return route's `?token`, or the capture's
   * `supplementary_data.related_ids.order_id` in the webhook. Needed for the
   * `payments` audit row (CHECK: a paypal row requires `paypal_order_id` NOT
   * NULL). When absent (a rare webhook capture with no related order), the
   * audit row is skipped and the grant + `prepaid_hours_events` ledger remain
   * the audit source — the money grant is never affected either way.
   */
  orderId?: string | null;
}

// ── custom_id parser ─────────────────────────────────────────────────────────

/**
 * Parse `prepaid_hours:<uuid>:<int>:<decimal>` — the FROZEN grant context
 * stamped at /api/paypal/checkout/prepaid-hours.
 *
 * Returns null on ANY deviation (caller fail-closes). Validation:
 *   - exactly 4 segments joined by ':'
 *   - prefix === 'prepaid_hours'
 *   - studentId is a uuid (zod)
 *   - hours is a positive integer (string form, e.g. '10')
 *   - rate is a finite positive number (string form, e.g. '10.00')
 *
 * The rate is parsed from its toFixed(2) string form; we accept any finite
 * positive decimal, not just 2dp, so a future emitter change doesn't silently
 * break grants.
 */
export function parsePrepaidCustomId(
  customId: string,
): ParsedPrepaidCustomId | null {
  const segments = customId.split(":");
  if (segments.length !== 4) return null;

  const [prefix, studentIdRaw, hoursRaw, rateRaw] = segments;
  if (prefix !== "prepaid_hours") return null;

  const studentIdParsed = z.uuid().safeParse(studentIdRaw);
  if (!studentIdParsed.success) return null;

  // hours: integer string, positive. Number('10') === 10, Number.isInteger.
  // Reject '0', negatives, floats, NaN, empty, non-numeric.
  // Regex first: Number() accepts '1e6', '0x10', ' 5 ' — none are canonical
  // grant-context integers, so reject before the coercion.
  if (!/^[1-9]\d*$/.test(hoursRaw)) return null;
  const hours = Number(hoursRaw);
  if (!Number.isInteger(hours) || hours <= 0) return null;

  // rate: finite positive number. Reject '0', negatives, NaN, empty.
  // Regex first: Number() accepts '1e6', '0x10', ' 5 ' — none are canonical
  // grant-context rates, so reject before the coercion.
  if (!/^(?:[1-9]\d*)(?:\.\d+)?$/.test(rateRaw)) return null;
  const rate = Number(rateRaw);
  if (!Number.isFinite(rate) || rate <= 0) return null;

  return { studentId: studentIdParsed.data, hours, rate };
}

// ── refund capture-id parser ─────────────────────────────────────────────────

/**
 * Extract the ORIGINAL capture id from a PayPal refund/reversal event's HATEOAS
 * links (PAYMENT.CAPTURE.REFUNDED / .REVERSED). The refund resource's own `id`
 * is the REFUND id — the capture id (our idempotency key / provider_payment_ref)
 * lives on the link with `rel === "up"`, whose href ends `/captures/<id>`.
 *
 * Returns null if there is no `up` link or it doesn't match the captures path —
 * the caller fail-closes (marks the event failed rather than voiding the wrong
 * lot).
 */
export function parseRefundCaptureId(
  links: ReadonlyArray<{ href: string; rel: string }> | undefined | null,
): string | null {
  if (!links) return null;
  const up = links.find((l) => l.rel === "up");
  if (!up) return null;
  const match = up.href.match(/\/captures\/([^/?]+)/);
  return match ? match[1] : null;
}

// ── grant ────────────────────────────────────────────────────────────────────

/**
 * Grant prepaid hours from a captured PayPal order.
 *
 * Fail-closed at every gate (mirrors handlePrepaidHoursGrant):
 *   - missing/bad custom_id → no grant
 *   - amount mismatch (tamper guard) → no grant, NEVER
 *   - no profile / not a student → no grant
 *   - rpc error / null id → no grant
 *
 * The tamper guard runs BEFORE the rpc — it is the whole point: a buyer who
 * tampers the amount between checkout and capture cannot buy 10 hours for $1.
 */
export async function grantPaypalPrepaidCapture(
  admin: AdminClient,
  args: GrantPaypalPrepaidCaptureArgs,
): Promise<GrantPaypalPrepaidCaptureResult> {
  const { captureId, amountUsd, customId, orderId } = args;

  // 1. custom_id presence + shape.
  if (customId === null) {
    return { ok: false, reason: "missing custom_id" };
  }
  const parsed = parsePrepaidCustomId(customId);
  if (parsed === null) {
    return { ok: false, reason: "bad custom_id" };
  }

  // 2 + 3. TAMPER GUARD + ownership — shared with the Stripe rail via
  // assertPrepaidGrantValid (amount BEFORE ownership, both BEFORE the RPC).
  // The custom_id was stamped at checkout (signature-verified by PayPal) and
  // amountUsd comes from PayPal's capture API — a mismatch means either the
  // buyer tampered, the rate changed mid-flight, or PayPal mis-reported.
  const chargedCents = Math.round(amountUsd * 100);
  const guard = await assertPrepaidGrantValid(admin, {
    studentId: parsed.studentId,
    hours: parsed.hours,
    rate: parsed.rate,
    chargedCents,
  });
  if (!guard.ok) {
    if (guard.reason.startsWith("amount mismatch")) {
      logError(
        "paypal-prepaid grant: amount mismatch (tamper/price-change)",
        new Error("amount-mismatch"),
        {
          tag: "paypal-prepaid",
          capture_id: captureId,
          student_id: parsed.studentId,
          hours: parsed.hours,
          rate_usd: parsed.rate,
          expected_usd: Math.round(parsed.hours * parsed.rate * 100) / 100,
          received_usd: amountUsd,
        },
      );
      return { ok: false, reason: "amount mismatch" };
    }
    return { ok: false, reason: guard.reason };
  }

  // 4. idempotent grant. grant_prepaid_hours is provider-aware: it keys
  //    idempotency on student_packages.provider_payment_ref (the capture id)
  //    and stamps payment_provider='paypal'. A duplicate captureId returns
  //    the existing lot id — no double grant, no second grant event.
  const { data: lotId, error: grantErr } = await admin.rpc("grant_prepaid_hours", {
    p_payment_intent: captureId,
    p_student: parsed.studentId,
    p_hours: parsed.hours,
    p_rate: parsed.rate,
    p_provider: "paypal",
  });

  if (grantErr || !lotId) {
    logError("paypal-prepaid grant: grant_prepaid_hours RPC failed", grantErr ?? new Error("no id"), {
      tag: "paypal-prepaid",
      capture_id: captureId,
      student_id: parsed.studentId,
      hours: parsed.hours,
      rate_usd: parsed.rate,
    });
    return { ok: false, reason: "grant failed" };
  }

  // 5. Best-effort payments audit row (mirrors the Stripe prepaid path in
  //    webhook-handlers.ts — `payments` is the cross-provider money audit
  //    trail). NON-FATAL: the money grant already succeeded above, so an
  //    audit-write failure is logged and swallowed, never thrown, and never
  //    rolls back the grant. Idempotent on the UNIQUE `paypal_capture_id`, so a
  //    webhook + return-route double-fire writes at most one row. amount_usd ==
  //    amount_before_tax + tax_amount satisfies the tax CHECK; provider='paypal'
  //    + paypal_order_id NOT NULL satisfies the provider CHECK. Skipped when the
  //    order id is absent (rare webhook capture with no related order) — the
  //    grant + prepaid_hours_events ledger stay the audit source there.
  if (orderId) {
    const { error: payErr } = await admin.from("payments").upsert(
      {
        student_id: parsed.studentId,
        amount_usd: amountUsd,
        amount_before_tax: amountUsd,
        tax_amount: 0,
        tax_rate: 0,
        provider: "paypal",
        status: "succeeded",
        paypal_order_id: orderId,
        paypal_capture_id: captureId,
        paid_at: new Date().toISOString(),
      },
      { onConflict: "paypal_capture_id", ignoreDuplicates: true },
    );
    if (payErr) {
      logError("paypal-prepaid grant: payments audit upsert failed (non-fatal)", payErr, {
        tag: "paypal-prepaid",
        capture_id: captureId,
        order_id: orderId,
      });
    }
  }

  return { ok: true, lotId: lotId as string };
}
