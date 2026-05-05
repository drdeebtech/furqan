"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { notify } from "@/lib/notifications/dispatcher";
import { logError } from "@/lib/logger";

/**
 * Student attests whether a stale-confirmed session actually happened.
 *
 * F10 (resolved 2026-05-05). Per product decision: the student CAN say
 * "yes it happened" or "no it didn't" on a session whose scheduled time
 * passed without the teacher clicking End. The attestation does NOT mark
 * the session complete on its own — it sends a notification to the
 * teacher with the student's claim attached, and the teacher still owns
 * the final lifecycle resolution. This preserves teacher authority over
 * what counts as a held session while giving the student a real voice.
 *
 * Notification target is the booking's teacher_id, regardless of who
 * created the room. Idempotency is intentionally NOT enforced — a
 * student who clicks twice should send two notifications, and the
 * teacher can read both. Hardening duplicate-suppression can come later.
 */
export async function attestSessionHappened(
  bookingId: string,
  didHappen: boolean,
): Promise<{ ok: boolean; error?: string }> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "غير مسجل الدخول" };

  // Verify the booking belongs to this student. RLS gates this anyway,
  // but an explicit check returns a clearer error than "no rows".
  const { data: booking } = await supabase
    .from("bookings")
    .select("id, teacher_id, student_id, scheduled_at, session_type")
    .eq("id", bookingId)
    .single<{ id: string; teacher_id: string; student_id: string; scheduled_at: string; session_type: string }>();

  if (!booking || booking.student_id !== user.id) {
    return { ok: false, error: "الجلسة غير موجودة" };
  }

  // Pull student's display name for the notification body.
  const { data: profile } = await supabase
    .from("profiles").select("full_name").eq("id", user.id)
    .single<{ full_name: string | null }>();
  const studentName = profile?.full_name?.trim() || "الطالب";

  const dateStr = new Date(booking.scheduled_at).toLocaleDateString("ar-EG", {
    month: "long", day: "numeric",
  });
  const verdict = didHappen ? "تمّت" : "لم تتم";
  const action = didHappen
    ? "يرجى تأكيدها وإنهاء الجلسة من لوحة التحكم."
    : "يرجى تحديث الحالة (لم تتم) أو حجز موعد بديل.";

  try {
    await notify(
      booking.teacher_id,
      "system",
      `إقرار الطالب: جلسة ${dateStr} ${verdict}`,
      `${studentName} أفاد بأن جلسة ${booking.session_type} المحددة في ${dateStr} ${verdict}. ${action}`,
    );
  } catch (err) {
    logError("attestSessionHappened: notify failed", err, {
      tag: "sessions",
      metadata: { bookingId, didHappen, teacherId: booking.teacher_id },
    });
    return { ok: false, error: "فشل إرسال الإشعار للمعلم" };
  }

  revalidatePath("/student/sessions");
  return { ok: true };
}
