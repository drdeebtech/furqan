"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";

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

  revalidatePath("/teacher/dashboard");
  return { success: true };
}
