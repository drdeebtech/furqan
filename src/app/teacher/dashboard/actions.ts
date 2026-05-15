"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import type { TableInsert, TableUpdate } from "@/lib/supabase/typed-helpers";
import { createRoom, updateRoomExpiry } from "@/lib/daily";
import { notifyParentSessionComplete, notifyParentNoShow } from "@/lib/notifications/parent";
import { notify } from "@/lib/notifications/dispatcher";
import { logError } from "@/lib/logger";
import { emitEvent } from "@/lib/automation/emit";
import { loudAction } from "@/lib/actions/loud";
import { confirmBooking } from "@/lib/domains/booking/orchestrate";
import {
  BookingAlreadyConfirmedError,
  BookingConfirmError,
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
/*  markNoShow – teacher marks student as no-show                     */
/* ------------------------------------------------------------------ */
export const markNoShow = loudAction<{ bookingId: string }, { message: string }>({
  name: "teacher.markNoShow",
  severity: "warning",
  audit: {
    table: "bookings",
    recordId: i => i.bookingId,
    action: "UPDATE",
  },
  preflight: async () => {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) throw new Error("غير مصرح");
    return { actorId: user.id };
  },
  handler: async ({ bookingId }, { actorId }) => {
    const supabase = await createClient();

    const { data: booking } = await supabase
      .from("bookings")
      .select("student_id, teacher_id")
      .eq("id", bookingId)
      .eq("teacher_id", actorId!)
      .single<{ student_id: string; teacher_id: string }>();

    if (!booking) throw new Error("الحجز غير موجود أو ليس لديك صلاحية");

    const { error } = await supabase
      .from("bookings")
      .update({ status: "no_show" } satisfies TableUpdate<"bookings">)
      .eq("id", bookingId)
      .eq("teacher_id", actorId!);

    if (error) throw error;

    // Mark session as ended — non-blocking (no-show is not gated on session row existing).
    const { error: sessErr } = await supabase
      .from("sessions")
      .update({ ended_at: new Date().toISOString() } satisfies TableUpdate<"sessions">)
      .eq("booking_id", bookingId);
    if (sessErr) logError("markNoShow: sessions ended_at update failed", sessErr, { tag: "teacher-bookings", severity: "warning" });

    // Notify student (best-effort)
    try {
      await notify({
        userId: booking.student_id,
        type: "booking",
        title: "تم تسجيل غيابك",
        body: "سجّل المعلم غيابك عن الجلسة — تواصل مع المعلم لإعادة الجدولة",
        entityType: "booking",
        entityId: bookingId,
      });
    } catch (err) {
      logError("markNoShow: notify student failed", err, { tag: "teacher-bookings" });
    }

    // V9: Notify parent of no-show (best-effort)
    try {
      await notifyParentNoShow(booking.student_id, actorId!, new Date().toISOString(), actorId!);
    } catch (err) {
      logError("markNoShow: notifyParentNoShow failed", err, { tag: "teacher-bookings" });
    }

    revalidatePath("/teacher/dashboard");
    revalidatePath("/teacher/sessions");
    await emitEvent("session.no_show", "booking", bookingId, { student_id: booking.student_id, teacher_id: actorId! })
      .catch((err) => logError("emit session.no_show failed", err, { tag: "automation", event: "session.no_show" }));

    return { message: "تم تسجيل الغياب" };
  },
});

/* ------------------------------------------------------------------ */
/*  endSession – teacher manually ends a live session                 */
/* ------------------------------------------------------------------ */
export const endSession = loudAction<{ sessionId: string }, { message: string }>({
  name: "teacher.endSession",
  // Critical: ending a live session affects in-flight video. If this fails
  // the operator needs to know fast — Telegram alert.
  severity: "critical",
  audit: {
    table: "sessions",
    recordId: i => i.sessionId,
    action: "UPDATE",
  },
  preflight: async () => {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) throw new Error("غير مصرح");
    return { actorId: user.id };
  },
  handler: async ({ sessionId }, { actorId }) => {
    const supabase = await createClient();

    const { data: session, error: sessReadErr } = await supabase
      .from("sessions")
      .select("id, booking_id, started_at, ended_at")
      .eq("id", sessionId)
      .single<{
        id: string;
        booking_id: string;
        started_at: string | null;
        ended_at: string | null;
      }>();

    if (sessReadErr) throw sessReadErr;
    if (!session) throw new Error("الجلسة غير موجودة");

    // Verify teacher owns the booking
    const { data: booking, error: bookReadErr } = await supabase
      .from("bookings")
      .select("student_id, teacher_id, duration_min")
      .eq("id", session.booking_id)
      .eq("teacher_id", actorId!)
      .single<{ student_id: string; teacher_id: string; duration_min: number }>();

    if (bookReadErr) throw bookReadErr;
    if (!booking) throw new Error("ليس لديك صلاحية لإنهاء هذه الجلسة");

    // T022/T023: If the Daily webhook already ended this session, the
    // session row will have ended_at set. Rather than error, audit-log
    // the noop attempt and return success — from the teacher's perspective
    // the session is correctly ended either way.
    if (session.ended_at) {
      const adminClient = (await import("@/lib/supabase/admin")).createAdminClient();
      const { error: auditErr } = await adminClient
        .from("audit_log")
        .insert({
          changed_by: actorId ?? null,
          action:     "session.manual_end_post_webhook",
          table_name: "sessions",
          record_id:  sessionId,
          new_data:   { note: "manual endSession called after Daily webhook already ended the session; noop" },
        } satisfies TableInsert<"audit_log">);
      if (auditErr) logError("endSession: manual_end_post_webhook audit insert failed", auditErr, { tag: "teacher-bookings" });
      return { message: "تم إنهاء الجلسة" };
    }

    const now = new Date();
    const actualDuration = session.started_at
      ? Math.round((now.getTime() - new Date(session.started_at).getTime()) / 60_000)
      : booking.duration_min;

    const { error: sessionError } = await supabase
      .from("sessions")
      .update({
        ended_at: now.toISOString(),
        actual_duration: actualDuration,
      } satisfies TableUpdate<"sessions">)
      .eq("id", sessionId);

    if (sessionError) throw sessionError;

    // Mark booking as completed (best-effort — session row is the source of truth for "ended").
    const { error: bookingErr } = await supabase
      .from("bookings")
      .update({ status: "completed" } satisfies TableUpdate<"bookings">)
      .eq("id", session.booking_id)
      .eq("teacher_id", actorId!);
    if (bookingErr) logError("endSession: bookings status=completed update failed", bookingErr, { tag: "teacher-bookings" });

    // Notify student (best-effort)
    try {
      await notify({
        userId: booking.student_id,
        type: "booking",
        title: "تمت الجلسة",
        body: `أنهى المعلم الجلسة — المدة الفعلية: ${actualDuration} دقيقة`,
        entityType: "session",
        entityId: sessionId,
      });
    } catch (err) {
      logError("endSession: notify student failed", err, {
        component: "teacher.dashboard.endSession",
        metadata: { student_id: booking.student_id, sessionId },
      });
    }

    // V9: Notify parent of session completion (best-effort)
    try {
      await notifyParentSessionComplete(
        booking.student_id, actorId!,
        session.started_at ?? now.toISOString(),
        actualDuration, actorId!,
      );
    } catch (err) {
      logError("endSession: notifyParentSessionComplete failed", err, { tag: "teacher-bookings" });
    }

    revalidatePath("/teacher/dashboard");
    revalidatePath(`/teacher/sessions/${sessionId}`);
    revalidatePath("/teacher/sessions");
    await emitEvent("session.ended", "session", sessionId, { booking_id: session.booking_id, teacher_id: actorId!, actual_duration: actualDuration })
      .catch((err) => logError("emit session.ended failed", err, { tag: "automation", event: "session.ended" }));

    return { message: "تم إنهاء الجلسة" };
  },
});

/* ------------------------------------------------------------------ */
/*  extendSessionRoom – extend an about-to-expire Daily room (+1 hr)  */
/* ------------------------------------------------------------------ */
//
// NOTE: callers compute the new expiry locally from `Date.now() + 60m`
// because loudAction's contract drops payload fields beyond `message`.
// The drift between server and client `Date.now()` is sub-second, well
// inside the 15-min "about to expire" warning band, so the UI updates
// indistinguishably from the previous structured return.
export const extendSessionRoom = loudAction<{ sessionId: string }, { message: string }>({
  name: "teacher.extendSessionRoom",
  // Critical: an extension failure during a live session means the
  // teacher can't recover — Daily room expires, students get kicked.
  // Telegram alert ensures the operator sees it fast.
  severity: "critical",
  audit: {
    table: "sessions",
    recordId: i => i.sessionId,
    action: "UPDATE",
  },
  preflight: async () => {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) throw new Error("غير مصرح");
    return { actorId: user.id };
  },
  handler: async ({ sessionId }, { actorId }) => {
    const supabase = await createClient();

    const { data: session } = await supabase
      .from("sessions")
      .select("id, booking_id, room_name, expires_at")
      .eq("id", sessionId)
      .single<{
        id: string;
        booking_id: string;
        room_name: string;
        expires_at: string | null;
      }>();

    if (!session) throw new Error("الجلسة غير موجودة");

    // Verify teacher owns the booking
    const { data: booking } = await supabase
      .from("bookings")
      .select("teacher_id")
      .eq("id", session.booking_id)
      .eq("teacher_id", actorId!)
      .single<{ teacher_id: string }>();

    if (!booking) throw new Error("ليس لديك صلاحية");

    const newExpiry = new Date(Date.now() + 60 * 60 * 1000);

    await updateRoomExpiry(session.room_name, newExpiry);

    const { error } = await supabase
      .from("sessions")
      .update({ expires_at: newExpiry.toISOString() } satisfies TableUpdate<"sessions">)
      .eq("id", sessionId);
    if (error) throw error;

    revalidatePath("/teacher/dashboard");
    revalidatePath(`/teacher/sessions/${sessionId}`);
    return { message: "تم تمديد الغرفة" };
  },
});

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
    .single<{ teacher_id: string; scheduled_at: string }>();

  if (!booking) return { error: "الحجز غير موجود أو ليس لديك صلاحية" };

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

/* ------------------------------------------------------------------ */
/*  saveQuickNotes – save quick notes from the dashboard card         */
/* ------------------------------------------------------------------ */
export const saveQuickNotes = loudAction<
  { sessionId: string; notes: string },
  { message: string }
>({
  name: "teacher.saveQuickNotes",
  severity: "warning",
  audit: {
    table: "sessions",
    recordId: i => i.sessionId,
    action: "UPDATE",
  },
  preflight: async () => {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) throw new Error("غير مصرح");
    return { actorId: user.id };
  },
  handler: async ({ sessionId, notes }, { actorId }) => {
    const supabase = await createClient();

    // Verify ownership through booking
    const { data: session } = await supabase
      .from("sessions")
      .select("id, booking_id")
      .eq("id", sessionId)
      .single<{ id: string; booking_id: string }>();
    if (!session) throw new Error("الجلسة غير موجودة");

    const { data: booking } = await supabase
      .from("bookings")
      .select("teacher_id")
      .eq("id", session.booking_id)
      .eq("teacher_id", actorId!)
      .single<{ teacher_id: string }>();
    if (!booking) throw new Error("ليس لديك صلاحية");

    const { error } = await supabase
      .from("sessions")
      .update({ post_session_notes: notes || null } satisfies TableUpdate<"sessions">)
      .eq("id", sessionId);
    if (error) throw error;

    revalidatePath("/teacher/dashboard");
    return { message: "تم حفظ الملاحظات" };
  },
});

/* ------------------------------------------------------------------ */
/*  startInstantSession – create booking + room in one step           */
/* ------------------------------------------------------------------ */
//
// Scope-adjusted hardening (Phase 8.6): not wrapped in `loudAction`
// because the structured `{ sessionId }` return drives the caller's
// `router.push(/teacher/sessions/${sessionId})` redirect — without it
// the teacher clicks "ابدأ الآن" and stays on the dashboard. Same
// precedent as Phase 8.4 (recreateRoom) and Phase 8.5
// (updateBookingStatus).
//
// Inline hardening covers all silent-fail paths:
// - bookingError now logged before returning user-facing error (was
//   discarded — booking insert failures invisible to ops)
// - bare `catch {}` on createRoom + sessions insert replaced with
//   logError(severity:'critical') — both Daily.co API failures AND
//   sessions DB write failures now surface to Sentry + Telegram
//   (instant sessions are a high-touch UX path; failures need
//   immediate operator visibility)
// - existing notify catch upgraded with actionName tag for filterable
//   Sentry queries
// - sessions insert error inside the try-block was previously silently
//   yielding null sessionId; now explicitly checked + logged + returned
export async function startInstantSession(studentId: string, durationMin: number = 30) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: "غير مصرح" };

  // Validate duration
  if (![30, 45, 60].includes(durationMin)) return { error: "مدة غير صالحة" };

  // Get teacher's hourly rate
  const { data: tp } = await supabase
    .from("teacher_profiles")
    .select("hourly_rate")
    .eq("teacher_id", user.id)
    .single<{ hourly_rate: number }>();
  if (!tp) return { error: "ملف المعلم غير موجود" };

  const rate = Number(tp.hourly_rate);
  const amountUsd = Number((rate * (durationMin / 60)).toFixed(2));
  const scheduledAt = new Date();

  // Enforce package balance before creating any booking (FR-009). Closes #229 / #247.
  const admin = createAdminClient();
  const { data: activePkg, error: pkgQueryErr } = await admin
    .from("student_packages")
    .select("id, sessions_remaining")
    .eq("student_id", studentId)
    .eq("status", "active")
    .gt("sessions_remaining", 0)
    .order("expires_at", { ascending: true, nullsFirst: false })
    .limit(1)
    .maybeSingle<{ id: string; sessions_remaining: number }>();

  if (pkgQueryErr) {
    logError("startInstantSession: student_packages query failed", pkgQueryErr, {
      tag: "bookings",
      actionName: "teacher.startInstantSession",
      studentId,
      teacherId: user.id,
    });
    return { error: "فشل التحقق من رصيد الباقة" };
  }
  if (!activePkg) return { error: "لا توجد باقة نشطة للطالب — يرجى تجديد الاشتراك" };

  const { data: deducted, error: deductErr } = await admin.rpc("deduct_package_session", { p_package_id: activePkg.id });
  if (deductErr) {
    logError("startInstantSession: deduct_package_session failed", deductErr, {
      tag: "bookings",
      actionName: "teacher.startInstantSession",
      studentId,
      teacherId: user.id,
      packageId: activePkg.id,
    });
    return { error: "تعذر خصم رصيد الباقة" };
  }
  if (deducted !== true) return { error: "هذه الباقة منتهية أو مستهلكة" };

  // Create booking (already confirmed)
  const { data: booking, error: bookingError } = await supabase
    .from("bookings")
    .insert({
      student_id: studentId,
      teacher_id: user.id,
      session_type: "hifz",
      duration_min: durationMin,
      rate_snapshot: rate,
      amount_usd: amountUsd,
      scheduled_at: scheduledAt.toISOString(),
      status: "confirmed",
      teacher_confirmed: true,
      teacher_confirmed_at: scheduledAt.toISOString(),
    } satisfies TableInsert<"bookings">)
    .select("id")
    .single<{ id: string }>();

  if (bookingError || !booking) {
    logError("startInstantSession: bookings insert failed", bookingError, {
      tag: "bookings",
      actionName: "teacher.startInstantSession",
      severity: "critical",
      studentId,
      teacherId: user.id,
    });
    return { error: "حدث خطأ في إنشاء الحجز" };
  }

  // Create Daily.co room
  let sessionId: string | null = null;
  try {
    const expiresAt = new Date(scheduledAt.getTime() + 2 * 60 * 60 * 1000);
    const roomName = `furqan-${booking.id.replace(/-/g, "")}`;
    const room = await createRoom(roomName, expiresAt);

    const { data: sess, error: sessErr } = await supabase.from("sessions").insert({
      booking_id: booking.id,
      room_name: room.name,
      room_url: room.url,
      expires_at: expiresAt.toISOString(),
      created_via: "manual",
    } satisfies TableInsert<"sessions">).select("id").single<{ id: string }>();

    if (sessErr) {
      // Booking insert succeeded but session insert failed — partial state.
      // The teacher's UI state will be incoherent without sessionId.
      logError("startInstantSession: sessions insert failed (booking already created)", sessErr, {
        tag: "bookings",
        actionName: "teacher.startInstantSession",
        severity: "critical",
        bookingId: booking.id,
        studentId,
      });
      return { error: "تم إنشاء الحجز لكن فشل تسجيل الجلسة" };
    }

    sessionId = sess?.id ?? null;
  } catch (err) {
    logError("startInstantSession: createRoom or sessions insert threw", err, {
      tag: "bookings",
      actionName: "teacher.startInstantSession",
      severity: "critical",
      bookingId: booking.id,
      studentId,
    });
    return { error: "تم إنشاء الحجز لكن فشل إنشاء غرفة الفيديو" };
  }

  // Notify student (best-effort)
  try {
    await notify({
      userId: studentId,
      type: "booking",
      title: "جلسة فورية",
      body: "المعلم بدأ جلسة فورية — انضم الآن!",
      entityType: "booking",
      entityId: booking.id,
    });
  } catch (err) {
    logError("startInstantSession: notify student failed", err, {
      tag: "bookings",
      actionName: "teacher.startInstantSession",
      component: "teacher.dashboard.startInstantSession",
      studentId,
      bookingId: booking.id,
    });
  }

  revalidatePath("/teacher/dashboard");
  revalidatePath("/teacher/sessions");
  return { success: true, sessionId };
}
