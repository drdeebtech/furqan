import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { logError } from "@/lib/logger";
import type { TableInsert, TableUpdate } from "@/lib/supabase/typed-helpers";
import type { BookingStatus } from "@/types/database";
import type {
  CreateBookingInput,
  CreateBookingResult,
  UpdateBookingStatusInput,
  UpdateBookingStatusResult,
} from "./types";
import {
  BookingValidationError,
  BookingConflictError,
  BookingNotFoundError,
  BookingStatusUpdateError,
} from "./types";
import {
  type AvailabilitySlot,
  type AvailabilityException,
  computeAmountUsd,
  dateToYYYYMMDD,
  findSlotContaining,
  fitsAnySlot,
  isBlockedByException,
  isMoreThanWindowInPast,
  timeToHHMM,
} from "./validation";

const THIRTY_MINUTES_MS = 30 * 60 * 1000;

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
  const { studentId, teacherId, sessionType, durationMin, scheduledAt, localDate, localTime, notes } =
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
  if (isMoreThanWindowInPast(scheduledAt, THIRTY_MINUTES_MS)) {
    throw new BookingValidationError(
      "scheduled_at",
      "يجب اختيار وقت صالح",
    );
  }

  // 4. Validate against teacher_availability.
  // dayOfWeek matches Postgres EXTRACT(dow): 0=Sunday..6=Saturday.
  // Use the student's local date string to derive the weekday — parsing
  // "YYYY-MM-DD" as a local Date avoids UTC midnight shifting the weekday
  // for students in negative UTC offsets. timeStr comes from the local
  // time string directly (stored in teacher_availability as local HH:MM).
  const [ly, lm, ld] = localDate.split("-").map(Number);
  const dayOfWeek = new Date(ly, lm - 1, ld).getDay();
  const timeStr = localTime;
  const { data: slots } = await supabase
    .from("teacher_availability")
    .select("start_time, end_time, slot_duration")
    .eq("teacher_id", teacherId)
    .eq("day_of_week", dayOfWeek)
    .eq("is_active", true)
    .returns<AvailabilitySlot[]>();

  if (slots && slots.length > 0) {
    if (!fitsAnySlot(timeStr, slots)) {
      throw new BookingValidationError(
        "scheduled_at",
        "الوقت المختار خارج أوقات المعلم المتاحة",
      );
    }
    const matchingSlot = findSlotContaining(timeStr, slots);
    if (matchingSlot && durationMin > matchingSlot.slot_duration) {
      throw new BookingValidationError(
        "duration_min",
        `المدة المختارة (${durationMin} دقيقة) أطول من الحد المتاح (${matchingSlot.slot_duration} دقيقة)`,
      );
    }
  }

  // 5. Validate against availability_exceptions (blocked dates / time
  // ranges that override the regular weekly availability).
  const { data: exceptions } = await supabase
    .from("availability_exceptions")
    .select("is_blocked, start_time, end_time")
    .eq("teacher_id", teacherId)
    .eq("date", localDate)
    .returns<AvailabilityException[]>();

  if (exceptions && isBlockedByException(timeStr, exceptions)) {
    throw new BookingValidationError(
      "scheduled_at",
      "المعلم غير متاح في هذا التاريخ — اختر تاريخاً آخر",
    );
  }

  // 6. Compute amount_usd from server-trusted rate.
  const rateSnapshot = Number(teacherProfile.hourly_rate);
  const amountUsd = computeAmountUsd(rateSnapshot, durationMin);

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

/**
 * Updates a booking's status and writes an audit row. Used by both the
 * single-action admin route (`adminUpdateBookingStatus`) and the bulk
 * admin route (`bulkUpdateBookingStatus`).
 *
 * Owns the booking-side state transition + audit. Does NOT emit events
 * — that stays at the route adapter (per ADR-0002 §1, and matching the
 * createBooking precedent: emitEvent calls live at the boundary, not in
 * the domain).
 *
 * Behavior:
 *   - Returns `alreadyInTargetState: true` and writes nothing if the
 *     booking is already at `newStatus` (preserves bulk-actions silence
 *     on no-op transitions).
 *   - Throws `BookingNotFoundError` if the booking row doesn't exist.
 *   - Throws `BookingStatusUpdateError` if the UPDATE itself fails.
 *   - Audit-log INSERT failures are logged but don't fail the operation
 *     (best-effort write per CLAUDE.md "best-effort writes" guidance).
 */
export async function updateBookingStatus(
  input: UpdateBookingStatusInput,
): Promise<UpdateBookingStatusResult> {
  const { bookingId, newStatus, actorId, reason } = input;
  const supabase = createAdminClient();

  // Read current state so we can short-circuit no-ops, write the
  // old_data audit field, and return the cross-domain ids the route
  // adapter needs for emitEvent.
  const { data: existing } = await supabase
    .from("bookings")
    .select("id, status, student_id, teacher_id")
    .eq("id", bookingId)
    .single<{
      id: string;
      status: BookingStatus;
      student_id: string;
      teacher_id: string;
    }>();

  if (!existing) {
    throw new BookingNotFoundError(bookingId);
  }

  // Already-in-target-state short-circuit — preserves the existing bulk
  // behavior of skipping silently when a row is already at newStatus.
  if (existing.status === newStatus) {
    return {
      id: existing.id,
      oldStatus: existing.status,
      newStatus,
      studentId: existing.student_id,
      teacherId: existing.teacher_id,
      alreadyInTargetState: true,
    };
  }

  // Update.
  const updatePayload: TableUpdate<"bookings"> = { status: newStatus };
  const { error: updateErr } = await supabase
    .from("bookings")
    .update(updatePayload)
    .eq("id", bookingId);

  if (updateErr) {
    logError("updateBookingStatus: bookings UPDATE failed", updateErr, {
      tag: "booking-domain",
      severity: "warning",
      metadata: { bookingId, newStatus, actorId },
    });
    throw new BookingStatusUpdateError(updateErr.message);
  }

  // Audit row — best-effort. Failures are logged but don't fail the op
  // because the bookings UPDATE has already committed; throwing here
  // would leave the caller thinking the status change rolled back.
  const auditPayload: TableInsert<"audit_log"> = {
    changed_by: actorId,
    table_name: "bookings",
    record_id: bookingId,
    action: "UPDATE",
    old_data: { status: existing.status },
    new_data: reason
      ? { status: newStatus, reason }
      : { status: newStatus },
    reason: reason ?? `status set to ${newStatus}`,
  };
  await supabase
    .from("audit_log")
    .insert(auditPayload)
    .then((r) => {
      if (r.error) {
        logError(
          "updateBookingStatus: audit row INSERT failed",
          r.error,
          { tag: "booking-domain", metadata: { bookingId, newStatus } },
        );
      }
    });

  return {
    id: existing.id,
    oldStatus: existing.status,
    newStatus,
    studentId: existing.student_id,
    teacherId: existing.teacher_id,
    alreadyInTargetState: false,
  };
}
