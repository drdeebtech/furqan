"use server";

import { createClient } from "@/lib/supabase/server";
import { createMeetingToken } from "@/lib/daily";

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
  } catch {
    return { error: "تعذر إنشاء رمز الدخول — حاول مرة أخرى" };
  }
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
    // If both have joined and one leaves, consider session ended
    // We'll update ended_at — the last person to leave sets it
    const { data: currentSession } = await supabase
      .from("sessions")
      .select("started_at, teacher_joined, student_joined")
      .eq("id", sessionId)
      .single<{
        started_at: string | null;
        teacher_joined: boolean;
        student_joined: boolean;
      }>();

    if (currentSession?.started_at) {
      const startedAt = new Date(currentSession.started_at);
      const actualDuration = Math.round(
        (Date.now() - startedAt.getTime()) / 60000,
      );
      await supabase
        .from("sessions")
        .update({
          ended_at: now,
          actual_duration: actualDuration,
        } as never)
        .eq("id", sessionId);
    }
  }
}
