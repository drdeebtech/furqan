import { NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getStripe, isStripeConfigured } from "@/lib/stripe/client";
import { requireRole } from "@/lib/auth/require-admin";
import { checkRateLimit } from "@/lib/security/rate-limit";
import { UnauthenticatedError, ForbiddenError } from "@/lib/auth/errors";
import { logError, logInfo } from "@/lib/logger";
import { getSetting } from "@/lib/settings";
import {
  findAvailableSpecialist,
  countStudentActiveAssessments,
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
import { validateInstantSlot } from "@/lib/domains/single-sessions/instant-slot";
import { materializeSingleSessionBooking } from "@/lib/domains/single-sessions/materialize";
import {
  PAYMENTS_UNAVAILABLE_MESSAGE,
  PAYMENTS_UNAVAILABLE_STATUS,
} from "@/lib/payments/provider-unavailable";

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
    scheduledAt: z.string().datetime().optional(),
    // Student-local wall-clock of the selected slot — required with
    // scheduledAt for instant bookings. Availability is validated against
    // these (teacher_availability stores app-local wall-clock strings), never
    // against wall-clock re-derived from the UTC instant in the server's tz.
    dayOfWeek: z.number().int().min(0).max(6).optional(),
    localDate: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/)
      .optional(),
    localTime: z
      .string()
      .regex(/^([01]\d|2[0-3]):[0-5]\d$/)
      .optional(),
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
    if (val.productType === "instant" && val.scheduledAt) {
      if (val.dayOfWeek === undefined || !val.localDate || !val.localTime) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message:
            "dayOfWeek, localDate and localTime (student-local wall-clock) are required with scheduledAt",
          path: ["localTime"],
        });
      }
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

/**
 * Trust roadmap E1 / decision 40: one evaluation (assessment) per student
 * across specialties. Changing this also requires changing the partial
 * unique index uniq_active_assessment_per_student (it enforces exactly 1).
 */
const GLOBAL_ASSESSMENT_LIMIT_PER_STUDENT = 1;

/**
 * Load a price getter fail-closed. The pricing module throws on a CONFIGURED
 * but corrupt platform_settings value (PR #703); map that to null so the
 * route can return a generic 500 without leaking setting internals — an
 * unhandled throw here would escape the handler's JSON error contract.
 */
async function tryLoadPrice(load: () => Promise<number>): Promise<number | null> {
  try {
    return await load();
  } catch (err) {
    logError("single-session checkout: price load failed (corrupt setting?)", err, {
      tag: "single-sessions",
    });
    return null;
  }
}

function priceUnavailable(): NextResponse {
  return NextResponse.json(
    { success: false, error: "Pricing is temporarily unavailable" },
    { status: 500 },
  );
}

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

  // Per-user rate limit (fix #4): cap Checkout-session creation. Fail-open so a
  // limiter outage never blocks a real booking.
  if (!(await checkRateLimit(studentId, "checkout-single-session", 20))) {
    return NextResponse.json(
      { success: false, error: "Too many attempts — please wait a moment and try again." },
      { status: 429 },
    );
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
    // Malformed JSON body (request.json() threw a SyntaxError) → 400, not a
    // generic 500. The only awaited call in this try is request.json()/parse.
    return NextResponse.json(
      { error: "Invalid or malformed JSON body" },
      { status: 400 },
    );
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

    // Trust roadmap E1 / decision 40: ONE active assessment per student
    // across ALL specialties — the free evaluation is a single trial, not
    // one per specialty. Cancelled / no_show rows don't consume it (G5:
    // re-booking allowed). DB backstop: uniq_active_assessment_per_student.
    const activeAssessments = await countStudentActiveAssessments(studentId);
    if (activeAssessments >= GLOBAL_ASSESSMENT_LIMIT_PER_STUDENT) {
      return NextResponse.json(
        {
          success: false,
          error:
            "You already have an evaluation session. Each student gets one evaluation — if yours was cancelled, you can book again.",
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
    const assessmentPrice = await tryLoadPrice(getAssessmentPrice);
    if (assessmentPrice === null) return priceUnavailable();
    priceUsd = assessmentPrice;
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
    const instantPrice = await tryLoadPrice(getInstantPrice);
    if (instantPrice === null) return priceUnavailable();
    priceUsd = instantPrice;
    stripeMetadata = {
      booking_type: "instant",
      student_id: studentId,
      teacher_id: teacherId,
      ...(body.scheduledAt ? { scheduled_at: body.scheduledAt } : {}),
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

    const specializedPrice = await tryLoadPrice(() => getSpecializedPrice(purpose));
    if (specializedPrice === null) return priceUnavailable();
    priceUsd = specializedPrice;
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

  // ── Validate client-supplied teacherId BEFORE any Stripe interaction ──────
  // For instant/specialized the teacherId comes straight from the request body;
  // a syntactically valid UUID is not enough. Assessment already validated its
  // teacher via findAvailableSpecialist, so only the other two need this gate
  // (FR-013 fail-before-charge parity).
  if (body.productType !== "assessment") {
    const { data: teacherOk, error: teacherLookupErr } = await admin
      .from("teacher_profiles")
      .select("teacher_id")
      .eq("teacher_id", teacherId)
      .eq("is_archived", false)
      .eq("is_accepting", true)
      .maybeSingle<{ teacher_id: string }>();
    if (teacherLookupErr) {
      // Don't mask a real DB/RLS/schema failure as "teacher unavailable" (422).
      logError("single-session checkout: teacher_profiles lookup failed", teacherLookupErr, {
        tag: "single-sessions",
        teacher_id: teacherId,
      });
      return NextResponse.json(
        { success: false, error: "Could not verify teacher availability" },
        { status: 500 },
      );
    }
    if (!teacherOk) {
      return NextResponse.json(
        { success: false, error: "Selected teacher is not available for booking" },
        { status: 422 },
      );
    }

    if (body.productType === "instant" && body.scheduledAt) {
      // zod superRefine guarantees these; keep a fail-closed runtime narrow so
      // slot validation can never silently run without client wall-clock.
      if (body.dayOfWeek === undefined || !body.localDate || !body.localTime) {
        return NextResponse.json(
          { success: false, error: "Missing student-local time fields for the selected slot" },
          { status: 400 },
        );
      }
      const slot = await validateInstantSlot(admin, {
        teacherId,
        scheduledAt: new Date(body.scheduledAt),
        dayOfWeek: body.dayOfWeek,
        localDate: body.localDate,
        localTime: body.localTime,
        durationMin: 30,
      });
      if (!slot.ok) {
        const msg = {
          past: "Selected time is in the past",
          unavailable: "Teacher is not available at the selected time",
          blocked: "Selected time is unavailable",
          overlap: "Selected time is already booked",
          lookup_failed: "Could not verify the selected time",
        }[slot.reason];
        return NextResponse.json(
          { success: false, error: msg },
          { status: slot.reason === "lookup_failed" ? 500 : 422 },
        );
      }
    }
  }

  // ── Zero-price path: create the booking directly via the atomic creator ──
  // The SAME creator the webhook calls — no bare INSERT. With payment_id NULL
  // the payment-link step is a no-op (no charge to link). data-model §3.
  if (priceUsd <= 0) {
    // Delegates to the shared materialize seam (Task 8) — the SAME RPC
    // choice, arg assembly, and target_scope parse the webhook uses. p_payment_id
    // is null here (no charge to link); the instant branch now ALSO gets the
    // best-effort booking.created emit the paid webhook always had (the
    // verified drift fix — see materialize.ts docstring).
    const result = await materializeSingleSessionBooking(admin, {
      studentId,
      teacherId,
      bookingType: directCreate?.kind ?? "instant",
      paymentId: null,
      specialty: directCreate?.specialty ?? null,
      purpose: directCreate?.purpose ?? null,
      targetScopeRaw: directCreate?.targetScope ? JSON.stringify(directCreate.targetScope) : null,
      scheduledAt: body.scheduledAt ?? null,
    });

    if (!result.ok) {
      if (result.code === "duplicate_active_assessment") {
        // Race window: two concurrent free-evaluation checkouts can both pass
        // the pre-checks; the loser hits the DB backstop index. Surface the
        // same friendly 409 as the pre-check, not a 500.
        return NextResponse.json(
          {
            success: false,
            error:
              "You already have an evaluation session. Each student gets one evaluation — if yours was cancelled, you can book again.",
          },
          { status: 409 },
        );
      }
      if (directCreate) {
        logError("single-session: zero-price creator RPC failed", result.cause, {
          tag: "single-sessions",
          student_id: studentId,
          product_type: directCreate.kind,
        });
      } else {
        logError("single-session: zero-price instant booking RPC failed", result.cause, {
          tag: "single-sessions",
          student_id: studentId,
          teacher_id: teacherId,
        });
      }
      return NextResponse.json(
        { success: false, error: "Booking creation failed" },
        { status: 500 },
      );
    }

    if (directCreate) {
      logInfo("single-session: zero-price booking created", {
        tag: "single-sessions",
        booking_id: result.bookingId,
        product_type: directCreate.kind,
      });
    } else {
      logInfo("single-session: zero-price instant booking created", {
        tag: "single-sessions",
        booking_id: result.bookingId,
      });
    }
    return NextResponse.json({
      success: true,
      data: { bookingId: result.bookingId, message: "booking_created_free" },
    });
  }

  // ── Non-zero price: Stripe Checkout (payment mode) ────────────────────────
  if (!isStripeConfigured()) {
    // The student reaches this from the teacher page's pay-per-session form,
    // which renders regardless of provider config. "Server misconfigured" (the
    // old copy) was English-only and meaningless to an Arabic-first audience;
    // clients render `error` verbatim, so it has to be real user copy.
    logError("single-session: Stripe not configured but price > 0", new Error("no-stripe-key"), {
      tag: "single-sessions",
    });
    return NextResponse.json(
      { success: false, error: PAYMENTS_UNAVAILABLE_MESSAGE },
      { status: PAYMENTS_UNAVAILABLE_STATUS },
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
  // 10-min double-submit window keyed on the FULL booking metadata (sorted), so
  // ANY distinguishing field — purpose, target_scope, specialty, teacher, slot —
  // yields a distinct key: two genuinely-identical submissions dedupe to the
  // first session, while distinct bookings never collide on a shared key.
  const idemBucket = Math.floor(Date.now() / 600_000);
  const idemKey = `single:${Object.entries(stripeMetadata)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => `${k}=${v}`)
    .join("|")}:${idemBucket}`;

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
    }, { idempotencyKey: idemKey });

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
