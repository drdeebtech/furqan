"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { requireAdmin, ForbiddenError } from "@/lib/auth/require-admin";

export async function toggleArchiveTeacher(
  teacherId: string,
  archive: boolean,
) {
  try {
    await requireAdmin();
  } catch (e) {
    if (e instanceof ForbiddenError) return { error: "ليس لديك صلاحية" };
    throw e;
  }

  const supabase = await createClient();
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
