"use server";

import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { createMeetingToken } from "@/lib/daily";
import { logError } from "@/lib/logger";
import { loudAction, notFoundOrInfra } from "@/lib/actions/loud";
import type { TableUpdate } from "@/lib/supabase/typed-helpers";

class UserError extends Error {
  readonly userError = true;
  constructor(msg: string, options?: { cause?: unknown }) {
    super(msg, options);
    this.name = "UserError";
  }
}

/**
 * generateSessionToken returns `{ token, roomUrl }` — a multi-field payload
 * that doesn't fit loudAction's `Output: { message?: string }` constraint, so
 * the wrap is **deferred** here. Same pattern as joinAsObserver (PR 16). Kept
 * loud-by-hand with explicit logError per error path + manual `audit_log` row
 * (added in this spec — was previously missing). When the framework grows
 * typed-payload Output support, this can migrate to loudAction.
 */
export async function generateSessionToken(sessionId: string) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "غير مصرح" };

  // Fetch session
  const { data: session, error: sessionErr } = await supabase
    .from("sessions")
    .select("id, booking_id, room_name, room_url, expires_at")
    .eq("id", sessionId)
    .single<{
      id: string;
      booking_id: string;
      room_name: string;
      room_url: string;
      expires_at: string | null;
    }>();
  if (sessionErr || !session) {
    if (sessionErr && sessionErr.code !== "PGRST116") {
      logError("generateSessionToken: session lookup failed", sessionErr, {
        component: "student.sessions.generateSessionToken",
        metadata: { sessionId, userId: user.id },
      });
    }
    return { error: "الجلسة غير موجودة" };
  }

  // Verify the user is a participant (student or teacher)
  const { data: booking, error: bookingErr } = await supabase
    .from("bookings")
    .select("student_id, teacher_id")
    .eq("id", session.booking_id)
    .single<{ student_id: string; teacher_id: string }>();
  if (bookingErr || !booking) {
    if (bookingErr && bookingErr.code !== "PGRST116") {
      logError("generateSessionToken: booking lookup failed", bookingErr, {
        component: "student.sessions.generateSessionToken",
        metadata: { sessionId, bookingId: session.booking_id, userId: user.id },
      });
    }
    return { error: "الحجز غير موجود" };
  }

  const isStudent = booking.student_id === user.id;
  const isTeacher = booking.teacher_id === user.id;

  if (!isStudent && !isTeacher) {
    return { error: "ليس لديك صلاحية لهذه الجلسة" };
  }

  // Check room not expired
  if (session.expires_at && new Date(session.expires_at) < new Date()) {
    return { error: "انتهت صلاحية غرفة الجلسة" };
  }

  const expiresAt = session.expires_at
    ? new Date(session.expires_at)
    : new Date(Date.now() + 2 * 60 * 60 * 1000);

  const userName = user.user_metadata?.full_name ?? (isTeacher ? "معلم" : "طالب");

  let token: string;
  try {
    token = await createMeetingToken(
      session.room_name,
      userName,
      expiresAt,
      isTeacher, // teacher is room owner
    );
  } catch (err) {
    logError("Daily createMeetingToken failed", err, {
      component: "student.sessions.generateSessionToken",
      metadata: { sessionId, userId: user.id },
    });
    return { error: "تعذر إنشاء رمز الدخول — حاول مرة أخرى" };
  }

  // Manual audit_log row — added in this spec (was previously missing).
  // Best-effort: a failed audit insert must NOT fail the action itself.
  await createAdminClient()
    .from("audit_log")
    .insert({
      changed_by: user.id,
      table_name: "sessions",
      record_id: sessionId,
      action: "UPDATE",
      old_data: null,
      new_data: {
        room_name: session.room_name,
        role: isTeacher ? "owner" : "guest",
      },
      reason: "student.session.generate-token via loud-by-hand",
    } as never)
    .then((r) => {
      if (r.error) {
        logError("generateSessionToken: audit row failed", r.error, {
          component: "student.sessions.generateSessionToken",
          metadata: { sessionId },
        });
      }
    });

  return { token, roomUrl: session.room_url };
}

// ─── submitReview ───────────────────────────────────────────────────────────

type SubmitReviewInput = { sessionId: string; rating: number; comment: string | null };

const submitReviewBase = loudAction<SubmitReviewInput, { message: string }>({
  name: "student.session.submit-review",
  severity: "info",
  audit: {
    table: "reviews",
    recordId: (i) => i.sessionId,
    action: "INSERT",
    reasonPrefix: "student submit review",
  },
  preflight: async () => {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) throw new UserError("غير مصرح");
    return { actorId: user.id };
  },
  handler: async ({ sessionId, rating, comment }, { actorId }) => {
    if (!Number.isInteger(rating) || rating < 1 || rating > 5) {
      throw new UserError("التقييم يجب أن يكون بين ١ و ٥");
    }

    const supabase = await createClient();

    // Fetch session to get booking_id
    const { data: session, error: sessionErr } = await supabase
      .from("sessions")
      .select("id, booking_id")
      .eq("id", sessionId)
      .single<{ id: string; booking_id: string }>();
    if (sessionErr || !session) throw notFoundOrInfra(sessionErr, "الجلسة غير موجودة");

    // Fetch booking to verify student and get teacher_id
    const { data: booking, error: bookingErr } = await supabase
      .from("bookings")
      .select("student_id, teacher_id")
      .eq("id", session.booking_id)
      .single<{ student_id: string; teacher_id: string }>();
    if (bookingErr || !booking) throw notFoundOrInfra(bookingErr, "الحجز غير موجود");
    if (booking.student_id !== actorId) throw new UserError("ليس لديك صلاحية لتقييم هذه الجلسة");

    const { error } = await supabase.from("reviews").insert({
      booking_id: session.booking_id,
      student_id: actorId!,
      teacher_id: booking.teacher_id,
      rating,
      comment,
    } as never);
    if (error) {
      if (error.code === "23505") {
        // Duplicate review — pure user-input mistake, silent passthrough.
        throw new UserError("لقد قمت بتقييم هذه الجلسة مسبقاً");
      }
      throw new UserError("حدث خطأ أثناء حفظ التقييم", { cause: error });
    }
    return { message: "submitted" };
  },
});

export async function submitReview(
  sessionId: string,
  rating: number,
  comment: string | null,
): Promise<{ success?: true; error?: string }> {
  const result = await submitReviewBase({ sessionId, rating, comment });
  if (!result.ok) return { error: result.error };
  return { success: true };
}

// ─── trackSessionEvent ──────────────────────────────────────────────────────
// Fire-and-forget telemetry. Caller doesn't await on result. Wrap in
// loudAction so silent supabase write failures become visible to ops.

type TrackSessionEventInput = { sessionId: string; event: "joined" | "left" };

const trackSessionEventBase = loudAction<TrackSessionEventInput, void>({
  name: "student.session.track-event",
  severity: "info",
  // No audit row — this is high-frequency telemetry (every join/leave).
  // Auditing each one would dwarf the actual work; the wrap still gives
  // us Sentry coverage on system failure.
  preflight: async () => {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) throw new UserError("غير مصرح");
    return { actorId: user.id };
  },
  handler: async ({ sessionId, event }, { actorId }) => {
    const supabase = await createClient();

    // Determine if user is student or teacher
    const { data: session, error: sessionErr } = await supabase
      .from("sessions")
      .select("id, booking_id, started_at")
      .eq("id", sessionId)
      .single<{ id: string; booking_id: string; started_at: string | null }>();
    if (sessionErr || !session) throw notFoundOrInfra(sessionErr, "الجلسة غير موجودة");

    const { data: booking, error: bookingErr } = await supabase
      .from("bookings")
      .select("student_id, teacher_id")
      .eq("id", session.booking_id)
      .single<{ student_id: string; teacher_id: string }>();
    if (bookingErr || !booking) throw notFoundOrInfra(bookingErr, "الحجز غير موجود");

    const isStudent = booking.student_id === actorId;
    const isTeacher = booking.teacher_id === actorId;

    if (!isStudent && !isTeacher) throw new UserError("ليس لديك صلاحية");

    const now = new Date().toISOString();

    if (event === "joined") {
      const updates: TableUpdate<"sessions"> = {};
      if (isStudent) updates.student_joined = true;
      if (isTeacher) updates.teacher_joined = true;
      // Set started_at on first join
      if (!session.started_at) updates.started_at = now;

      const { error } = await supabase
        .from("sessions")
        .update(updates)
        .eq("id", sessionId);
      if (error) throw new UserError("فشل تسجيل الانضمام", { cause: error });
    } else if (event === "left") {
      // Don't auto-end the session when a participant leaves.
      // The teacher explicitly ends the session via the "إنهاء الجلسة" button
      // which calls endSession() in teacher/dashboard/actions.ts.
      // Only track that the participant left by unsetting their joined flag.
      const updates: TableUpdate<"sessions"> = {};
      if (isStudent) updates.student_joined = false;
      if (isTeacher) updates.teacher_joined = false;

      const { error } = await supabase
        .from("sessions")
        .update(updates)
        .eq("id", sessionId);
      if (error) throw new UserError("فشل تسجيل المغادرة", { cause: error });
    }
  },
});

export async function trackSessionEvent(
  sessionId: string,
  event: "joined" | "left",
): Promise<void> {
  // Caller fires-and-forgets. Don't surface errors to the UI; loudAction has
  // already logged them to Sentry.
  await trackSessionEventBase({ sessionId, event });
}
