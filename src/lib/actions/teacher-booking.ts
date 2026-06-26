"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import type { TableInsert, TableUpdate } from "@/lib/supabase/typed-helpers";
import { createRoom } from "@/lib/daily";
import { notify } from "@/lib/notifications/dispatcher";
import { logError } from "@/lib/logger";
import { emitEvent } from "@/lib/automation/emit";
import { confirmBooking } from "@/lib/domains/booking/orchestrate";
import {
  BookingAlreadyConfirmedError,
  BookingConfirmError,
  BookingNoPackageError,
  BookingNotFoundError,
  BookingRoomCreationError,
} from "@/lib/domains/booking/types";

// Scope-adjusted hardening (Phase 8.5): not wrapped in `loudAction`
// because the structured `{ roomUrl, warning }` return is consumed by
// the caller's optimistic UI (booking-actions.tsx:28–30) — loudAction's
// `{ ok, message? }` contract would drop both fields and the partial-
// success "تم تأكيد لكن فشل إنشاء الغرفة" warning would vanish.
//
// Inline hardening covers all silent-fail paths:
// - 3 bare `catch {}` on notify dispatches → logError + actionName tag
// - bookings UPDATE error message captured for ops, not just user-facing
// - auto-cancel UPDATE error (overlapping bookings) was previously
//   discarded without any error capture; now logged
// - createRoom + session insert errors carry actionName tag for filterable
//   Sentry queries (severity 'warning' — booking confirms aren't P0 the
//   same way live session ends are)
export async function updateBookingStatus(
  bookingId: string,
  status: "confirmed" | "cancelled",
) {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return { error: "غير مصرح" };

  // Fetch booking details before updating (needed for notifications and room creation)
  const { data: booking } = await supabase
    .from("bookings")
    .select("student_id, teacher_id, scheduled_at, duration_min, session_type")
    .eq("id", bookingId)
    .eq("teacher_id", user.id)
    .single<{
      student_id: string;
      teacher_id: string;
      scheduled_at: string;
      duration_min: number;
      session_type: string;
    }>();

  if (!booking) {
    return { error: "الحجز غير موجود أو ليس لديك صلاحية" };
  }

  // Sprint 2.1 (2026-05-05): eval-discipline gate. Block new confirmations
  // if the teacher has any completed-but-unevaluated sessions older than
  // 7 days. Forces the pedagogical-feedback loop the platform was built
  // for: write the eval BEFORE accepting more work. Cancellations still
  // pass through — never block a teacher from cancelling.
  //
  // Grandfather period: gate is soft (warning only) until GATE_HARD_AT.
  // This gives existing teachers 14 days from launch to clear backlog
  // before the platform locks them out simultaneously.
  if (status === "confirmed") {
    const GATE_HARD_AT = new Date("2026-05-19T00:00:00Z");
    const isGateHard = new Date() >= GATE_HARD_AT;
    const sevenDaysAgoIso = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();

    const { data: oldCompleted } = await supabase
      .from("bookings")
      .select("id, student_id, scheduled_at")
      .eq("teacher_id", user.id)
      .eq("status", "completed")
      .lt("scheduled_at", sevenDaysAgoIso)
      .returns<{ id: string; student_id: string; scheduled_at: string }[]>();

    if (oldCompleted && oldCompleted.length > 0) {
      const studentIds = [...new Set(oldCompleted.map((b) => b.student_id))];
      const { data: evals } = await supabase
        .from("session_evaluations")
        .select("student_id, created_at")
        .eq("teacher_id", user.id)
        .in("student_id", studentIds)
        .returns<{ student_id: string; created_at: string }[]>();

      // For each old completed booking, count it as unevaluated if no eval
      // exists from this teacher for that student dated after the booking.
      const unevaluatedCount = oldCompleted.filter((b) => {
        const matchingEval = (evals ?? []).find(
          (e) => e.student_id === b.student_id && new Date(e.created_at) > new Date(b.scheduled_at),
        );
        return !matchingEval;
      }).length;

      if (unevaluatedCount > 0 && isGateHard) {
        return {
          error: `لديك ${unevaluatedCount} جلسة مكتملة بحاجة لتقييم. يرجى كتابة التقييمات من صفحة "التقييمات" قبل تأكيد حجوزات جديدة.`,
        };
      }
    }
  }

  let roomUrl: string | null = null;

  if (status === "confirmed") {
    // Use-case orchestrator (ADR-0004). Replaces the previous inline
    // sequence (bookings UPDATE → createRoom → sessions INSERT → notify
    // → emitEvent) with a single domain call. Critical path is atomic
    // via confirm_booking_with_session() Postgres function — no more
    // half-confirmed bookings when sessions INSERT fails.
    let confirmResult;
    try {
      confirmResult = await confirmBooking({ bookingId, actorId: user.id });
    } catch (err) {
      if (err instanceof BookingAlreadyConfirmedError) {
        // The orchestrator's pre-read or the SQL function's status guard
        // saw the booking in a non-pending state. Render as a benign UX
        // message instead of a generic error.
        return { error: "الحجز مؤكد بالفعل أو في حالة لا تسمح بالتأكيد" };
      }
      if (err instanceof BookingNotFoundError) {
        return { error: "الحجز غير موجود" };
      }
      if (err instanceof BookingRoomCreationError) {
        // Daily.co outage. Booking still pending — user can retry.
        // Different from the previous "confirmed-with-warning" behavior
        // (which left the booking confirmed but room-less); the atomic
        // flow makes that state unreachable.
        logError("updateBookingStatus: orchestrator createRoom failed", err, {
          tag: "bookings",
          actionName: "teacher.updateBookingStatus",
          severity: "warning",
          bookingId,
        });
        return { error: "تعذر إنشاء غرفة الفيديو — يرجى المحاولة مرة أخرى" };
      }
      // Specific (subclass) BEFORE the generic BookingConfirmError: the
      // fail-closed money guard refused because the student has no package
      // credit — surface the actionable "activate a package" guidance, not a
      // generic error.
      if (err instanceof BookingNoPackageError) {
        logError("updateBookingStatus: confirm refused — no package credit", err, {
          tag: "bookings",
          actionName: "teacher.updateBookingStatus",
          severity: "warning",
          bookingId,
        });
        return { error: err.message };
      }
      if (err instanceof BookingConfirmError) {
        logError("updateBookingStatus: orchestrator confirm failed", err, {
          tag: "bookings",
          actionName: "teacher.updateBookingStatus",
          severity: "warning",
          bookingId,
        });
        return { error: "حدث خطأ أثناء تأكيد الحجز" };
      }
      // Unexpected — let the framework / loudAction (in callers) capture.
      throw err;
    }
    roomUrl = confirmResult.roomUrl;

    // Audit trail — updateBookingStatus not wrapped in loudAction (ADR-0002 §4)
    // admin: best-effort audit_log inserts (service-role telemetry) (issue #523)
    const adminForAudit = createAdminClient();
    const { error: confirmAuditErr } = await adminForAudit
      .from("audit_log")
      .insert({
        changed_by: user.id,
        action:     "booking.confirmed",
        table_name: "bookings",
        record_id:  bookingId,
        new_data:   { student_id: booking.student_id, teacher_id: user.id },
      } satisfies TableInsert<"audit_log">);
    if (confirmAuditErr) logError("updateBookingStatus: audit insert failed", confirmAuditErr, { tag: "bookings", actionName: "teacher.updateBookingStatus" });

    // V9: Auto-cancel other pending bookings at overlapping times for this
    // teacher. Stays at the route adapter — this is teacher-side cleanup
    // (teacher just locked in this slot, so any other pending bookings
    // overlapping it can no longer be honored). NOT part of the booking-
    // confirm cross-domain choreography per se; the admin path
    // intentionally skips it.
    const scheduledStart = new Date(booking.scheduled_at);
    const scheduledEnd = new Date(scheduledStart.getTime() + booking.duration_min * 60 * 1000);

    const { data: overlapping } = await supabase
      .from("bookings")
      .select("id, student_id, scheduled_at, duration_min")
      .eq("teacher_id", user.id)
      .eq("status", "pending")
      .neq("id", bookingId)
      .returns<{ id: string; student_id: string; scheduled_at: string; duration_min: number }[]>();

    if (overlapping) {
      for (const other of overlapping) {
        const otherStart = new Date(other.scheduled_at);
        const otherEnd = new Date(otherStart.getTime() + other.duration_min * 60 * 1000);

        // Check overlap: two intervals overlap if start1 < end2 AND start2 < end1
        if (scheduledStart < otherEnd && otherStart < scheduledEnd) {
          const { error: cancelErr } = await supabase
            .from("bookings")
            .update({
              status: "cancelled",
              cancelled_by: user.id,
              cancel_reason: "تم إلغاؤه تلقائياً بسبب تعارض مع حجز مؤكد آخر",
              cancelled_at: new Date().toISOString(),
              decline_reason: "تعارض مع حجز مؤكد",
            } satisfies TableUpdate<"bookings">)
            .eq("id", other.id);
          if (cancelErr) {
            logError("updateBookingStatus: auto-cancel of overlapping booking failed", cancelErr, {
              tag: "bookings",
              actionName: "teacher.updateBookingStatus",
              severity: "warning",
              overlappingBookingId: other.id,
            });
          }

          // Notify student of auto-cancellation (best-effort)
          try {
            await notify({
              userId: other.student_id,
              type: "booking",
              title: "تم إلغاء حجزك تلقائياً",
              body: "تم إلغاء حجزك بسبب تعارض مع حجز آخر مؤكد — يمكنك حجز موعد بديل",
              entityType: "booking",
              entityId: other.id,
            });
          } catch (err) {
            logError("updateBookingStatus: auto-cancel notify failed", err, {
              tag: "bookings",
              actionName: "teacher.updateBookingStatus",
              overlappingBookingId: other.id,
            });
          }
        }
      }
    }
  } else if (status === "cancelled") {
    // Cancellation path — out of scope for the orchestrator pilot
    // (ADR-0004 §"Out of scope: cancelBooking choreography"). Stays
    // inline. The validate_booking_status trigger guards invalid
    // transitions; RLS ensures only the booking parties can update.
    const { error } = await supabase
      .from("bookings")
      .update({ status } as TableUpdate<"bookings">)
      .eq("id", bookingId)
      .eq("teacher_id", user.id);

    if (error) {
      logError("updateBookingStatus: bookings cancel update failed", error, {
        tag: "bookings",
        actionName: "teacher.updateBookingStatus",
        severity: "warning",
        bookingId,
        newStatus: status,
      });
      return { error: "حدث خطأ أثناء تحديث الحجز" };
    }

    // admin: best-effort audit_log inserts (service-role telemetry) (issue #523)
    const { error: cancelAuditErr } = await createAdminClient()
      .from("audit_log")
      .insert({
        changed_by: user.id,
        action:     "booking.cancelled",
        table_name: "bookings",
        record_id:  bookingId,
        new_data:   { student_id: booking.student_id, teacher_id: user.id },
      } satisfies TableInsert<"audit_log">);
    if (cancelAuditErr) logError("updateBookingStatus: cancel audit insert failed", cancelAuditErr, { tag: "bookings", actionName: "teacher.updateBookingStatus" });

    try {
      await notify({
        userId: booking.student_id,
        type: "booking",
        title: "تم رفض حجزك",
        body: "للأسف تم رفض حجزك من قبل المعلم — يمكنك حجز موعد آخر",
        entityType: "booking",
        entityId: bookingId,
      });
    } catch (err) {
      logError("updateBookingStatus: cancel notify failed", err, {
        tag: "bookings",
        actionName: "teacher.updateBookingStatus",
        bookingId,
      });
    }

    // Emit booking.cancelled. Pre-orchestrator code emitted
    // booking.confirmed unconditionally for both branches (the emit
    // sat outside the if/else); fixing in-place since this path is
    // already being touched.
    await emitEvent("booking.cancelled", "booking", bookingId, {
      student_id: booking.student_id,
      teacher_id: user.id,
    }).catch((err) => logError("emit booking.cancelled failed", err, {
      tag: "automation",
      actionName: "teacher.updateBookingStatus",
      event: "booking.cancelled",
    }));
  }

  revalidatePath("/teacher/dashboard");
  // `warning` retained in the return shape for caller compatibility
  // (booking-actions.tsx:29 reads result.warning). Always null now —
  // the atomic critical path makes the prior partial-success state
  // ("confirmed-but-no-room") unreachable. Cast to `string | null` so
  // the consumer's `if (result.warning)` truthy narrowing doesn't
  // collapse `result` to `never`.
  return { success: true, roomUrl, warning: null as string | null };
}

/* ------------------------------------------------------------------ */
/*  recreateRoom – create a new Daily room for expired / failed rooms */
/* ------------------------------------------------------------------ */
//
// Scope-adjusted hardening (Phase 8.4): not wrapped in `loudAction`
// because the structured `{ roomUrl }` return is consumed by the
// caller's optimistic UI update — `loudAction`'s `{ ok, message? }`
// contract would drop it and force a page refresh to show the new room.
// Same precedent as Phase 4.6's `toggleArchiveTeacher` adjustment.
//
// What we DO get inline:
// - bare `catch {}` on createRoom replaced with logError(severity:'critical'),
//   which routes to Sentry AND fires a Telegram alert (logger.ts:50–62).
// - DB write failures already log via logError — kept as-is.
// - actionName tag pinned on every error so the issue feed is filterable.
export async function recreateRoom(bookingId: string) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "غير مصرح" };

  const { data: booking } = await supabase
    .from("bookings")
    .select("teacher_id, scheduled_at")
    .eq("id", bookingId)
    .eq("teacher_id", user.id)
    .single<{ teacher_id: string; scheduled_at: string | null }>();

  if (!booking) return { error: "الحجز غير موجود أو ليس لديك صلاحية" };

  // Spec 022: no room to (re)create for a slot-less booking — the slot must be
  // chosen first. Server-side guard backing the UI's hasScheduledSlot gate.
  if (booking.scheduled_at === null) {
    return { error: "لا يمكن إنشاء غرفة لحجز غير مُجدوَل" };
  }

  const expiresAt = new Date(Date.now() + 2 * 60 * 60 * 1000);
  const roomName = `furqan-${bookingId.replace(/-/g, "")}-${Date.now()}`;

  let room;
  try {
    room = await createRoom(roomName, expiresAt);
  } catch (err) {
    logError("recreateRoom: createRoom failed", err, {
      tag: "bookings",
      actionName: "teacher.recreateRoom",
      severity: "critical",
      component: "teacher.dashboard.recreateRoom",
      bookingId,
    });
    return { error: "حدث خطأ أثناء إنشاء الغرفة" };
  }

  // Upsert session record – update existing or insert new
  const { data: existing } = await supabase
    .from("sessions")
    .select("id")
    .eq("booking_id", bookingId)
    .single<{ id: string }>();

  const { error: roomErr } = existing
    ? await supabase
        .from("sessions")
        .update({
          room_name: room.name,
          room_url: room.url,
          expires_at: expiresAt.toISOString(),
        } satisfies TableUpdate<"sessions">)
        .eq("id", existing.id)
    : await supabase.from("sessions").insert({
        booking_id: bookingId,
        room_name: room.name,
        room_url: room.url,
        expires_at: expiresAt.toISOString(),
        created_via: "manual",
      } satisfies TableInsert<"sessions">);
  if (roomErr) {
    logError("recreateRoom: sessions write failed", roomErr, {
      tag: "bookings",
      actionName: "teacher.recreateRoom",
      severity: "critical",
      bookingId,
    });
    return { success: false, error: `فشل حفظ الغرفة: ${roomErr.message}` };
  }

  // admin: best-effort audit_log inserts (service-role telemetry) (issue #523)
  const { error: recreateAuditErr } = await createAdminClient()
    .from("audit_log")
    .insert({
      changed_by: user.id,
      action:     "booking.room_recreated",
      table_name: "bookings",
      record_id:  bookingId,
      new_data:   { new_room: room.name },
    } satisfies TableInsert<"audit_log">);
  if (recreateAuditErr) logError("recreateRoom: audit insert failed", recreateAuditErr, { tag: "bookings", actionName: "teacher.recreateRoom" });

  revalidatePath("/teacher/dashboard");
  revalidatePath("/teacher/sessions");
  return { success: true, roomUrl: room.url };
}
