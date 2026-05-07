import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { logError } from "@/lib/logger";
import type { TableInsert } from "@/lib/supabase/typed-helpers";
import type { CreateBookingInput, CreateBookingResult } from "./types";
import { BookingValidationError, BookingConflictError } from "./types";

/**
 * Booking domain — write surface (Phase 5 pilot, ADR-0002).
 *
 * `createBooking` owns the booking-specific logic: teacher-rate fetch,
 * specialty/slot/exception validation, and the `bookings` insert.
 *
 * Intentionally NOT in scope for the domain function (lives at the
 * route adapter per ADR-0002 §1):
 *   - BotID / FormData parsing / Zod validation
 *   - Auth (`requireRole("student")`)
 *   - Rate limiting (route concern; reads/writes `automation_logs`)
 *   - Cross-domain choreography: `notify(...)` to the teacher,
 *     `notifyNewBooking(...)` WhatsApp, `emitEvent("booking.created", ...)`
 *   - HTTP redirect on success
 *
 * Failure shape (per ADR-0002 §4): throws on every error path.
 *   - `BookingValidationError(field, message)` — input fails domain rules
 *     (teacher unavailable, specialty mismatch, slot doesn't fit, blocked
 *     date, scheduledAt too far in past).
 *   - `BookingConflictError(message)` — Postgres `no_booking_overlap`
 *     exclusion constraint fires (slot was taken between availability
 *     check and insert).
 *   - Plain `Error` — unexpected DB error; logged through `logError`
 *     before re-throwing.
 *
 * The route adapter is responsible for catching these and shaping them
 * into the form-friendly `{ error }` response (per ADR-0002 §4 update —
 * this route is redirect-style, so no `loudAction` wrap).
 */
export async function createBooking(
  input: CreateBookingInput,
): Promise<CreateBookingResult> {
  const { studentId, teacherId, sessionType, durationMin, scheduledAt, notes } =
    input;

  // Use admin client: domain functions run after auth (route adapter has
  // already called `requireRole("student")`), so we don't need RLS to
  // re-prove identity. Matches what the route was using implicitly via
  // `await createClient()` after `auth.getUser()`.
  const supabase = createAdminClient();

  // 1. Fetch teacher rate + verify teacher is accepting bookings.
  // Server-trusted rate (never trust client-provided rate). Filters out
  // archived / not-accepting teachers in the query so we get null rather
  // than fetching a stale row to validate post-hoc.
  const { data: teacherProfile } = await supabase
    .from("teacher_profiles")
    .select("hourly_rate, specialties")
    .eq("teacher_id", teacherId)
    .eq("is_archived", false)
    .eq("is_accepting", true)
    .single<{ hourly_rate: number; specialties: string[] }>();

  if (!teacherProfile) {
    throw new BookingValidationError(
      "teacher_id",
      "المعلم غير متاح حالياً",
    );
  }

  // 2. Validate session type is in teacher's specialties (skip if teacher
  // has no specialties set — defensive for legacy profiles).
  if (
    teacherProfile.specialties.length > 0 &&
    !teacherProfile.specialties.includes(sessionType)
  ) {
    throw new BookingValidationError(
      "session_type",
      "نوع الجلسة غير مدعوم من هذا المعلم",
    );
  }

  // 3. Validate scheduledAt isn't more than 30 minutes in the past.
  // Allows instant/agreed sessions but blocks accidental backdating.
  const thirtyMinsAgo = new Date(Date.now() - 30 * 60 * 1000);
  if (scheduledAt < thirtyMinsAgo) {
    throw new BookingValidationError(
      "scheduled_at",
      "يجب اختيار وقت صالح",
    );
  }

  // 4. Validate against teacher_availability.
  // dayOfWeek matches Postgres EXTRACT(dow): 0=Sunday..6=Saturday,
  // which `Date.getDay()` already produces. timeStr is "HH:MM" for
  // string-comparison against the time-typed slot bounds.
  const dayOfWeek = scheduledAt.getDay();
  const timeStr = scheduledAt.toTimeString().slice(0, 5);
  const { data: slots } = await supabase
    .from("teacher_availability")
    .select("start_time, end_time, slot_duration")
    .eq("teacher_id", teacherId)
    .eq("day_of_week", dayOfWeek)
    .eq("is_active", true)
    .returns<
      { start_time: string; end_time: string; slot_duration: number }[]
    >();

  if (slots && slots.length > 0) {
    const fitsSlot = slots.some(
      (s) =>
        timeStr >= s.start_time.slice(0, 5) &&
        timeStr < s.end_time.slice(0, 5),
    );
    if (!fitsSlot) {
      throw new BookingValidationError(
        "scheduled_at",
        "الوقت المختار خارج أوقات المعلم المتاحة",
      );
    }
    const matchingSlot = slots.find(
      (s) =>
        timeStr >= s.start_time.slice(0, 5) &&
        timeStr < s.end_time.slice(0, 5),
    );
    if (matchingSlot && durationMin > matchingSlot.slot_duration) {
      throw new BookingValidationError(
        "duration_min",
        `المدة المختارة (${durationMin} دقيقة) أطول من الحد المتاح (${matchingSlot.slot_duration} دقيقة)`,
      );
    }
  }

  // 5. Validate against availability_exceptions (blocked dates / time
  // ranges that override the regular weekly availability).
  const dateStr = scheduledAt.toISOString().slice(0, 10);
  const { data: exceptions } = await supabase
    .from("availability_exceptions")
    .select("is_blocked, start_time, end_time")
    .eq("teacher_id", teacherId)
    .eq("date", dateStr)
    .returns<
      {
        is_blocked: boolean;
        start_time: string | null;
        end_time: string | null;
      }[]
    >();

  if (exceptions && exceptions.length > 0) {
    const blocked = exceptions.some((ex) => {
      if (!ex.is_blocked) return false;
      // Full-day block (no start/end times set).
      if (!ex.start_time && !ex.end_time) return true;
      // Time-range block.
      if (ex.start_time && ex.end_time) {
        return (
          timeStr >= ex.start_time.slice(0, 5) &&
          timeStr < ex.end_time.slice(0, 5)
        );
      }
      return false;
    });
    if (blocked) {
      throw new BookingValidationError(
        "scheduled_at",
        "المعلم غير متاح في هذا التاريخ — اختر تاريخاً آخر",
      );
    }
  }

  // 6. Compute amount_usd from server-trusted rate.
  const rateSnapshot = Number(teacherProfile.hourly_rate);
  const amountUsd = Number((rateSnapshot * (durationMin / 60)).toFixed(2));

  // 7. Insert. Typed via `TableInsert<"bookings">` per Phase 4 lessons —
  // surfaces a compile error if the column shape drifts (e.g. a future
  // migration adds a NOT-NULL column or renames an existing one).
  const insertPayload: TableInsert<"bookings"> = {
    student_id: studentId,
    teacher_id: teacherId,
    session_type: sessionType,
    duration_min: durationMin,
    rate_snapshot: rateSnapshot,
    amount_usd: amountUsd,
    scheduled_at: scheduledAt.toISOString(),
    notes,
  };
  const { data: newBooking, error } = await supabase
    .from("bookings")
    .insert(insertPayload)
    .select("id")
    .single<{ id: string }>();

  if (error) {
    if (error.message.includes("no_booking_overlap")) {
      throw new BookingConflictError(
        "هذا الوقت محجوز بالفعل — اختر وقتاً آخر",
      );
    }
    logError("createBooking insert failed", error, {
      tag: "booking-domain",
      severity: "warning",
      metadata: {
        studentId,
        teacherId,
        scheduledAt: scheduledAt.toISOString(),
      },
    });
    throw new Error("حدث خطأ أثناء إنشاء الحجز");
  }

  if (!newBooking?.id) {
    // Defensive — `.single()` shouldn't return success+null-id, but if
    // PostgREST hands us this shape we treat it as failure rather than
    // fabricate a result.
    throw new Error("لم يتم إنشاء الحجز");
  }

  return {
    id: newBooking.id,
    scheduledAt: scheduledAt.toISOString(),
    amountUsd,
    rateSnapshot,
  };
}
