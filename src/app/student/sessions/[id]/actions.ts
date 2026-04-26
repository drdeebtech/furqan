"use server";

import { createClient } from "@/lib/supabase/server";
import { createMeetingToken } from "@/lib/daily";
import { logError } from "@/lib/logger";

export async function generateSessionToken(sessionId: string) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "غير مصرح" };

  // Fetch session
  const { data: session } = await supabase
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

  if (!session) return { error: "الجلسة غير موجودة" };

  // Verify the user is a participant (student or teacher)
  const { data: booking } = await supabase
    .from("bookings")
    .select("student_id, teacher_id")
    .eq("id", session.booking_id)
    .single<{ student_id: string; teacher_id: string }>();

  if (!booking) return { error: "الحجز غير موجود" };

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

  try {
    const token = await createMeetingToken(
      session.room_name,
      userName,
      expiresAt,
      isTeacher, // teacher is room owner
    );
    return { token, roomUrl: session.room_url };
  } catch (err) {
    logError("Daily createMeetingToken failed", err, {
      component: "student.sessions.generateSessionToken",
      metadata: { sessionId, userId: user.id },
    });
    return { error: "تعذر إنشاء رمز الدخول — حاول مرة أخرى" };
  }
}

export async function submitReview(
  sessionId: string,
  rating: number,
  comment: string | null,
) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "غير مصرح" };

  if (!Number.isInteger(rating) || rating < 1 || rating > 5) {
    return { error: "التقييم يجب أن يكون بين ١ و ٥" };
  }

  // Fetch session to get booking_id
  const { data: session } = await supabase
    .from("sessions")
    .select("id, booking_id")
    .eq("id", sessionId)
    .single<{ id: string; booking_id: string }>();

  if (!session) return { error: "الجلسة غير موجودة" };

  // Fetch booking to verify student and get teacher_id
  const { data: booking } = await supabase
    .from("bookings")
    .select("student_id, teacher_id")
    .eq("id", session.booking_id)
    .single<{ student_id: string; teacher_id: string }>();

  if (!booking) return { error: "الحجز غير موجود" };

  if (booking.student_id !== user.id) {
    return { error: "ليس لديك صلاحية لتقييم هذه الجلسة" };
  }

  // Insert review — handle duplicate constraint gracefully
  const { error } = await supabase.from("reviews").insert({
    booking_id: session.booking_id,
    student_id: user.id,
    teacher_id: booking.teacher_id,
    rating,
    comment,
  } as never);

  if (error) {
    if (error.code === "23505") {
      return { error: "لقد قمت بتقييم هذه الجلسة مسبقاً" };
    }
    return { error: "حدث خطأ أثناء حفظ التقييم" };
  }

  return { success: true };
}

export async function trackSessionEvent(
  sessionId: string,
  event: "joined" | "left",
) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return;

  // Determine if user is student or teacher
  const { data: session } = await supabase
    .from("sessions")
    .select("id, booking_id, started_at")
    .eq("id", sessionId)
    .single<{ id: string; booking_id: string; started_at: string | null }>();

  if (!session) return;

  const { data: booking } = await supabase
    .from("bookings")
    .select("student_id, teacher_id")
    .eq("id", session.booking_id)
    .single<{ student_id: string; teacher_id: string }>();

  if (!booking) return;

  const isStudent = booking.student_id === user.id;
  const isTeacher = booking.teacher_id === user.id;

  if (!isStudent && !isTeacher) return;

  const now = new Date().toISOString();

  if (event === "joined") {
    const updates: Record<string, unknown> = {};
    if (isStudent) updates.student_joined = true;
    if (isTeacher) updates.teacher_joined = true;
    // Set started_at on first join
    if (!session.started_at) updates.started_at = now;

    await supabase
      .from("sessions")
      .update(updates as never)
      .eq("id", sessionId);
  } else if (event === "left") {
    // Don't auto-end the session when a participant leaves.
    // The teacher explicitly ends the session via the "إنهاء الجلسة" button
    // which calls endSession() in teacher/dashboard/actions.ts.
    // Only track that the participant left by unsetting their joined flag.
    const updates: Record<string, unknown> = {};
    if (isStudent) updates.student_joined = false;
    if (isTeacher) updates.teacher_joined = false;

    await supabase
      .from("sessions")
      .update(updates as never)
      .eq("id", sessionId);
  }
}
