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
  const hours = Number(hoursRaw);
  if (!Number.isInteger(hours) || hours <= 0) return null;

  // rate: finite positive number. Reject '0', negatives, NaN, empty.
  const rate = Number(rateRaw);
  if (!Number.isFinite(rate) || rate <= 0) return null;

  return { studentId: studentIdParsed.data, hours, rate };
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
  const { captureId, amountUsd, customId } = args;

  // 1. custom_id presence + shape.
  if (customId === null) {
    return { ok: false, reason: "missing custom_id" };
  }
  const parsed = parsePrepaidCustomId(customId);
  if (parsed === null) {
    return { ok: false, reason: "bad custom_id" };
  }

  // 2. TAMPER GUARD — charged amount must equal hours × rate (cents-equal).
  //    This is the critical reconciliation: the custom_id was stamped at
  //    checkout (signature-verified by PayPal), and amountUsd comes from
  //    PayPal's capture API. A mismatch means either the buyer tampered, the
  //    rate changed mid-flight, or PayPal mis-reported — NEVER grant.
  const expectedUsd = Math.round(parsed.hours * parsed.rate * 100) / 100;
  if (Math.round(amountUsd * 100) !== Math.round(expectedUsd * 100)) {
    logError(
      "paypal-prepaid grant: amount mismatch (tamper/price-change)",
      new Error("amount-mismatch"),
      {
        tag: "paypal-prepaid",
        capture_id: captureId,
        student_id: parsed.studentId,
        hours: parsed.hours,
        rate_usd: parsed.rate,
        expected_usd: expectedUsd,
        received_usd: amountUsd,
      },
    );
    return { ok: false, reason: "amount mismatch" };
  }

  // 3. ownership — the student_id must resolve to a real profile with role
  //    'student'. A bogus/deleted id or a non-student role fails closed.
  const { data: profile, error: profileErr } = await admin
    .from("profiles")
    .select("id, role")
    .eq("id", parsed.studentId)
    .maybeSingle<{ id: string; role: string | null }>();
  if (profileErr) {
    logError("paypal-prepaid grant: profile lookup failed", profileErr, {
      tag: "paypal-prepaid",
      capture_id: captureId,
      student_id: parsed.studentId,
    });
    return { ok: false, reason: "profile lookup failed" };
  }
  if (!profile) {
    return { ok: false, reason: "no profile" };
  }
  if (profile.role !== "student") {
    return { ok: false, reason: "not a student" };
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

  // ponytail: no neutral payment-ref column on payments; grant/ledger is the audit source. Add a paypal ref column in a later migration.
  // (The `payments` table has provider-SPECIFIC columns — stripe_payment_intent,
  // paypal_order_id, paypal_capture_id — and a CHECK requiring paypal_order_id
  // NOT NULL for PayPal rows. We don't have the order id here (only the capture
  // id), and there is no single provider-neutral ref column. Writing a fake
  // stripe_payment_intent for a PayPal payment is forbidden. The grant +
  // billing_events ledger is the audit source for PayPal until a neutral column
  // is added.)

  return { ok: true, lotId: lotId as string };
}
