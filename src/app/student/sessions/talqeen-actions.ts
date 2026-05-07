"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { logError } from "@/lib/logger";
import { notify } from "@/lib/notifications/dispatcher";

/**
 * Sprint 2.3 — Talqeen primitive (2026-05-05).
 *
 * Talqeen is the canonical Quran-pedagogy loop: teacher recites, student
 * echoes, teacher corrects. The platform's video sessions covered the
 * "talk together" half of that loop but had no structured way for the
 * student to send a recording for correction. This action creates the
 * scaffold follow-up row that the AudioRecorder client component then
 * fills with the actual audio.
 *
 * The resulting homework_assignments row has:
 *   - homework_type='recitation'
 *   - status='assigned' (will flip to 'student_ready' when audio uploads
 *     via the existing markStudentReady action)
 *   - title=auto-generated ("Talqeen recitation — <date>")
 *   - teacher_id pulled from the booking
 *   - booking_id linking back to the originating session
 *
 * The teacher gets a notification when the audio actually lands — not
 * here. This action just opens the slot.
 */
export async function createTalqeenHomework(
  bookingId: string,
): Promise<{ ok: true; homeworkId: string } | { ok: false; error: string }> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "غير مسجل الدخول" };

  // Verify the booking belongs to this student (RLS gates this anyway).
  // Pull the teacher_id + scheduled_at to populate the follow-up row.
  const { data: booking } = await supabase
    .from("bookings")
    .select("id, teacher_id, student_id, scheduled_at, session_id")
    .eq("id", bookingId)
    .single<{
      id: string;
      teacher_id: string;
      student_id: string;
      scheduled_at: string;
      session_id: string | null;
    }>();

  if (!booking || booking.student_id !== user.id) {
    return { ok: false, error: "الجلسة غير موجودة" };
  }

  const sessionDate = new Date(booking.scheduled_at).toLocaleDateString("ar-EG", {
    month: "long", day: "numeric",
  });
  const title = `تسميع تلقين — ${sessionDate}`;
  const description = "تسميع أرسله الطالب أثناء الجلسة لطلب تصحيح المعلم.";

  const { data: hw, error: insertErr } = await supabase
    .from("homework_assignments")
    .insert({
      booking_id: bookingId,
      session_id: booking.session_id,
      teacher_id: booking.teacher_id,
      student_id: user.id,
      homework_type: "recitation",
      status: "assigned",
      title,
      description,
    } as never)
    .select("id")
    .single<{ id: string }>();

  if (insertErr || !hw) {
    logError("createTalqeenHomework: insert failed", insertErr, {
      tag: "talqeen",
      metadata: { bookingId, teacher_id: booking.teacher_id },
    });
    return { ok: false, error: "فشل إنشاء طلب التسميع" };
  }

  // Light notification to teacher that a recording slot has opened — they
  // get a louder one when the audio actually lands via markStudentReady.
  try {
    await notify({
      userId: booking.teacher_id,
      type: "homework",
      title: "طلب تسميع جديد",
      body: `الطالب أنشأ طلب تسميع من جلسة ${sessionDate} — سيصل الصوت قريباً.`,
      entityType: "homework",
      entityId: hw.id,
    });
  } catch (err) {
    logError("createTalqeenHomework: notify failed", err, {
      tag: "talqeen",
      metadata: { teacher_id: booking.teacher_id, homeworkId: hw.id },
    });
  }

  revalidatePath(`/student/sessions/${booking.session_id ?? ""}`);
  return { ok: true, homeworkId: hw.id };
}
