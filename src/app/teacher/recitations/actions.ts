"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { notify } from "@/lib/notifications/dispatcher";
import { logError } from "@/lib/logger";
import { loudAction, notFoundOrInfra } from "@/lib/actions/loud";

class UserError extends Error {
  readonly userError = true;
  constructor(msg: string, options?: { cause?: unknown }) {
    super(msg, options);
    this.name = "UserError";
  }
}

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
 * failure. The caller's button uses `"success" in result` to discriminate.
 */
type RequestFreshRecitationInput = { studentId: string };

const requestFreshRecitationBase = loudAction<RequestFreshRecitationInput, { message: string }>({
  name: "teacher.recitation.request-fresh",
  severity: "info",
  audit: {
    table: "homework_assignments",
    recordId: (i) => i.studentId,
    action: "INSERT",
    reasonPrefix: "teacher request fresh recitation",
  },
  preflight: async () => {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) throw new UserError("غير مسجل الدخول");
    return { actorId: user.id };
  },
  handler: async ({ studentId }, { actorId }) => {
    const supabase = await createClient();

    // Find the most recent booking between this teacher and student. We
    // don't try to invent a booking — the action only makes sense when
    // there's already a teacher-student relationship.
    const { data: booking, error: bookingErr } = await supabase
      .from("bookings")
      .select("id")
      .eq("teacher_id", actorId!)
      .eq("student_id", studentId)
      .order("scheduled_at", { ascending: false })
      .limit(1)
      .maybeSingle<{ id: string }>();
    if (bookingErr) throw notFoundOrInfra(bookingErr, "فشل البحث عن الحجز");
    if (!booking) throw new UserError("لا يوجد حجز سابق مع هذا الطالب");

    // Due in 48h by default — gives the student two evenings to record.
    // TODO(human): a senior Quran teacher should validate whether 48h is
    // the right default SLA, or whether it should differ by student level.
    const dueDate = new Date(Date.now() + 48 * 60 * 60 * 1000)
      .toISOString()
      .slice(0, 10);

    const { error: insertError } = await supabase
      .from("homework_assignments")
      .insert({
        booking_id: booking.id,
        student_id: studentId,
        teacher_id: actorId!,
        homework_type: "recitation",
        title: "طلب تلاوة جديدة",
        description: "يرجى رفع تسجيل تلاوة جديدة لمراجعتي.",
        due_date: dueDate,
        review_horizon: "near",
      } as never);
    if (insertError) throw new UserError("فشل إنشاء الطلب", { cause: insertError });

    // Notify the student. Best-effort — failure here doesn't roll back
    // the homework row, but is logged so it's visible in monitoring.
    try {
      await notify({
        userId: studentId,
        type: "homework",
        title: "طلب تلاوة جديدة",
        body: "طلب منك معلمك إرسال تسجيل تلاوة جديدة.",
        entityType: "homework",
        entityId: booking.id,
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
    return { message: "requested" };
  },
});

export async function requestFreshRecitationAction(
  studentId: string,
): Promise<{ success?: true; error?: string }> {
  const result = await requestFreshRecitationBase({ studentId });
  if (!result.ok) return { error: result.error };
  return { success: true };
}
