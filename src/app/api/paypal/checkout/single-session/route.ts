import { NextResponse } from "next/server";
import { z } from "zod";
import { requireRole } from "@/lib/auth/require-admin";
import { ForbiddenError, UnauthenticatedError } from "@/lib/auth/errors";
import { checkRateLimit } from "@/lib/security/rate-limit";
import { createAdminClient } from "@/lib/supabase/admin";
import { createPayPalOrder, isPayPalConfigured } from "@/lib/paypal/client";
import { buildPaypalSingleSessionCustomId } from "@/lib/paypal/grant";
import { isFeatureEnabled, getSetting } from "@/lib/settings";
import { logError, logInfo } from "@/lib/logger";
import {
  countStudentActiveAssessments,
  countStudentAssessmentsForSpecialty,
  findAvailableSpecialist,
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
import {
  materializeSingleSessionBooking,
  type MaterializeSingleSessionInput,
} from "@/lib/domains/single-sessions/materialize";
import {
  PAYMENTS_UNAVAILABLE_MESSAGE,
  PAYMENTS_UNAVAILABLE_STATUS,
} from "@/lib/payments/provider-unavailable";

export const maxDuration = 60;

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
    dayOfWeek: z.number().int().min(0).max(6).optional(),
    localDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    localTime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/).optional(),
    currency: z.literal("usd").default("usd"),
  })
  .strict()
  .superRefine((body, ctx) => {
    if (body.productType === "assessment" && !body.specialty) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "specialty is required for assessment bookings",
        path: ["specialty"],
      });
    }
    if (body.productType === "instant" && !body.teacherId) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "teacherId is required for instant bookings",
        path: ["teacherId"],
      });
    }
    if (
      body.productType === "instant" &&
      body.scheduledAt &&
      (body.dayOfWeek === undefined || !body.localDate || !body.localTime)
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message:
          "dayOfWeek, localDate and localTime are required with scheduledAt",
        path: ["localTime"],
      });
    }
    if (body.productType === "specialized") {
      for (const [field, present] of [
        ["teacherId", Boolean(body.teacherId)],
        ["purpose", Boolean(body.purpose)],
        ["targetScope", Boolean(body.targetScope)],
      ] as const) {
        if (!present) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: `${field} is required for specialized bookings`,
            path: [field],
          });
        }
      }
    }
  });

type SingleSessionCheckout = z.infer<typeof SingleSessionCheckoutSchema>;
type AdminClient = ReturnType<typeof createAdminClient>;

interface ResolvedCheckout {
  priceUsd: number;
  materialize: MaterializeSingleSessionInput;
}

type ResolveCheckoutResult =
  | { ok: true; checkout: ResolvedCheckout }
  | { ok: false; response: NextResponse };

function errorResponse(error: string, status: number): NextResponse {
  return NextResponse.json({ success: false, error }, { status });
}

async function assessmentLimit(
  studentId: string,
  specialty: string,
): Promise<{ limit: number; current: number }> {
  const rawLimit = await getSetting("hifz_assessment_limit_per_specialty");
  const parsedLimit = rawLimit?.trim() ? Number(rawLimit) : Number.NaN;
  const limit =
    Number.isFinite(parsedLimit) && parsedLimit >= 0
      ? Math.floor(parsedLimit)
      : 1;
  const current = await countStudentAssessmentsForSpecialty(
    studentId,
    specialty,
  );
  return { limit, current };
}

async function resolveAssessment(
  studentId: string,
  body: SingleSessionCheckout,
): Promise<ResolveCheckoutResult> {
  const specialty = body.specialty as string;
  const { limit, current } = await assessmentLimit(studentId, specialty);
  if (current >= limit) {
    return {
      ok: false,
      response: errorResponse(
        `Assessment limit reached for this specialty (${current}/${limit})`,
        409,
      ),
    };
  }
  if ((await countStudentActiveAssessments(studentId)) >= 1) {
    return {
      ok: false,
      response: errorResponse(
        "You already have an evaluation session. Each student gets one evaluation.",
        409,
      ),
    };
  }
  const specialist = await findAvailableSpecialist(specialty);
  if (!specialist) {
    return {
      ok: false,
      response: errorResponse(
        `No specialist available for specialty: ${specialty}`,
        422,
      ),
    };
  }
  return {
    ok: true,
    checkout: {
      priceUsd: await getAssessmentPrice(),
      materialize: {
        studentId,
        teacherId: specialist.teacherId,
        bookingType: "assessment",
        paymentId: null,
        specialty,
      },
    },
  };
}

async function teacherAvailable(
  admin: AdminClient,
  teacherId: string,
): Promise<NextResponse | null> {
  const { data: teacher, error } = await admin
    .from("teacher_profiles")
    .select("teacher_id")
    .eq("teacher_id", teacherId)
    .eq("is_archived", false)
    .eq("is_accepting", true)
    .maybeSingle<{ teacher_id: string }>();
  if (error) {
    logError(
      "paypal-single-session checkout: teacher lookup failed",
      error,
      { tag: "paypal-single-session", teacher_id: teacherId },
    );
    return errorResponse("Could not verify teacher availability", 500);
  }
  return teacher
    ? null
    : errorResponse("Selected teacher is not available for booking", 422);
}

async function resolveInstant(
  admin: AdminClient,
  studentId: string,
  body: SingleSessionCheckout,
): Promise<ResolveCheckoutResult> {
  const teacherId = body.teacherId as string;
  const unavailable = await teacherAvailable(admin, teacherId);
  if (unavailable) return { ok: false, response: unavailable };
  if (body.scheduledAt) {
    const slot = await validateInstantSlot(admin, {
      teacherId,
      scheduledAt: new Date(body.scheduledAt),
      dayOfWeek: body.dayOfWeek as number,
      localDate: body.localDate as string,
      localTime: body.localTime as string,
      durationMin: 30,
    });
    if (!slot.ok) {
      const message = {
        past: "Selected time is in the past",
        unavailable: "Teacher is not available at the selected time",
        blocked: "Selected time is unavailable",
        overlap: "Selected time is already booked",
        lookup_failed: "Could not verify the selected time",
      }[slot.reason];
      return {
        ok: false,
        response: errorResponse(
          message,
          slot.reason === "lookup_failed" ? 500 : 422,
        ),
      };
    }
  }
  return {
    ok: true,
    checkout: {
      priceUsd: await getInstantPrice(),
      materialize: {
        studentId,
        teacherId,
        bookingType: "instant",
        paymentId: null,
        scheduledAt: body.scheduledAt ?? null,
      },
    },
  };
}

async function resolveSpecialized(
  admin: AdminClient,
  studentId: string,
  body: SingleSessionCheckout,
): Promise<ResolveCheckoutResult> {
  const teacherId = body.teacherId as string;
  const purpose = body.purpose as SpecializedPurpose;
  const targetScope = body.targetScope as TargetScope;
  const scope = validateTargetScope(targetScope);
  if (!scope.valid) {
    return {
      ok: false,
      response: errorResponse(scope.error ?? "Invalid target_scope", 422),
    };
  }
  const unavailable = await teacherAvailable(admin, teacherId);
  if (unavailable) return { ok: false, response: unavailable };
  return {
    ok: true,
    checkout: {
      priceUsd: await getSpecializedPrice(purpose),
      materialize: {
        studentId,
        teacherId,
        bookingType: "specialized",
        paymentId: null,
        purpose,
        targetScopeRaw: JSON.stringify(targetScope),
      },
    },
  };
}

function resolveCheckout(
  admin: AdminClient,
  studentId: string,
  body: SingleSessionCheckout,
): Promise<ResolveCheckoutResult> {
  if (body.productType === "assessment") {
    return resolveAssessment(studentId, body);
  }
  if (body.productType === "instant") {
    return resolveInstant(admin, studentId, body);
  }
  return resolveSpecialized(admin, studentId, body);
}

function checkoutDescription(
  body: SingleSessionCheckout,
  priceUsd: number,
): string {
  if (body.productType === "assessment") {
    return `Assessment session (${body.specialty}) — $${priceUsd.toFixed(2)}`;
  }
  if (body.productType === "instant") {
    return `Instant session — $${priceUsd.toFixed(2)}`;
  }
  return `Specialized session (${body.purpose}) — $${priceUsd.toFixed(2)}`;
}

async function authenticatedStudent(): Promise<
  { ok: true; studentId: string } | { ok: false; response: NextResponse }
> {
  try {
    const { id } = await requireRole("student");
    return { ok: true, studentId: id };
  } catch (error) {
    if (error instanceof UnauthenticatedError) {
      return { ok: false, response: errorResponse("Unauthorized", 401) };
    }
    if (error instanceof ForbiddenError) {
      return {
        ok: false,
        response: errorResponse(
          "Only students may book single sessions",
          403,
        ),
      };
    }
    throw error;
  }
}

async function parseBody(
  request: Request,
): Promise<
  | { ok: true; body: SingleSessionCheckout }
  | { ok: false; response: NextResponse }
> {
  try {
    return {
      ok: true,
      body: SingleSessionCheckoutSchema.parse(await request.json()),
    };
  } catch (error) {
    if (error instanceof z.ZodError) {
      return {
        ok: false,
        response: NextResponse.json(
          { error: "Invalid body", issues: error.flatten() },
          { status: 400 },
        ),
      };
    }
    return {
      ok: false,
      response: errorResponse("Invalid or malformed JSON body", 400),
    };
  }
}

async function createFreeBooking(
  admin: AdminClient,
  materialize: MaterializeSingleSessionInput,
): Promise<NextResponse> {
  const booking = await materializeSingleSessionBooking(admin, materialize);
  return booking.ok
    ? NextResponse.json({
        success: true,
        data: {
          bookingId: booking.bookingId,
          message: "booking_created_free",
        },
      })
    : errorResponse("Booking creation failed", 500);
}

function singleSessionTargetScope(
  materialize: MaterializeSingleSessionInput,
): TargetScope | null {
  return materialize.targetScopeRaw
    ? (JSON.parse(materialize.targetScopeRaw) as TargetScope)
    : null;
}

async function createPaidOrder(
  studentId: string,
  body: SingleSessionCheckout,
  checkout: ResolvedCheckout,
): Promise<NextResponse> {
  if (!isPayPalConfigured()) {
    return errorResponse(
      PAYMENTS_UNAVAILABLE_MESSAGE,
      PAYMENTS_UNAVAILABLE_STATUS,
    );
  }
  const appUrl = process.env.NEXT_PUBLIC_APP_URL;
  if (!appUrl) return errorResponse("Server misconfigured", 500);

  const priceCents = Math.round(checkout.priceUsd * 100);
  const customId = buildPaypalSingleSessionCustomId({
    studentId,
    bookingType: checkout.materialize.bookingType,
    priceCents,
    teacherId: checkout.materialize.teacherId,
    specialty: checkout.materialize.specialty ?? null,
    purpose: checkout.materialize.purpose ?? null,
    targetScope: singleSessionTargetScope(checkout.materialize),
    scheduledAt: checkout.materialize.scheduledAt ?? null,
  });
  if (!customId) {
    return errorResponse(
      "Selected session details are too long for PayPal checkout",
      422,
    );
  }

  try {
    const order = await createPayPalOrder({
      amountUsd: priceCents / 100,
      referenceId: studentId,
      customId,
      description: checkoutDescription(body, checkout.priceUsd),
      returnUrl: `${appUrl}/api/paypal/checkout/single-session/return`,
      cancelUrl: `${appUrl}/student/dashboard?single_session=cancelled`,
    });
    logInfo("paypal-single-session checkout: order created", {
      tag: "paypal-single-session",
      student_id: studentId,
      booking_type: checkout.materialize.bookingType,
      order_id: order.orderId,
    });
    return NextResponse.json({
      success: true,
      data: { orderId: order.orderId, approveUrl: order.approveUrl },
    });
  } catch (error) {
    logError(
      "paypal-single-session checkout: createPayPalOrder failed",
      error,
      {
        tag: "paypal-single-session",
        student_id: studentId,
        booking_type: checkout.materialize.bookingType,
      },
    );
    return errorResponse("Checkout creation failed", 500);
  }
}

export async function POST(request: Request) {
  if (!(await isFeatureEnabled("paypal_purchase_enabled"))) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  const authenticated = await authenticatedStudent();
  if (!authenticated.ok) return authenticated.response;
  if (
    !(await checkRateLimit(
      authenticated.studentId,
      "checkout-single-session",
      20,
    ))
  ) {
    return errorResponse(
      "Too many attempts — please wait a moment and try again.",
      429,
    );
  }
  const parsed = await parseBody(request);
  if (!parsed.ok) return parsed.response;

  const admin = createAdminClient();
  let resolved: ResolveCheckoutResult;
  try {
    resolved = await resolveCheckout(
      admin,
      authenticated.studentId,
      parsed.body,
    );
  } catch (error) {
    logError("paypal-single-session checkout: price load failed", error, {
      tag: "paypal-single-session",
    });
    return errorResponse("Pricing is temporarily unavailable", 500);
  }
  if (!resolved.ok) return resolved.response;

  const { priceUsd, materialize } = resolved.checkout;
  if (priceUsd <= 0) {
    return createFreeBooking(admin, materialize);
  }
  return createPaidOrder(
    authenticated.studentId,
    parsed.body,
    resolved.checkout,
  );
}
