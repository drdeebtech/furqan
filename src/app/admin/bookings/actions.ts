"use server";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";

export async function adminUpdateBookingStatus(bookingId: string, status: string) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: "غير مصرح" };

  const { data: profile } = await supabase.from("profiles").select("role").eq("id", user.id).single<{ role: string }>();
  if (!profile || profile.role !== "admin") return { error: "ليس لديك صلاحية" };

  await supabase.from("bookings").update({ status } as never).eq("id", bookingId);
  revalidatePath("/admin/bookings");
  return { success: true };
}
