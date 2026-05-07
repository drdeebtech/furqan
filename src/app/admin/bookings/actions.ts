"use server";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { emitEvent } from "@/lib/automation/emit";
import { requireAdmin, ForbiddenError } from "@/lib/auth/require-admin";
import { logError } from "@/lib/logger";

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

  // Capture old status for audit
  const { data: before } = await supabase
    .from("bookings")
    .select("status")
    .eq("id", bookingId)
    .single<{ status: string }>();

  const { error } = await supabase
    .from("bookings")
    .update({ status } as never)
    .eq("id", bookingId);

  if (error) {
    logError("admin updateBookingStatus failed", error, { tag: "admin-bookings", severity: "warning", metadata: { bookingId, status, actorId } });
    return { error: "تعذر تحديث الحجز" };
  }

  await supabase.from("audit_log").insert({
    changed_by: actorId,
    table_name: "bookings",
    record_id: bookingId,
    action: "UPDATE",
    old_data: { status: before?.status ?? null },
    new_data: { status },
    reason: `Admin set booking ${status}`,
  }).then((r) => {
    if (r.error) logError("updateBookingStatus: audit row failed", r.error, { tag: "admin-bookings" });
  });

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
    } catch (err) {
      logError("updateBookingStatus: emitEvent failed", err, { tag: "admin-bookings" });
    }
  }

  revalidatePath("/admin/bookings");
  return { success: true };
}
