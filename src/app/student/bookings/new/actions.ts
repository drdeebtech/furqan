"use server";

import { z } from "zod";
import { redirect } from "next/navigation";
import { checkBotId } from "botid/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import type { SessionType } from "@/types/database";
import { notifyNewBooking } from "@/lib/whatsapp";
import { emitEvent } from "@/lib/automation/emit";
import { dispatchEffects } from "@/lib/automation/effects";
import { logError } from "@/lib/logger";
import { getPostHogClient } from "@/lib/posthog-server";
import { createBooking as createBookingDomain } from "@/lib/domains/booking/actions";
import {
  BookingValidationError,
  BookingConflictError,
} from "@/lib/domains/booking/types";
import {
  requireRole,
  ForbiddenError,
  UnauthenticatedError,
} from "@/lib/auth/require-admin";

export type BookingResult = {
  error?: string;
};

const SESSION_TYPES = ["hifz", "muraja", "tajweed", "tilawa", "qiraat", "tafsir", "combined", "other"] as const;

const BookingSchema = z.object({
  teacher_id: z.string().uuid(),
  session_type: z.enum(SESSION_TYPES),
  duration_min: z.coerce.number().int().refine((n) => [30, 45, 60].includes(n), { message: "مدة غير صالحة" }),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  time: z.string().regex(/^\d{2}:\d{2}$/),
  // Client-computed ISO-8601 UTC string (preferred). When present this is
  // used directly so the server honours the student's local timezone rather
  // than treating date+time as a server-UTC pair.
  scheduled_at: z.string().datetime().optional(),
  notes: z
    .string()
    .max(1000)
    .nullable()
    .optional()
    .transform((v) => (v && v.length > 0 ? v : null)),
});

const MAX_BOOKINGS_PER_HOUR = 10;

/**
 * DB-backed rate limiter. Writes each attempt to automation_logs and counts
 * entries for this user in the last hour. Works across Fluid Compute instances
 * (no per-instance state) and survives cold starts. Cost: one DB query per call.
 *
 * Uses admin client because automation_logs has RLS enabled — the student
 * role has no SELECT/INSERT grants on that table (Sentry FURQAN-2R).
 */
async function checkRateLimit(userId: string): Promise<boolean> {
  // admin: checkRateLimit uses automation_logs (no SELECT/INSERT grant for students) (issue #523)
  const admin = createAdminClient();
  const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();
  const { count, error: countError } = await admin
    .from("automation_logs")
    .select("id", { count: "exact", head: true })
    .eq("workflow_name", "booking-attempt")
    .eq("entity_id", userId)
    .gte("started_at", oneHourAgo);

  if (countError) throw countError;

  if ((count ?? 0) >= MAX_BOOKINGS_PER_HOUR) return false;

  const now = new Date().toISOString();
  // Critical: the rate-limit check (above) counts these exact rows. Silent
  // insert failure makes the limiter unenforceable — every attempt looks
  // like the first. Fail open (still return true so the user can book) but
  // log loudly so the broken limiter is visible.
  const { error: autoLogError } = await admin.from("automation_logs").insert({
    workflow_name: "booking-attempt",
    event_name: "booking.attempt",
    entity_type: "user",
    entity_id: userId,
    status: "succeeded",
    started_at: now,
    finished_at: now,
  });
  if (autoLogError) {
    logError("booking rate-limit log insert failed — limiter degraded", autoLogError, {
      tag: "booking-rate-limit", userId,
    });
  }
  return true;
}

/**
 * Route adapter for the student booking form. Owns the HTTP boundary:
 *   BotID + Zod(FormData) + Supabase auth + rate limit
 *     → call bookingDomain.createBooking(input)
 *     → cross-domain fan-out (notify teacher, WhatsApp, emitEvent)
 *     → redirect
 *
 * Per ADR-0002 §4 (2026-05-07 update): this is a redirect-style adapter
 * (`useActionState`-bound, ends in `redirect()`), so it is NOT wrapped in
 * `loudAction`. Domain still throws on failure; this catches and converts
 * to the form's `{ error }` shape.
 */
export async function createBooking(
  _prev: BookingResult,
  formData: FormData,
): Promise<BookingResult> {
  const verification = await checkBotId();
  if (verification.isBot) {
    return { error: "تعذر التحقق من الطلب" };
  }

  const parsed = BookingSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) {
    const firstIssue = parsed.error.issues[0];
    const msgMap: Record<string, string> = {
      teacher_id: "معلم غير صالح",
      session_type: "نوع الجلسة غير صالح",
      duration_min: "مدة غير صالحة",
      date: "تاريخ غير صالح",
      time: "وقت غير صالح",
    };
    const field = firstIssue?.path[0]?.toString() ?? "";
    return { error: msgMap[field] ?? firstIssue?.message ?? "جميع الحقول مطلوبة" };
  }
  const { teacher_id: teacherId, session_type: sessionType, duration_min: durationMin, date, time, notes, scheduled_at: scheduledAtIso } = parsed.data;

  // Auth: ADR-0002 §3 (and the route-adapter shape in CONTEXT.md).
  // requireRole("student") enforces both authentication AND the student
  // role — previously this route only checked auth, allowing any
  // authenticated user (including teachers/admins) to insert a booking
  // row with their own id as student_id. RLS already implies students-
  // only ownership; this just enforces it at the route boundary.
  let studentId: string;
  try {
    const result = await requireRole("student");
    studentId = result.id;
  } catch (err) {
    if (err instanceof UnauthenticatedError) {
      return { error: "يجب تسجيل الدخول أولاً" };
    }
    if (err instanceof ForbiddenError) {
      return { error: "ليس لديك صلاحية" };
    }
    throw err;
  }

  // Supabase client still needed for rate-limit (automation_logs) and
  // profile lookups in the cross-domain fan-out below. Domain function
  // makes its own admin client.
  const supabase = await createClient();

  // Durable rate limiting — DB-backed so it works across Fluid Compute instances.
  // Stays at the route adapter (writes to automation_logs, not bookings).
  try {
    if (!(await checkRateLimit(studentId))) {
      return { error: "لقد تجاوزت الحد المسموح — حاول لاحقاً" };
    }
  } catch (err) {
    logError("Booking rate-limit check failed — allowing request", err, { tag: "booking-rate-limit" });
    // Fail-open so a transient DB blip doesn't block legitimate bookings.
  }

  // Prefer the client-computed ISO-8601 timestamp (honours the student's
  // local timezone). Fall back to date+time treated as UTC when absent.
  const scheduledAt = scheduledAtIso
    ? new Date(scheduledAtIso)
    : new Date(`${date}T${time}:00Z`);
  if (isNaN(scheduledAt.getTime())) {
    return { error: "تاريخ أو وقت غير صالح" };
  }

  // Delegate booking-specific logic to the domain module (ADR-0002 pilot).
  let booking;
  try {
    booking = await createBookingDomain({
      studentId,
      teacherId,
      sessionType: sessionType as SessionType,
      durationMin,
      scheduledAt,
      localDate: date,
      localTime: time,
      notes,
    });
  } catch (err) {
    if (err instanceof BookingValidationError || err instanceof BookingConflictError) {
      return { error: err.message };
    }
    // Unexpected error — domain already logged it; surface a generic message.
    logError("createBooking adapter caught unexpected domain error", err, {
      tag: "booking-route",
      severity: "warning",
    });
    return { error: "حدث خطأ أثناء إنشاء الحجز" };
  }

  getPostHogClient()?.capture({
    distinctId: studentId,
    event: "booking_created",
    properties: {
      session_type: sessionType,
      duration_min: durationMin,
      teacher_id: teacherId,
    },
  });

  // Cross-domain choreography stays at the route adapter (per ADR-0002 §1
  // — orchestration is a separate later conversation). Send notifications
  // in parallel; each branch wraps its own try/catch + logError so a failed
  // channel surfaces in Sentry instead of being swallowed by allSettled.
  // The booking is already committed at this point — the user must not be
  // blocked or shown an error if a side-channel notification fails.
  await Promise.allSettled([
    // In-app fan-out is now declared in EVENT_EFFECTS["booking.created"]
    // (src/lib/automation/effects.ts) — teacher notification. dispatchEffects
    // is itself best-effort/never-throws, so no per-call catch is needed here.
    dispatchEffects("booking.created", {
      teacherId,
      entityId: booking.id,
      dateLabel: scheduledAt.toLocaleDateString("ar"),
    }),
    (async () => {
      const [{ data: studentProfile }, { data: teacherName }] = await Promise.all([
        supabase.from("profiles").select("full_name").eq("id", studentId).single<{ full_name: string | null }>(),
        supabase.from("profiles").select("full_name").eq("id", teacherId).single<{ full_name: string | null }>(),
      ]);
      await notifyNewBooking(
        studentProfile?.full_name ?? "طالب",
        teacherName?.full_name ?? "معلم",
        scheduledAt.toLocaleDateString("ar"),
      );
    })().catch((err) => logError("WhatsApp notify booking.created failed", err, {
      tag: "whatsapp", severity: "warning", actionName: "booking.created", bookingId: booking.id,
    })),
    emitEvent("booking.created", "booking", booking.id, {
      student_id: studentId, teacher_id: teacherId, session_type: sessionType, scheduled_at: booking.scheduledAt,
    }).catch((err) => logError("emit booking.created failed", err, {
      tag: "automation", severity: "warning", actionName: "booking.created", bookingId: booking.id,
    })),
  ]);

  redirect("/student/dashboard?booked=1");
}
