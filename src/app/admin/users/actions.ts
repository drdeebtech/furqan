"use server";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";

export async function toggleUserActive(userId: string, isActive: boolean) {
  const supabase = await createClient();
  await supabase.from("profiles").update({ is_active: isActive } as never).eq("id", userId);
  revalidatePath("/admin/users");
  return { success: true };
}

export async function changeUserRole(userId: string, role: string) {
  const supabase = await createClient();
  await supabase.from("profiles").update({ role } as never).eq("id", userId);
  revalidatePath("/admin/users");
  return { success: true };
}
