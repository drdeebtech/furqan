"use server";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { emitEvent } from "@/lib/automation/emit";
import { requireAdmin, ForbiddenError } from "@/lib/auth/require-admin";

export async function adminUpdateBookingStatus(bookingId: string, status: string) {
  let actorId: string;
  try {
    const admin = await requireAdmin();
    actorId = admin.id;
  } catch (e) {
    if (e instanceof ForbiddenError) return { error: "ليس لديك صلاحية" };
    throw e;
  }

  const supabase = await createClient();
  const { error } = await supabase
    .from("bookings")
    .update({ status } as never)
    .eq("id", bookingId);

  if (error) return { error: "تعذر تحديث الحجز" };

  // Fire event for n8n routing (parent reports, alerts, etc.).
  // Per-status event names align with EVENT_CATALOG.md.
  const { data: booking } = await supabase
    .from("bookings")
    .select("student_id, teacher_id, status")
    .eq("id", bookingId)
    .single<{ student_id: string; teacher_id: string; status: string }>();

  if (booking) {
    const eventName =
      status === "confirmed" ? "booking.confirmed"
      : status === "cancelled" ? "booking.cancelled"
      : "booking.status_changed";
    try {
      await emitEvent(
        eventName,
        "booking",
        bookingId,
        { student_id: booking.student_id, teacher_id: booking.teacher_id, new_status: status },
        actorId,
      );
    } catch {
      // Non-blocking; emit failures must not break admin flow.
    }
  }

  revalidatePath("/admin/bookings");
  return { success: true };
}
