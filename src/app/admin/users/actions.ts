"use server";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";

export async function toggleUserActive(userId: string, isActive: boolean) {
  const supabase = await createClient();
  const { error } = await supabase.from("profiles").update({ is_active: isActive } as never).eq("id", userId);
  if (error) return { error: "فشل تحديث حالة المستخدم" };
  revalidatePath("/admin/users");
  return { success: true };
}

export async function changeUserRole(userId: string, role: string) {
  const supabase = await createClient();

  // Update the profile role
  const { error } = await supabase.from("profiles").update({ role } as never).eq("id", userId);
  if (error) return { error: "فشل تغيير الدور — تأكد من صلاحيات المدير" };

  // If changing TO teacher, create teacher_profiles row if it doesn't exist
  if (role === "teacher") {
    const { data: existing } = await supabase
      .from("teacher_profiles")
      .select("teacher_id")
      .eq("teacher_id", userId)
      .single();

    if (!existing) {
      await supabase.from("teacher_profiles").insert({
        teacher_id: userId,
        specialties: [],
        hourly_rate: 20,
        languages: ["ar"],
        recitation_standards: ["hafs"],
      } as never);
    }
  }

  // If changing FROM teacher, archive the teacher profile
  if (role !== "teacher") {
    await supabase.from("teacher_profiles").update({
      is_archived: true,
      archived_at: new Date().toISOString(),
    } as never).eq("teacher_id", userId);
  }

  revalidatePath("/admin/users");
  revalidatePath("/admin/teachers");
  return { success: true };
}
