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

  // Toggle now reachable from /admin/teachers list + /admin/teachers/[id]
  // detail too, so invalidate all three admin surfaces. Also bust the
  // ISR cache on the public teachers page so unarchived teachers appear
  // there within seconds instead of waiting for the 5-min revalidate.
  revalidatePath("/admin/dashboard");
  revalidatePath("/admin/teachers");
  revalidatePath(`/admin/teachers/${teacherId}`);
  revalidatePath("/teachers-page");
  return { success: true };
}
