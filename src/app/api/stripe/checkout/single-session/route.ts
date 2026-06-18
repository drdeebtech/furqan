import { NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getStripe, isStripeConfigured } from "@/lib/stripe/client";
import { requireRole } from "@/lib/auth/require-admin";
import { UnauthenticatedError, ForbiddenError } from "@/lib/auth/errors";
import { logError, logInfo } from "@/lib/logger";
import { getSetting } from "@/lib/settings";
import {
  findAvailableSpecialist,
  countStudentAssessmentsForSpecialty,
} from "@/lib/domains/single-sessions/specialist-matching";
import {
  getAssessmentPrice,
  getInstantPrice,
  getSpecializedPrice,
  SPECIALIZED_PURPOSES,
  type SpecializedPurpose,
} from "@/lib/domains/single-sessions/pricing";
import {
  validateTargetScope,
  type TargetScope,
} from "@/lib/domains/single-sessions/quran-validation";

export const maxDuration = 60;

/**
 * Spec 022 (م٥) — input schema for one-time-paid single-session checkout.
 *
 * Three product types share one route:
 *   • assessment  — auto-matched specialist by `specialty` (fail-before-charge)
 *   • instant     — student picks `teacherId`, charged the configured price
 *   • specialized — student picks `teacherId` + `purpose` + `targetScope`
 *
 * `studentId` is NEVER in the body — it is derived from `auth.getUser()`
 * and stamped into Stripe metadata so the webhook can re-derive it
 * server-side (FR-005).
 */
const TargetScopeSchema = z
  .object({
    surah: z.number().int().optional(),
    ayahStart: z.number().int().optional(),
    ayahEnd: z.number().int().optional(),
    juz: z.number().int().optional(),
    mutoon: z.string().trim().max(200).optional(),
    mutashabihat: z.string().trim().max(200).optional(),
  })
  .strict();

const SingleSessionCheckoutSchema = z
  .object({
    productType: z.enum(["assessment", "instant", "specialized"]),
    specialty: z.string().trim().min(1).max(80).optional(),
    purpose: z.enum(SPECIALIZED_PURPOSES).optional(),
    targetScope: TargetScopeSchema.optional(),
    teacherId: z.string().uuid().optional(),
    currency: z.literal("usd").default("usd"),
  })
  .strict()
  .superRefine((val, ctx) => {
    if (val.productType === "assessment" && !val.specialty) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "specialty is required for assessment bookings",
        path: ["specialty"],
      });
    }
    if (val.productType === "instant" && !val.teacherId) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "teacherId is required for instant bookings",
        path: ["teacherId"],
      });
    }
    if (val.productType === "specialized") {
      if (!val.teacherId) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "teacherId is required for specialized bookings",
          path: ["teacherId"],
        });
      }
      if (!val.purpose) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "purpose is required for specialized bookings",
          path: ["purpose"],
        });
      }
      if (!val.targetScope) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "targetScope is required for specialized bookings",
          path: ["targetScope"],
        });
      }
    }
  });

type SingleSessionCheckout = z.infer<typeof SingleSessionCheckoutSchema>;

interface AssessmentLimitResult {
  ok: boolean;
  limit: number;
  current: number;
}
async function checkAssessmentLimit(
  studentId: string,
  specialty: string,
): Promise<AssessmentLimitResult> {
  const raw = await getSetting("hifz_assessment_limit_per_specialty");
  // Spec 022 / CodeRabbit #3: Number(null) and Number("") both return 0,
  // which previously made the default-policy branch unreachable whenever the
  // setting was missing or blank — every assessment was blocked because the
  // limit collapsed to 0. Treat null/undefined/blank/non-finite as the
  // default policy (1 attempt per specialty).
  const DEFAULT_LIMIT = 1;
  const limit = (() => {
    if (raw === null || raw === undefined || raw.trim() === "") return DEFAULT_LIMIT;
    const n = Number(raw);
    if (!Number.isFinite(n) || n < 0) return DEFAULT_LIMIT;
    return Math.floor(n);
  })();
  const current = await countStudentAssessmentsForSpecialty(studentId, specialty);
  return { ok: current < limit, limit, current };
}

/**
 * POST /api/stripe/checkout/single-session
 *
 * Creates a Stripe Checkout session in **payment** mode for one of the three
 * single-session products. Fail-before-charge ordering (R-004): every check
 * that can fail (specialist match, assessment limit, Quran range, currency)
 * runs BEFORE the Stripe call so a request that cannot be served never
 * initiates a charge.
 *
 * When the configured price is **0** (e.g. free assessment), no Stripe
 * Checkout is created — the booking is materialized directly via the atomic
 * `create_single_session_booking` SECURITY DEFINER creator with
 * `p_payment_id = NULL`. This is the intended exception to NFR-001
 * (fail-closed): the fail-before-charge gates already validated the request,
 * and there is no charge to confirm.
 */
export async function POST(request: Request) {
  // ── Auth gate (FR-005: identity from session only) ────────────────────────
  let studentId: string;
  try {
    ({ id: studentId } = await requireRole("student"));
  } catch (e) {
    if (e instanceof UnauthenticatedError) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    if (e instanceof ForbiddenError) {
      return NextResponse.json({ error: "Only students may book single sessions" }, { status: 403 });
    }
    throw e;
  }

  // ── Body validation (FR-016: zod at the boundary) ─────────────────────────
  let body: SingleSessionCheckout;
  try {
    body = SingleSessionCheckoutSchema.parse(await request.json());
  } catch (e) {
    if (e instanceof z.ZodError) {
      return NextResponse.json(
        { error: "Invalid body", issues: e.flatten() },
        { status: 400 },
      );
    }
    throw e;
  }

  // ── Currency gate (FR / Edge: USD only this phase) ────────────────────────
  // body.currency defaults to 'usd'; a non-USD value is rejected via zod enum
  // (422). Kept explicit for clarity and to surface a distinct message.
  if (body.currency !== "usd") {
    return NextResponse.json(
      { success: false, error: `Unsupported currency: ${body.currency}. USD only.` },
      { status: 422 },
    );
  }

  const admin = createAdminClient();

  // ── Product-specific fail-before-charge gates ─────────────────────────────
  let teacherId: string;
  let priceUsd: number;
  let stripeMetadata: Record<string, string>;
  let directCreate:
    | {
        kind: "assessment" | "specialized";
        specialty: string | null;
        purpose: SpecializedPurpose | null;
        targetScope: TargetScope | null;
      }
    | null = null;

  if (body.productType === "assessment") {
    const specialty = body.specialty as string;

    // FR-014: per-specialty limit checked BEFORE any Stripe call (409).
    const limitCheck = await checkAssessmentLimit(studentId, specialty);
    if (!limitCheck.ok) {
      return NextResponse.json(
        {
          success: false,
          error: `Assessment limit reached for this specialty (${limitCheck.current}/${limitCheck.limit})`,
        },
        { status: 409 },
      );
    }

    // FR-012/FR-013: matching specialist must exist before charge (422).
    const specialist = await findAvailableSpecialist(specialty);
    if (!specialist) {
      return NextResponse.json(
        { success: false, error: `No specialist available for specialty: ${specialty}` },
        { status: 422 },
      );
    }
    teacherId = specialist.teacherId;
    priceUsd = await getAssessmentPrice();
    stripeMetadata = {
      booking_type: "assessment",
      student_id: studentId,
      teacher_id: teacherId,
      specialty,
    };
    directCreate = {
      kind: "assessment",
      specialty,
      purpose: null,
      targetScope: null,
    };
  } else if (body.productType === "instant") {
    teacherId = body.teacherId as string;
    priceUsd = await getInstantPrice();
    stripeMetadata = {
      booking_type: "instant",
      student_id: studentId,
      teacher_id: teacherId,
    };
  } else {
    // specialized
    teacherId = body.teacherId as string;
    const purpose = body.purpose as SpecializedPurpose;
    const targetScope = body.targetScope as TargetScope;

    // FR-015: Quran range validated against canonical reference before any charge.
    const scopeCheck = validateTargetScope(targetScope);
    if (!scopeCheck.valid) {
      return NextResponse.json(
        { success: false, error: scopeCheck.error ?? "Invalid target_scope" },
        { status: 422 },
      );
    }

    priceUsd = await getSpecializedPrice(purpose);
    stripeMetadata = {
      booking_type: "specialized",
      student_id: studentId,
      teacher_id: teacherId,
      purpose,
      target_scope: JSON.stringify(targetScope),
    };
    directCreate = {
      kind: "specialized",
      specialty: null,
      purpose,
      targetScope,
    };
  }

  // ── Zero-price path: create the booking directly via the atomic creator ──
  // The SAME creator the webhook calls — no bare INSERT. With payment_id NULL
  // the payment-link step is a no-op (no charge to link). data-model §3.
  if (priceUsd <= 0) {
    if (!directCreate) {
      // Instant zero-price is allowed — model it via the instant creator path.
      const { data: bookingId, error: rpcErr } = await admin.rpc(
        "start_instant_session_booking",
        {
          p_student_id: studentId,
          p_teacher_id: teacherId,
          p_session_type: "hifz" as const,
          p_duration_min: 30,
          p_rate_snapshot: 0,
          p_amount_usd: 0,
          p_scheduled_at: new Date().toISOString(),
          p_payment_id: undefined,
        },
      );
      if (rpcErr || !bookingId) {
        logError("single-session: zero-price instant booking RPC failed", rpcErr ?? new Error("no id"), {
          tag: "single-sessions",
          student_id: studentId,
          teacher_id: teacherId,
        });
        return NextResponse.json(
          { success: false, error: "Booking creation failed" },
          { status: 500 },
        );
      }
      logInfo("single-session: zero-price instant booking created", {
        tag: "single-sessions",
        booking_id: bookingId as string,
      });
      return NextResponse.json({
        success: true,
        data: { bookingId: bookingId as string, message: "booking_created_free" },
      });
    }

    const { data: bookingId, error: rpcErr } = await admin.rpc(
      "create_single_session_booking",
      {
        p_student_id: studentId,
        p_teacher_id: teacherId,
        p_booking_product_type: directCreate.kind,
        p_payment_id: undefined,
        p_specialty: directCreate.specialty ?? undefined,
        p_purpose: directCreate.purpose ?? undefined,
        p_target_scope: (directCreate.targetScope ?? undefined) as unknown as never,
      },
    );
    if (rpcErr || !bookingId) {
      logError("single-session: zero-price creator RPC failed", rpcErr ?? new Error("no id"), {
        tag: "single-sessions",
        student_id: studentId,
        product_type: directCreate.kind,
      });
      return NextResponse.json(
        { success: false, error: "Booking creation failed" },
        { status: 500 },
      );
    }
    logInfo("single-session: zero-price booking created", {
      tag: "single-sessions",
      booking_id: bookingId as string,
      product_type: directCreate.kind,
    });
    return NextResponse.json({
      success: true,
      data: { bookingId: bookingId as string, message: "booking_created_free" },
    });
  }

  // ── Non-zero price: Stripe Checkout (payment mode) ────────────────────────
  if (!isStripeConfigured()) {
    logError("single-session: Stripe not configured but price > 0", new Error("no-stripe-key"), {
      tag: "single-sessions",
    });
    return NextResponse.json(
      { success: false, error: "Server misconfigured" },
      { status: 500 },
    );
  }

  const appUrl = process.env.NEXT_PUBLIC_APP_URL;
  if (!appUrl) {
    logError("single-session: NEXT_PUBLIC_APP_URL not configured", new Error("config-missing"), {
      tag: "single-sessions",
    });
    return NextResponse.json(
      { success: false, error: "Server misconfigured" },
      { status: 500 },
    );
  }

  const userClient = await createClient();
  let email: string | undefined;
  try {
    const { data } = await userClient.auth.getUser();
    email = data.user?.email ?? undefined;
  } catch {
    email = undefined;
  }

  const stripe = getStripe();
  const amountCents = Math.round(priceUsd * 100);

  try {
    const session = await stripe.checkout.sessions.create({
      mode: "payment",
      ...(email ? { customer_email: email } : {}),
      line_items: [
        {
          quantity: 1,
          price_data: {
            currency: "usd",
            unit_amount: amountCents,
            product_data: {
              name: describeProduct(body, priceUsd),
            },
          },
        },
      ],
      client_reference_id: studentId,
      metadata: stripeMetadata,
      payment_intent_data: { metadata: stripeMetadata },
      success_url: `${appUrl}/student/dashboard?single_session=success`,
      cancel_url: `${appUrl}/student/dashboard?single_session=cancelled`,
    });

    if (!session.url) {
      logError("single-session: Stripe returned no url", new Error("no url"), {
        tag: "single-sessions",
        student_id: studentId,
      });
      return NextResponse.json(
        { success: false, error: "Checkout session has no url" },
        { status: 502 },
      );
    }

    return NextResponse.json({ success: true, data: { checkoutUrl: session.url } });
  } catch (err) {
    logError("single-session: stripe.checkout.sessions.create failed", err, {
      tag: "single-sessions",
      student_id: studentId,
      product_type: body.productType,
    });
    return NextResponse.json(
      { success: false, error: "Checkout creation failed" },
      { status: 500 },
    );
  }
}

/** Human-readable product name for the Stripe Checkout line item. */
function describeProduct(body: SingleSessionCheckout, priceUsd: number): string {
  switch (body.productType) {
    case "assessment":
      return `Assessment session (${body.specialty ?? "general"}) — $${priceUsd.toFixed(2)}`;
    case "instant":
      return `Instant session — $${priceUsd.toFixed(2)}`;
    case "specialized":
      return `Specialized session (${body.purpose ?? "review"}) — $${priceUsd.toFixed(2)}`;
  }
}
