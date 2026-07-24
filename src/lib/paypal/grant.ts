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
import {
  getAssessmentPrice,
  getInstantPrice,
  getSpecializedPrice,
  type SpecializedPurpose,
} from "@/lib/domains/single-sessions/pricing";
import {
  materializeSingleSessionBooking,
  type SingleSessionBookingType,
} from "@/lib/domains/single-sessions/materialize";
import { validateTargetScope } from "@/lib/domains/single-sessions/quran-validation";

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

const SingleSessionTargetScopeSchema = z
  .object({
    surah: z.number().int().optional(),
    ayahStart: z.number().int().optional(),
    ayahEnd: z.number().int().optional(),
    juz: z.number().int().optional(),
    mutoon: z.string().trim().max(200).optional(),
    mutashabihat: z.string().trim().max(200).optional(),
  })
  .strict();

type SingleSessionTargetScope = z.infer<typeof SingleSessionTargetScopeSchema>;

export interface PaypalSingleSessionContext {
  studentId: string;
  bookingType: SingleSessionBookingType;
  priceCents: number;
  teacherId: string;
  specialty: string | null;
  purpose: SpecializedPurpose | null;
  targetScope: SingleSessionTargetScope | null;
  scheduledAt: string | null;
}

export interface GrantPaypalSingleSessionCaptureArgs {
  captureId: string;
  amountUsd: number;
  customId: string | null;
  orderId: string | null;
}

export type GrantPaypalSingleSessionCaptureResult =
  | { ok: true; bookingId: string; duplicate: boolean }
  | { ok: false; reason: string };

const SINGLE_SESSION_TYPE_CODES = {
  assessment: "a",
  instant: "i",
  specialized: "s",
} as const;

const SPECIALIZED_PURPOSE_CODES: Record<SpecializedPurpose, string> = {
  review: "r",
  consolidate_surah: "c",
  memorize_mutoon: "m",
  test_juz_mutashabihat: "j",
};

const SINGLE_SESSION_CUSTOM_ID_MAX_LENGTH = 127;

function encodeUuid(uuid: string): string | null {
  const parsed = z.uuid().safeParse(uuid);
  if (!parsed.success) return null;
  return Buffer.from(parsed.data.replaceAll("-", ""), "hex").toString("base64url");
}

function decodeUuid(encoded: string): string | null {
  if (!/^[A-Za-z0-9_-]{22}$/.test(encoded)) return null;
  const hex = Buffer.from(encoded, "base64url").toString("hex");
  if (hex.length !== 32) return null;
  const uuid = [
    hex.slice(0, 8),
    hex.slice(8, 12),
    hex.slice(12, 16),
    hex.slice(16, 20),
    hex.slice(20),
  ].join("-");
  const parsed = z.uuid().safeParse(uuid);
  return parsed.success ? parsed.data : null;
}

function encodeText(text: string): string {
  return Buffer.from(text, "utf8").toString("base64url");
}

function decodeText(encoded: string): string | null {
  if (!/^[A-Za-z0-9_-]+$/.test(encoded)) return null;
  return Buffer.from(encoded, "base64url").toString("utf8");
}

function singleSessionDetails(context: PaypalSingleSessionContext): string | null {
  if (context.bookingType === "assessment") {
    return context.specialty ? encodeText(context.specialty) : null;
  }
  if (context.bookingType === "instant") {
    return context.scheduledAt
      ? new Date(context.scheduledAt).getTime().toString(36)
      : "-";
  }
  if (!context.purpose || !context.targetScope) return null;
  const purposeCode = SPECIALIZED_PURPOSE_CODES[context.purpose];
  return `${purposeCode}.${encodeText(JSON.stringify(context.targetScope))}`;
}

export function buildPaypalSingleSessionCustomId(
  context: PaypalSingleSessionContext,
): string | null {
  const studentId = encodeUuid(context.studentId);
  const teacherId = encodeUuid(context.teacherId);
  const details = singleSessionDetails(context);
  if (!studentId || !teacherId || !details) return null;
  if (!Number.isSafeInteger(context.priceCents) || context.priceCents <= 0) return null;

  const customId = [
    "single_session",
    studentId,
    SINGLE_SESSION_TYPE_CODES[context.bookingType],
    String(context.priceCents),
    teacherId,
    details,
  ].join(":");
  return customId.length <= SINGLE_SESSION_CUSTOM_ID_MAX_LENGTH ? customId : null;
}

function bookingTypeFromCode(code: string): SingleSessionBookingType | null {
  const entry = Object.entries(SINGLE_SESSION_TYPE_CODES).find(([, value]) => value === code);
  return entry ? (entry[0] as SingleSessionBookingType) : null;
}

function purposeFromCode(code: string): SpecializedPurpose | null {
  const entry = Object.entries(SPECIALIZED_PURPOSE_CODES).find(([, value]) => value === code);
  return entry ? (entry[0] as SpecializedPurpose) : null;
}

function parseSpecializedDetails(
  details: string,
): Pick<PaypalSingleSessionContext, "purpose" | "targetScope"> | null {
  const separator = details.indexOf(".");
  if (separator !== 1) return null;
  const purpose = purposeFromCode(details.slice(0, separator));
  const targetScopeRaw = decodeText(details.slice(separator + 1));
  if (!purpose || !targetScopeRaw) return null;
  try {
    const parsed = SingleSessionTargetScopeSchema.safeParse(JSON.parse(targetScopeRaw));
    if (!parsed.success || !validateTargetScope(parsed.data).valid) return null;
    return { purpose, targetScope: parsed.data };
  } catch {
    return null;
  }
}

function parseAssessmentDetails(
  details: string,
): Pick<
  PaypalSingleSessionContext,
  "specialty" | "purpose" | "targetScope" | "scheduledAt"
> | null {
  const specialty = decodeText(details);
  if (!specialty || specialty.length > 80) return null;
  return { specialty, purpose: null, targetScope: null, scheduledAt: null };
}

function parseInstantDetails(
  details: string,
): Pick<
  PaypalSingleSessionContext,
  "specialty" | "purpose" | "targetScope" | "scheduledAt"
> | null {
  if (details === "-") {
    return { specialty: null, purpose: null, targetScope: null, scheduledAt: null };
  }
  if (!/^[0-9a-z]+$/.test(details)) return null;
  const timestamp = Number.parseInt(details, 36);
  if (!Number.isSafeInteger(timestamp) || timestamp <= 0) return null;
  return {
    specialty: null,
    purpose: null,
    targetScope: null,
    scheduledAt: new Date(timestamp).toISOString(),
  };
}

function parseSingleSessionDetails(
  bookingType: SingleSessionBookingType,
  details: string,
): Pick<
  PaypalSingleSessionContext,
  "specialty" | "purpose" | "targetScope" | "scheduledAt"
> | null {
  if (bookingType === "assessment") {
    return parseAssessmentDetails(details);
  }
  if (bookingType === "instant") {
    return parseInstantDetails(details);
  }
  const specialized = parseSpecializedDetails(details);
  return specialized
    ? { specialty: null, ...specialized, scheduledAt: null }
    : null;
}

export function parseSingleSessionCustomId(
  customId: string,
): PaypalSingleSessionContext | null {
  const segments = customId.split(":");
  if (segments.length !== 6 || segments[0] !== "single_session") return null;
  const [, studentEncoded, typeCode, priceRaw, teacherEncoded, detailsRaw] = segments;
  const studentId = decodeUuid(studentEncoded);
  const teacherId = decodeUuid(teacherEncoded);
  const bookingType = bookingTypeFromCode(typeCode);
  if (!studentId || !teacherId || !bookingType || !/^[1-9]\d*$/.test(priceRaw)) return null;
  const priceCents = Number(priceRaw);
  if (!Number.isSafeInteger(priceCents)) return null;
  const details = parseSingleSessionDetails(bookingType, detailsRaw);
  return details
    ? { studentId, teacherId, bookingType, priceCents, ...details }
    : null;
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

interface PaypalPaymentRecord {
  id: string;
  booking_id: string | null;
}

type RecordPaypalPaymentResult =
  | { ok: true; payment: PaypalPaymentRecord; existing: boolean }
  | { ok: false; reason: string };

async function expectedSingleSessionPriceCents(
  context: PaypalSingleSessionContext,
): Promise<number> {
  let priceUsd: number;
  if (context.bookingType === "assessment") {
    priceUsd = await getAssessmentPrice();
  } else if (context.bookingType === "instant") {
    priceUsd = await getInstantPrice();
  } else {
    priceUsd = await getSpecializedPrice(context.purpose as SpecializedPurpose);
  }
  return Math.round(priceUsd * 100);
}

async function findPaypalPayment(
  admin: AdminClient,
  orderId: string,
): Promise<RecordPaypalPaymentResult> {
  const { data: payment, error } = await admin
    .from("payments")
    .select("id, booking_id")
    .eq("paypal_order_id", orderId)
    .maybeSingle<PaypalPaymentRecord>();
  if (error || !payment) {
    return { ok: false, reason: "payment lookup failed" };
  }
  return { ok: true, payment, existing: true };
}

async function recordPaypalSingleSessionPayment(
  admin: AdminClient,
  args: GrantPaypalSingleSessionCaptureArgs,
  context: PaypalSingleSessionContext,
): Promise<RecordPaypalPaymentResult> {
  const { data: payment, error } = await admin
    .from("payments")
    .insert({
      student_id: context.studentId,
      amount_usd: context.priceCents / 100,
      amount_before_tax: context.priceCents / 100,
      tax_amount: 0,
      tax_rate: 0,
      provider: "paypal",
      status: "succeeded",
      paypal_order_id: args.orderId,
      paypal_capture_id: args.captureId,
      paid_at: new Date().toISOString(),
    })
    .select("id, booking_id")
    .maybeSingle<PaypalPaymentRecord>();
  if (!error && payment) {
    return { ok: true, payment, existing: false };
  }
  if (error?.code === "23505" && args.orderId) {
    return findPaypalPayment(admin, args.orderId);
  }
  return { ok: false, reason: "payment insert failed" };
}

function materializeInput(
  context: PaypalSingleSessionContext,
  paymentId: string,
) {
  return {
    studentId: context.studentId,
    teacherId: context.teacherId,
    bookingType: context.bookingType,
    paymentId,
    specialty: context.specialty,
    purpose: context.purpose,
    targetScopeRaw: context.targetScope
      ? JSON.stringify(context.targetScope)
      : null,
    scheduledAt: context.scheduledAt,
  };
}

type ValidateSingleSessionCaptureResult =
  | { ok: true; context: PaypalSingleSessionContext }
  | { ok: false; reason: string };

async function validateSingleSessionCapture(
  admin: AdminClient,
  args: GrantPaypalSingleSessionCaptureArgs,
): Promise<ValidateSingleSessionCaptureResult> {
  if (!args.orderId) return { ok: false, reason: "missing paypal order id" };
  if (!args.customId) return { ok: false, reason: "missing custom_id" };
  const context = parseSingleSessionCustomId(args.customId);
  if (!context) return { ok: false, reason: "bad custom_id" };

  let expectedCents: number;
  try {
    expectedCents = await expectedSingleSessionPriceCents(context);
  } catch (error) {
    logError("paypal-single-session grant: price lookup failed", error, {
      tag: "paypal-single-session",
      order_id: args.orderId,
    });
    return { ok: false, reason: "price lookup failed" };
  }
  if (context.priceCents !== expectedCents) {
    return { ok: false, reason: "custom_id price mismatch" };
  }

  const guard = await assertPrepaidGrantValid(admin, {
    studentId: context.studentId,
    hours: 1,
    rate: expectedCents / 100,
    chargedCents: Math.round(args.amountUsd * 100),
  });
  if (!guard.ok) return { ok: false, reason: guard.reason };
  return { ok: true, context };
}

export async function grantPaypalSingleSessionCapture(
  admin: AdminClient,
  args: GrantPaypalSingleSessionCaptureArgs,
): Promise<GrantPaypalSingleSessionCaptureResult> {
  const validated = await validateSingleSessionCapture(admin, args);
  if (!validated.ok) return validated;

  const recorded = await recordPaypalSingleSessionPayment(
    admin,
    args,
    validated.context,
  );
  if (!recorded.ok) return recorded;
  if (recorded.payment.booking_id) {
    return {
      ok: true,
      bookingId: recorded.payment.booking_id,
      duplicate: true,
    };
  }

  const materialized = await materializeSingleSessionBooking(
    admin,
    materializeInput(validated.context, recorded.payment.id),
  );
  if (!materialized.ok) {
    logError("paypal-single-session grant: booking materialization failed", materialized.cause, {
      tag: "paypal-single-session",
      order_id: args.orderId,
      payment_id: recorded.payment.id,
      booking_type: validated.context.bookingType,
    });
    return { ok: false, reason: "grant failed" };
  }
  return {
    ok: true,
    bookingId: materialized.bookingId,
    duplicate: recorded.existing,
  };
}
