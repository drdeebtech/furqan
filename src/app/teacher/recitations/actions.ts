"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { notify } from "@/lib/notifications/dispatcher";
import { logError } from "@/lib/logger";

/**
 * Quick-action: ask a student to send a fresh recording.
 *
 * Reuses the existing follow-up infrastructure (homework_assignments) by
 * inserting a `homework_type='recitation'` row tied to the most recent
 * booking between teacher + student. The student then submits via the
 * standard /student/sessions talqeen flow, and the teacher grades it on
 * /teacher/talqeen — same loop as a normal follow-up.
 *
 * Returns `{ success: true }` on insert, `{ error: string }` on any
 * failure. The caller's form must render <ActionFeedback> (the form on
 * the recitation-roster row does so).
 */
export async function requestFreshRecitationAction(
  studentId: string,
): Promise<{ success: true } | { error: string }> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "غير مسجل الدخول" };

  // Find the most recent booking between this teacher and student. We
  // don't try to invent a booking — the action only makes sense when
  // there's already a teacher-student relationship.
  const bookingRes = await supabase
    .from("bookings")
    .select("id")
    .eq("teacher_id", user.id)
    .eq("student_id", studentId)
    .order("scheduled_at", { ascending: false })
    .limit(1)
    .maybeSingle<{ id: string }>();
  if (bookingRes.error) {
    logError(
      "requestFreshRecitation: booking lookup failed",
      bookingRes.error,
      {
        component: "teacher.recitations.requestFreshRecitation",
        metadata: { studentId, teacherId: user.id },
      },
    );
    return { error: "فشل البحث عن الحجز" };
  }
  if (!bookingRes.data) {
    return { error: "لا يوجد حجز سابق مع هذا الطالب" };
  }

  // Due in 48h by default — gives the student two evenings to record.
  // TODO(human): a senior Quran teacher should validate whether 48h is
  // the right default SLA, or whether it should differ by student level.
  // See Learning by Doing #4 in the parity plan.
  const dueDate = new Date(Date.now() + 48 * 60 * 60 * 1000)
    .toISOString()
    .slice(0, 10);

  const { error: insertError } = await supabase
    .from("homework_assignments")
    .insert({
      booking_id: bookingRes.data.id,
      student_id: studentId,
      teacher_id: user.id,
      homework_type: "recitation",
      title: "طلب تلاوة جديدة",
      description: "يرجى رفع تسجيل تلاوة جديدة لمراجعتي.",
      due_date: dueDate,
      review_horizon: "near",
    } as never);

  if (insertError) {
    logError("requestFreshRecitation: insert failed", insertError, {
      component: "teacher.recitations.requestFreshRecitation",
      metadata: { studentId, teacherId: user.id },
    });
    return { error: "فشل إنشاء الطلب" };
  }

  // Notify the student. Best-effort — failure here doesn't roll back
  // the homework row, but is logged so it's visible in monitoring.
  try {
    await notify({
      userId: studentId,
      type: "homework",
      title: "طلب تلاوة جديدة",
      body: "طلب منك معلمك إرسال تسجيل تلاوة جديدة.",
      entityType: "homework",
      entityId: bookingRes.data.id,
    });
  } catch (err) {
    logError("requestFreshRecitation: notify failed", err, {
      component: "teacher.recitations.requestFreshRecitation",
      metadata: { studentId },
    });
  }

  revalidatePath("/teacher/recitations");
  revalidatePath("/teacher/follow-up");
  revalidatePath("/student/follow-up");
  revalidatePath("/student/dashboard");
  return { success: true };
}
