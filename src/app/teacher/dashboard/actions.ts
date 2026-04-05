"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createRoom } from "@/lib/daily";

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

  // The validate_booking_status trigger guards invalid transitions.
  // RLS ensures only booking parties can update.
  const { error } = await supabase
    .from("bookings")
    .update({ status } as never)
    .eq("id", bookingId)
    .eq("teacher_id", user.id);

  if (error) {
    return { error: "حدث خطأ أثناء تحديث الحجز" };
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

      await supabase.from("sessions").insert({
        booking_id: bookingId,
        room_name: room.name,
        room_url: room.url,
        expires_at: expiresAt.toISOString(),
        created_via: "auto",
      } as never);
    } catch {
      // Don't silently swallow — return a warning
      roomWarning =
        "تم تأكيد الحجز لكن حدث خطأ في إنشاء غرفة الفيديو — يرجى المحاولة يدوياً أو التواصل مع الدعم";
    }

    // Fix #11: Notify student that booking is confirmed
    try {
      const scheduledDate = new Date(booking.scheduled_at).toLocaleDateString("ar-SA");
      await supabase.from("notifications").insert({
        user_id: booking.student_id,
        type: "booking",
        title: "تم تأكيد حجزك",
        body: `تم تأكيد جلستك بتاريخ ${scheduledDate} — يمكنك الانضمام من صفحة الجلسات`,
        data: { booking_id: bookingId },
        channel: ["in_app"],
      } as never);
    } catch {
      // Non-blocking
    }
  } else if (status === "cancelled") {
    // Fix #11: Notify student that booking is cancelled
    try {
      await supabase.from("notifications").insert({
        user_id: booking.student_id,
        type: "booking",
        title: "تم رفض حجزك",
        body: "للأسف تم رفض حجزك من قبل المعلم — يمكنك حجز موعد آخر",
        data: { booking_id: bookingId },
        channel: ["in_app"],
      } as never);
    } catch {
      // Non-blocking
    }
  }

  revalidatePath("/teacher/dashboard");
  return { success: true, roomUrl, warning: roomWarning };
}
