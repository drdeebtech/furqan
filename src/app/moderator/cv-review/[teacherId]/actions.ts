"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { notify } from "@/lib/notifications/dispatcher";
import { emitEvent } from "@/lib/automation/emit";
import { sendTelegramAlert } from "@/lib/n8n/client";
import { sendTeacherApprovalEmail } from "@/lib/email";
import { createAdminClient } from "@/lib/supabase/admin";
import { logError } from "@/lib/logger";

export async function approveCv(teacherId: string) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: "غير مصرح" };

  const { error } = await supabase.from("teacher_profiles").update({
    cv_status: "approved",
    cv_reviewed_by: user.id,
    cv_reviewed_at: new Date().toISOString(),
    cv_rejection_reason: null,
  } as never).eq("teacher_id", teacherId);

  if (error) return { error: "فشل قبول السيرة الذاتية" };

  try {
    await notify(
      teacherId,
      "system",
      "تم قبول سيرتك الذاتية",
      "تمت الموافقة على سيرتك الذاتية — يمكنك الآن استقبال الطلاب",
      "teacher_profile",
      teacherId,
    );
  } catch { /* non-blocking */ }

  const adminCli = createAdminClient();
  const [{ data: profile }, { data: { user: authUser } = { user: null } }] = await Promise.all([
    adminCli.from("profiles").select("full_name").eq("id", teacherId).single<{ full_name: string | null }>(),
    adminCli.auth.admin.getUserById(teacherId),
  ]);
  const teacherEmail = authUser?.email;
  const teacherName = profile?.full_name ?? "";

  await Promise.allSettled([
    emitEvent(
      "teacher.cv_approved",
      "teacher_profile",
      teacherId,
      { teacher_id: teacherId, approved_by: user.id },
      user.id,
    ).catch((err) => logError("approveCv emitEvent failed", err, { tag: "cv-review" })),
    sendTelegramAlert(
      `✅ <b>Teacher CV approved</b>\n\nTeacher: ${teacherName || teacherId}\nApproved by (mod): ${user.id}`,
    ).catch((err) => logError("approveCv telegram failed", err, { tag: "cv-review" })),
    teacherEmail
      ? sendTeacherApprovalEmail({
          to: teacherEmail,
          fullName: teacherName,
          listingUrl: `https://furqan.today/teachers-page#teacher-${teacherId}`,
        }).catch((err) => logError("approveCv approval email failed", err, { tag: "cv-review" }))
      : Promise.resolve(),
  ]);

  revalidatePath("/moderator/cv-review");
  revalidatePath("/admin/teachers/cv");
  revalidatePath("/teacher/cv");
  revalidatePath("/teachers-page");
  revalidatePath("/student/teachers");
  return { success: true };
}

export async function rejectCv(teacherId: string, reason: string) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: "غير مصرح" };

  if (!reason.trim()) return { error: "يرجى إدخال سبب الرفض" };

  const { error } = await supabase.from("teacher_profiles").update({
    cv_status: "rejected",
    cv_reviewed_by: user.id,
    cv_reviewed_at: new Date().toISOString(),
    cv_rejection_reason: reason,
  } as never).eq("teacher_id", teacherId);

  if (error) return { error: "فشل رفض السيرة الذاتية" };

  try {
    await notify(
      teacherId,
      "system",
      "تم رفض سيرتك الذاتية",
      `للأسف تم رفض سيرتك الذاتية — السبب: ${reason}`,
      "teacher_profile",
      teacherId,
    );
  } catch { /* non-blocking */ }

  revalidatePath("/moderator/cv-review");
  revalidatePath("/admin/teachers/cv");
  revalidatePath("/teacher/cv");
  return { success: true };
}
