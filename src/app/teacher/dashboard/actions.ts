"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import type { TableInsert, TableUpdate } from "@/lib/supabase/typed-helpers";
import { createRoom, updateRoomExpiry } from "@/lib/daily";
import { notifyParentSessionComplete, notifyParentNoShow } from "@/lib/notifications/parent";
import { notify } from "@/lib/notifications/dispatcher";
import { logError } from "@/lib/logger";
import { emitEvent } from "@/lib/automation/emit";
import { loudAction } from "@/lib/actions/loud";

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

  // The validate_booking_status trigger guards invalid transitions.
  // RLS ensures only booking parties can update.
  const updateData: Record<string, unknown> = { status };

  // V9: Set teacher_confirmed fields on confirmation
  if (status === "confirmed") {
    updateData.teacher_confirmed = true;
    updateData.teacher_confirmed_at = new Date().toISOString();
  }

  const { error } = await supabase
    .from("bookings")
    .update(updateData as TableUpdate<"bookings">)
    .eq("id", bookingId)
    .eq("teacher_id", user.id);

  if (error) {
    return { error: "حدث خطأ أثناء تحديث الحجز" };
  }

  // V9: Auto-cancel other pending bookings at overlapping times for this teacher
  if (status === "confirmed") {
    const scheduledStart = new Date(booking.scheduled_at);
    const scheduledEnd = new Date(scheduledStart.getTime() + booking.duration_min * 60 * 1000);

    // Find other pending bookings for this teacher that overlap
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
          await supabase
            .from("bookings")
            .update({
              status: "cancelled",
              cancelled_by: user.id,
              cancel_reason: "تم إلغاؤه تلقائياً بسبب تعارض مع حجز مؤكد آخر",
              cancelled_at: new Date().toISOString(),
              decline_reason: "تعارض مع حجز مؤكد",
            } satisfies TableUpdate<"bookings">)
            .eq("id", other.id);

          // Notify student of auto-cancellation
          try {
            await notify(other.student_id, "booking", "تم إلغاء حجزك تلقائياً", "تم إلغاء حجزك بسبب تعارض مع حجز آخر مؤكد — يمكنك حجز موعد بديل", "booking", other.id);
          } catch { /* non-blocking */ }
        }
      }
    }
  }

  let roomUrl: string | null = null;
  let roomWarning: string | null = null;

  if (status === "confirmed") {
    // Create Daily.co room and session
    try {
      const scheduledAt = new Date(booking.scheduled_at);
      const expiresAt = new Date(scheduledAt.getTime() + 2 * 60 * 60 * 1000);
      const roomName = `furqan-${bookingId.replace(/-/g, "")}`;

      const room = await createRoom(roomName, expiresAt);
      roomUrl = room.url;

      const { error: sessInsErr } = await supabase.from("sessions").insert({
        booking_id: bookingId,
        room_name: room.name,
        room_url: room.url,
        expires_at: expiresAt.toISOString(),
        created_via: "auto",
      } satisfies TableInsert<"sessions">);
      if (sessInsErr) {
        logError("teacher.confirmBooking: sessions insert failed", sessInsErr, { tag: "bookings" });
        roomWarning = "تم تأكيد الحجز لكن فشل تسجيل الجلسة — راسل الدعم";
      }
    } catch (err) {
      logError("teacher.confirmBooking: createRoom threw", err, { tag: "bookings" });
      roomWarning =
        "تم تأكيد الحجز لكن حدث خطأ في إنشاء غرفة الفيديو — يرجى المحاولة يدوياً أو التواصل مع الدعم";
    }

    // Notify student that booking is confirmed
    try {
      const scheduledDate = new Date(booking.scheduled_at).toLocaleDateString("ar");
      await notify(booking.student_id, "booking", "تم تأكيد حجزك", `تم تأكيد جلستك بتاريخ ${scheduledDate} — يمكنك الانضمام من صفحة الجلسات`, "booking", bookingId);
    } catch { /* non-blocking */ }
  } else if (status === "cancelled") {
    // Notify student that booking is cancelled
    try {
      await notify(booking.student_id, "booking", "تم رفض حجزك", "للأسف تم رفض حجزك من قبل المعلم — يمكنك حجز موعد آخر", "booking", bookingId);
    } catch { /* non-blocking */ }
  }

  revalidatePath("/teacher/dashboard");
  await emitEvent("booking.confirmed", "booking", bookingId, { student_id: booking.student_id, teacher_id: user.id })
    .catch((err) => logError("emit booking.confirmed failed", err, { tag: "automation", event: "booking.confirmed" }));
  return { success: true, roomUrl, warning: roomWarning };
}

/* ------------------------------------------------------------------ */
/*  markNoShow – teacher marks student as no-show                     */
/* ------------------------------------------------------------------ */
export async function markNoShow(bookingId: string) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "غير مصرح" };

  const { data: booking } = await supabase
    .from("bookings")
    .select("student_id, teacher_id")
    .eq("id", bookingId)
    .eq("teacher_id", user.id)
    .single<{ student_id: string; teacher_id: string }>();

  if (!booking) return { error: "الحجز غير موجود أو ليس لديك صلاحية" };

  const { error } = await supabase
    .from("bookings")
    .update({ status: "no_show" } satisfies TableUpdate<"bookings">)
    .eq("id", bookingId)
    .eq("teacher_id", user.id);

  if (error) {
    logError("teacher markNoShow failed", error, { tag: "teacher-bookings", severity: "warning", metadata: { bookingId, teacherId: user.id } });
    return { error: "حدث خطأ أثناء تحديث الحجز" };
  }

  // Mark session as ended
  await supabase
    .from("sessions")
    .update({ ended_at: new Date().toISOString() } satisfies TableUpdate<"sessions">)
    .eq("booking_id", bookingId);

  // Notify student
  try {
    await notify(booking.student_id, "booking", "تم تسجيل غيابك", "سجّل المعلم غيابك عن الجلسة — تواصل مع المعلم لإعادة الجدولة", "booking", bookingId);
  } catch { /* non-blocking */ }

  // V9: Notify parent of no-show
  try {
    await notifyParentNoShow(booking.student_id, user.id, new Date().toISOString(), user.id);
  } catch { /* non-blocking */ }

  revalidatePath("/teacher/dashboard");
  revalidatePath("/teacher/sessions");
  await emitEvent("session.no_show", "booking", bookingId, { student_id: booking.student_id, teacher_id: user.id })
    .catch((err) => logError("emit session.no_show failed", err, { tag: "automation", event: "session.no_show" }));
  return { success: true };
}

/* ------------------------------------------------------------------ */
/*  endSession – teacher manually ends a live session                 */
/* ------------------------------------------------------------------ */
export async function endSession(sessionId: string) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "غير مصرح" };

  const { data: session } = await supabase
    .from("sessions")
    .select("id, booking_id, started_at, ended_at")
    .eq("id", sessionId)
    .single<{
      id: string;
      booking_id: string;
      started_at: string | null;
      ended_at: string | null;
    }>();

  if (!session) return { error: "الجلسة غير موجودة" };
  if (session.ended_at) return { error: "الجلسة منتهية بالفعل" };

  // Verify teacher owns the booking
  const { data: booking } = await supabase
    .from("bookings")
    .select("student_id, teacher_id, duration_min")
    .eq("id", session.booking_id)
    .eq("teacher_id", user.id)
    .single<{ student_id: string; teacher_id: string; duration_min: number }>();

  if (!booking) return { error: "ليس لديك صلاحية لإنهاء هذه الجلسة" };

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

  if (sessionError) return { error: "حدث خطأ أثناء إنهاء الجلسة" };

  // Mark booking as completed
  await supabase
    .from("bookings")
    .update({ status: "completed" } satisfies TableUpdate<"bookings">)
    .eq("id", session.booking_id)
    .eq("teacher_id", user.id);

  // Notify student
  try {
    await notify(booking.student_id, "booking", "تمت الجلسة", `أنهى المعلم الجلسة — المدة الفعلية: ${actualDuration} دقيقة`, "session", sessionId);
  } catch (err) {
    logError("notify student failed during teacher endSession", err, {
      component: "teacher.dashboard.endSession",
      metadata: { student_id: booking.student_id, sessionId },
    });
  }

  // V9: Notify parent of session completion
  try {
    await notifyParentSessionComplete(
      booking.student_id, user.id,
      session.started_at ?? now.toISOString(),
      actualDuration, user.id,
    );
  } catch { /* non-blocking */ }

  revalidatePath("/teacher/dashboard");
  revalidatePath(`/teacher/sessions/${sessionId}`);
  revalidatePath("/teacher/sessions");
  await emitEvent("session.ended", "session", sessionId, { booking_id: session.booking_id, teacher_id: user.id, actual_duration: actualDuration })
    .catch((err) => logError("emit session.ended failed", err, { tag: "automation", event: "session.ended" }));
  return { success: true };
}

/* ------------------------------------------------------------------ */
/*  extendSessionRoom – extend an about-to-expire Daily room (+1 hr)  */
/* ------------------------------------------------------------------ */
export async function extendSessionRoom(sessionId: string) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "غير مصرح" };

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

  if (!session) return { error: "الجلسة غير موجودة" };

  // Verify teacher owns the booking
  const { data: booking } = await supabase
    .from("bookings")
    .select("teacher_id")
    .eq("id", session.booking_id)
    .eq("teacher_id", user.id)
    .single<{ teacher_id: string }>();

  if (!booking) return { error: "ليس لديك صلاحية" };

  const newExpiry = new Date(Date.now() + 60 * 60 * 1000);

  try {
    await updateRoomExpiry(session.room_name, newExpiry);
  } catch {
    return { error: "حدث خطأ أثناء تمديد الغرفة" };
  }

  await supabase
    .from("sessions")
    .update({ expires_at: newExpiry.toISOString() } satisfies TableUpdate<"sessions">)
    .eq("id", sessionId);

  revalidatePath("/teacher/dashboard");
  revalidatePath(`/teacher/sessions/${sessionId}`);
  return { success: true, newExpiresAt: newExpiry.toISOString() };
}

/* ------------------------------------------------------------------ */
/*  recreateRoom – create a new Daily room for expired / failed rooms */
/* ------------------------------------------------------------------ */
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
  } catch {
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
    logError("teacher.regenerateRoom: sessions write failed", roomErr, { tag: "bookings" });
    return { success: false, error: `فشل حفظ الغرفة: ${roomErr.message}` };
  }

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

  if (bookingError || !booking) return { error: "حدث خطأ في إنشاء الحجز" };

  // Create Daily.co room
  let sessionId: string | null = null;
  try {
    const expiresAt = new Date(scheduledAt.getTime() + 2 * 60 * 60 * 1000);
    const roomName = `furqan-${booking.id.replace(/-/g, "")}`;
    const room = await createRoom(roomName, expiresAt);

    const { data: sess } = await supabase.from("sessions").insert({
      booking_id: booking.id,
      room_name: room.name,
      room_url: room.url,
      expires_at: expiresAt.toISOString(),
      created_via: "manual",
    } satisfies TableInsert<"sessions">).select("id").single<{ id: string }>();

    sessionId = sess?.id ?? null;
  } catch {
    return { error: "تم إنشاء الحجز لكن فشل إنشاء غرفة الفيديو" };
  }

  // Notify student
  try {
    await notify(studentId, "booking", "جلسة فورية", "المعلم بدأ جلسة فورية — انضم الآن!", "booking", booking.id);
  } catch (err) {
    logError("notify student failed during teacher startInstantSession", err, {
      component: "teacher.dashboard.startInstantSession",
      metadata: { studentId, bookingId: booking.id },
    });
  }

  revalidatePath("/teacher/dashboard");
  revalidatePath("/teacher/sessions");
  return { success: true, sessionId };
}
