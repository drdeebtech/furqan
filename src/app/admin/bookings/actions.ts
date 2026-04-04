"use server";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";

export async function adminUpdateBookingStatus(bookingId: string, status: string) {
  const supabase = await createClient();
  await supabase.from("bookings").update({ status } as never).eq("id", bookingId);
  revalidatePath("/admin/bookings");
  return { success: true };
}
