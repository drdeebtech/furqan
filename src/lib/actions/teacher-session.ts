"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import type { TableUpdate } from "@/lib/supabase/typed-helpers";
import { updateRoomExpiry } from "@/lib/daily";
import { logError } from "@/lib/logger";
import { loudAction } from "@/lib/actions/loud";
import {
  endSession as endSessionOrchestrator,
  startInstantSession as startInstantSessionOrchestrator,
  recordNoShow,
} from "@/lib/domains/session/orchestrate";
import {
  SessionNotFoundError,
  StartInstantSessionError,
} from "@/lib/domains/session/types";

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

    // Auth: verify teacher owns this booking before delegating.
    const { data: booking } = await supabase
      .from("bookings")
      .select("id, scheduled_at")
      .eq("id", bookingId)
      .eq("teacher_id", actorId!)
      .maybeSingle<{ id: string; scheduled_at: string | null }>();

    if (!booking) throw new Error("الحجز غير موجود أو ليس لديك صلاحية");

    // Spec 022: an unscheduled assessment/specialized booking has no session to
    // miss — no-show is only meaningful once a slot is scheduled (server-side
    // guard backing the UI; clients must not be able to no-show a slot-less row).
    if (booking.scheduled_at === null) {
      throw new Error("لا يمكن تسجيل الغياب لحجز غير مُجدوَل");
    }

    await recordNoShow({ bookingId, actorId: actorId! });

    revalidatePath("/teacher/dashboard");
    revalidatePath("/teacher/sessions");

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

    // Authorize: the teacher must own the session's booking. Authz stays at
    // the route adapter (ADR-0002); the orchestrator owns the cross-domain
    // end-session choreography (ADR-0004).
    // `.maybeSingle()` so a missing session yields the friendly "الجلسة غير
    // موجودة" below — `.single()` returns a PGRST116 error on 0 rows, which the
    // `if (sessReadErr) throw` above would surface as a generic error instead.
    const { data: session, error: sessReadErr } = await supabase
      .from("sessions")
      .select("id, booking_id")
      .eq("id", sessionId)
      .maybeSingle<{ id: string; booking_id: string }>();

    if (sessReadErr) throw sessReadErr;
    if (!session) throw new Error("الجلسة غير موجودة");

    const { data: owned, error: ownErr } = await supabase
      .from("bookings")
      .select("id")
      .eq("id", session.booking_id)
      .eq("teacher_id", actorId!)
      .maybeSingle<{ id: string }>();

    if (ownErr) throw ownErr;
    if (!owned) throw new Error("ليس لديك صلاحية لإنهاء هذه الجلسة");

    // Atomic sessions+bookings end + best-effort notify(student/parent) +
    // emitEvent("session.ended"). Idempotent when the Daily webhook already
    // ended the session (returns alreadyEnded). The actor IS the teacher, so
    // the orchestrator does not self-notify.
    try {
      await endSessionOrchestrator({ sessionId, actorId: actorId! });
    } catch (err) {
      if (err instanceof SessionNotFoundError) throw new Error("الجلسة غير موجودة");
      throw err; // SessionEndError / unexpected → loudAction captures (critical)
    }

    revalidatePath("/teacher/dashboard");
    revalidatePath(`/teacher/sessions/${sessionId}`);
    revalidatePath("/teacher/sessions");

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
// (updateBookingStatus). Business logic delegated to startInstantSession
// orchestrator (src/lib/domains/session/orchestrate.ts).
export async function startInstantSession(studentId: string, durationMin: number = 30) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: "غير مصرح" };

  if (![30, 45, 60].includes(durationMin)) return { error: "مدة غير صالحة" };

  // Route adapter: pre-fetch hourly_rate so the orchestrator stays auth-free.
  const { data: tp } = await supabase
    .from("teacher_profiles")
    .select("hourly_rate")
    .eq("teacher_id", user.id)
    .single<{ hourly_rate: number }>();
  if (!tp) return { error: "ملف المعلم غير موجود" };

  try {
    const result = await startInstantSessionOrchestrator({
      teacherId: user.id,
      studentId,
      durationMin: durationMin as 30 | 45 | 60,
      hourlyRate: Number(tp.hourly_rate),
    });

    revalidatePath("/teacher/dashboard");
    revalidatePath("/teacher/sessions");
    return { success: true, sessionId: result.sessionId };
  } catch (err) {
    if (err instanceof StartInstantSessionError) {
      logError("startInstantSession: orchestrator failed", err, {
        tag: "bookings",
        actionName: "teacher.startInstantSession",
        studentId,
        teacherId: user.id,
      });
      return { error: err.message };
    }
    throw err;
  }
}
