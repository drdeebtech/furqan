"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { requireAdmin, ForbiddenError } from "@/lib/auth/require-admin";
import { logError } from "@/lib/logger";

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
  const { data, error } = await supabase
    .from("teacher_profiles")
    .update({
      is_archived: archive,
      archived_at: archive ? new Date().toISOString() : null,
    })
    .eq("teacher_id", teacherId)
    .select("cv_status, is_accepting")
    .single<{ cv_status: string | null; is_accepting: boolean }>();

  if (error) {
    logError("admin toggleArchiveTeacher failed", error, {
      tag: "admin-teachers",
      severity: "warning",
      metadata: { teacherId, archive },
    });
    return { error: "حدث خطأ أثناء تحديث المعلم" };
  }

  // Toggle now reachable from /admin/teachers list + /admin/teachers/[id]
  // detail too, so invalidate all three admin surfaces. Also bust the
  // ISR cache on the public teachers page so unarchived teachers appear
  // there within seconds instead of waiting for the 5-min revalidate.
  revalidatePath("/admin/dashboard");
  revalidatePath("/admin/teachers");
  revalidatePath(`/admin/teachers/${teacherId}`);
  revalidatePath("/teachers");

  // Return the gate-state so the UI can warn admins when a teacher was
  // unarchived but still won't appear publicly because cv_status isn't
  // approved or is_accepting is false. Without this, the admin clicks
  // unarchive, sees success, expects the teacher on the public page,
  // and is confused when they're still hidden by another gate.
  return {
    success: true,
    cvStatus: data?.cv_status ?? null,
    isAccepting: data?.is_accepting ?? null,
  };
}
