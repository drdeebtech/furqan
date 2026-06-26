"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { notify } from "@/lib/notifications/dispatcher";
import { loudAction, notFoundOrInfra } from "@/lib/actions/loud";
import { UserError } from "@/lib/actions/user-error";

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
 * teacher can read both.
 */
type AttestInput = { bookingId: string; didHappen: boolean };

const attestSessionHappenedBase = loudAction<AttestInput, { message: string }>({
  name: "student.session.attest",
  severity: "info",
  // Note: no `audit:` block. The handler only reads `bookings` + `profiles`
  // and dispatches a notification — there is NO DB mutation on `bookings`.
  // Auditing this as `bookings UPDATE` (the prior shape) created misleading
  // audit rows that suggested a booking-status change had occurred. The
  // notification itself has its own message_delivery_log audit trail via
  // `notify()`, so we don't lose observability by dropping this row.
  // (Flagged by CodeRabbit on PR #271 review — confirmed accurate.)
  preflight: async () => {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) throw new UserError("غير مسجل الدخول");
    return { actorId: user.id };
  },
  handler: async ({ bookingId, didHappen }, { actorId }) => {
    const supabase = await createClient();

    // Verify the booking belongs to this student. RLS gates this anyway,
    // but an explicit check returns a clearer error than "no rows".
    const { data: booking, error: bookingErr } = await supabase
      .from("bookings")
      .select("id, teacher_id, student_id, scheduled_at, session_type")
      .eq("id", bookingId)
      .single<{ id: string; teacher_id: string; student_id: string; scheduled_at: string; session_type: string }>();
    if (bookingErr || !booking) throw notFoundOrInfra(bookingErr, "الجلسة غير موجودة");
    if (booking.student_id !== actorId) throw new UserError("الجلسة غير موجودة");

    // Pull student's display name for the notification body.
    const { data: profile } = await supabase
      .from("profiles").select("full_name").eq("id", actorId!)
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
      await notify({
        userId: booking.teacher_id,
        type: "system",
        title: `إقرار الطالب: جلسة ${dateStr} ${verdict}`,
        body: `${studentName} أفاد بأن جلسة ${booking.session_type} المحددة في ${dateStr} ${verdict}. ${action}`,
      });
    } catch (err) {
      throw new UserError("فشل إرسال الإشعار للمعلم", { cause: err });
    }

    revalidatePath("/student/sessions");
    return { message: didHappen ? "happened" : "missed" };
  },
});

export async function attestSessionHappened(
  bookingId: string,
  didHappen: boolean,
): Promise<{ ok: boolean; error?: string }> {
  const result = await attestSessionHappenedBase({ bookingId, didHappen });
  if (!result.ok) return { ok: false, error: result.error };
  return { ok: true };
}
