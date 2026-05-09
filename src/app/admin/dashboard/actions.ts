"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireAdmin, ForbiddenError } from "@/lib/auth/require-admin";
import { logError } from "@/lib/logger";

/**
 * toggleArchiveTeacher returns `{ success, cvStatus, isAccepting }` — a
 * multi-field gate-state payload the admin UI uses to warn when a
 * teacher was unarchived but still won't show publicly. This shape
 * doesn't fit `loudAction`'s `Output: { message?: string }` constraint,
 * so the wrap is **deferred** here. Same pattern as joinAsObserver
 * (PR 16) and bulkGradeHomework (PR 19): kept loud-by-hand with
 * explicit logError + manual audit_log row added.
 */
export async function toggleArchiveTeacher(
  teacherId: string,
  archive: boolean,
) {
  let actorId: string;
  try {
    ({ id: actorId } = await requireAdmin());
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

  // Audit row — added in Phase 2 finish PR. Previously missing; admin
  // archive/unarchive actions now leave a trail. Best-effort: an
  // audit_log insert failure must not fail the toggle itself.
  await createAdminClient()
    .from("audit_log")
    .insert({
      changed_by: actorId,
      table_name: "teacher_profiles",
      record_id: teacherId,
      action: "UPDATE",
      old_data: { is_archived: !archive },
      new_data: { is_archived: archive },
      reason: archive ? "admin archived teacher" : "admin unarchived teacher",
    })
    .then((r) => {
      if (r.error) logError("toggleArchiveTeacher: audit row failed", r.error, { tag: "admin-teachers" });
    });

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
