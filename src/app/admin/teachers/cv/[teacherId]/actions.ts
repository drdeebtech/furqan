"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { notify } from "@/lib/notifications/dispatcher";
import { emitEvent } from "@/lib/automation/emit";
import { sendTelegramAlert } from "@/lib/n8n/client";
import { sendTeacherApprovalEmail } from "@/lib/email";
import { createAdminClient } from "@/lib/supabase/admin";
import { logError } from "@/lib/logger";

export type AdminCvSaveResult = { error?: string; success?: boolean };

export async function saveCvAsAdmin(
  teacherId: string,
  _prev: AdminCvSaveResult,
  formData: FormData,
): Promise<AdminCvSaveResult> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "غير مصرح" };

  const bio = (formData.get("bio") as string | null)?.trim() || null;
  const bioEn = (formData.get("bio_en") as string | null)?.trim() || null;
  const introVideoUrl =
    (formData.get("intro_video_url") as string | null)?.trim() || null;
  // Form switched from comma-separated text to multi-checkbox — checkboxes
  // with the same `name` serialize as multiple values, so getAll() returns
  // the array directly. parseCsv() helper is no longer needed here.
  const specialties = (formData.getAll("specialties") as string[]).filter(Boolean);
  const languages = (formData.getAll("languages") as string[]).filter(Boolean);
  const recitationStandards = (formData.getAll("recitation_standards") as string[]).filter(Boolean);

  const { error } = await supabase
    .from("teacher_profiles")
    .update({
      bio,
      bio_en: bioEn,
      intro_video_url: introVideoUrl,
      specialties,
      languages,
      recitation_standards: recitationStandards,
    } as never)
    .eq("teacher_id", teacherId);

  if (error) return { error: "فشل حفظ السيرة الذاتية" };

  revalidatePath(`/admin/teachers/cv/${teacherId}`);
  revalidatePath("/admin/teachers/cv");
  revalidatePath("/teacher/cv");
  return { success: true };
}

export async function approveCv(teacherId: string) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "غير مصرح" };

  const { error } = await supabase
    .from("teacher_profiles")
    .update({
      cv_status: "approved",
      cv_reviewed_by: user.id,
      cv_reviewed_at: new Date().toISOString(),
      cv_rejection_reason: null,
    } as never)
    .eq("teacher_id", teacherId);

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

  // Fan-out to n8n welcome workflows + Telegram audit trail + congrats email.
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
      `✅ <b>Teacher CV approved</b>\n\nTeacher: ${teacherName || teacherId}\nApproved by: ${user.id}`,
    ).catch((err) => logError("approveCv telegram failed", err, { tag: "cv-review" })),
    teacherEmail
      ? sendTeacherApprovalEmail({
          to: teacherEmail,
          fullName: teacherName,
          listingUrl: `https://furqan.today/teachers-page#teacher-${teacherId}`,
        }).catch((err) => logError("approveCv approval email failed", err, { tag: "cv-review" }))
      : Promise.resolve(),
  ]);

  revalidatePath("/admin/teachers/cv");
  revalidatePath("/teacher/cv");
  revalidatePath("/teachers-page");
  revalidatePath("/student/teachers");
  return { success: true };
}

export async function resetCvToPending(teacherId: string) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "غير مصرح" };

  const { error } = await supabase
    .from("teacher_profiles")
    .update({
      cv_status: "pending_review",
      cv_reviewed_by: null,
      cv_reviewed_at: null,
      cv_rejection_reason: null,
    } as never)
    .eq("teacher_id", teacherId);

  if (error) return { error: "فشل إعادة الحالة" };

  revalidatePath("/admin/teachers/cv");
  revalidatePath(`/admin/teachers/cv/${teacherId}`);
  revalidatePath(`/admin/teachers/${teacherId}`);
  revalidatePath("/teacher/cv");
  return { success: true };
}

export async function rejectCv(teacherId: string, reason: string) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "غير مصرح" };

  if (!reason.trim()) return { error: "يجب ذكر سبب الرفض" };

  const { error } = await supabase
    .from("teacher_profiles")
    .update({
      cv_status: "rejected",
      cv_reviewed_by: user.id,
      cv_reviewed_at: new Date().toISOString(),
      cv_rejection_reason: reason.trim(),
    } as never)
    .eq("teacher_id", teacherId);

  if (error) return { error: "فشل رفض السيرة الذاتية" };

  try {
    await notify(
      teacherId,
      "system",
      "تم رفض سيرتك الذاتية",
      `تم رفض سيرتك الذاتية — السبب: ${reason.trim()}`,
      "teacher_profile",
      teacherId,
    );
  } catch { /* non-blocking */ }

  revalidatePath("/admin/teachers/cv");
  revalidatePath("/teacher/cv");
  return { success: true };
}
