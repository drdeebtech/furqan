"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createRoom } from "@/lib/daily";

/**
 * Update a booking's status and, when confirming, provision a Daily.co room and create a session record.
 *
 * @param bookingId - The booking's identifier (UUID).
 * @param status - New status, either `"confirmed"` or `"cancelled"`.
 * @returns An object `{ success: true, roomUrl: string | null }` on success — `roomUrl` is the created room's URL when confirmation succeeded (or `null` if no room was created) — or `{ error: string }` on failure (e.g., unauthorized or update error).
 */
export async function updateBookingStatus(
  bookingId: string,
  status: "confirmed" | "cancelled",
) {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return { error: "غير مصرح" };

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

  // On confirmation, create a Daily.co room and insert session
  let roomUrl: string | null = null;
  if (status === "confirmed") {
    try {
      const { data: booking } = await supabase
        .from("bookings")
        .select("scheduled_at, duration_min")
        .eq("id", bookingId)
        .single<{ scheduled_at: string; duration_min: number }>();

      if (booking) {
        const scheduledAt = new Date(booking.scheduled_at);
        const expiresAt = new Date(
          scheduledAt.getTime() + 2 * 60 * 60 * 1000,
        );
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
      }
    } catch {
      // Don't block the confirmation — booking is already confirmed.
      // Room can be created manually later if Daily API is down.
    }
  }

  revalidatePath("/teacher/dashboard");
  return { success: true, roomUrl };
}
