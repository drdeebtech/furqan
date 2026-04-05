"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";

export async function toggleArchiveTeacher(
  teacherId: string,
  archive: boolean,
) {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return { error: "غير مصرح" };

  const { data: profile } = await supabase.from("profiles").select("role").eq("id", user.id).single<{ role: string }>();
  if (!profile || profile.role !== "admin") return { error: "ليس لديك صلاحية" };

  const { error } = await supabase
    .from("teacher_profiles")
    .update({
      is_archived: archive,
      archived_at: archive ? new Date().toISOString() : null,
    } as never)
    .eq("teacher_id", teacherId);

  if (error) {
    return { error: "حدث خطأ أثناء تحديث المعلم" };
  }

  revalidatePath("/admin/dashboard");
  return { success: true };
}
