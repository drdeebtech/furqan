"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";

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
    await supabase.from("notifications").insert({
      user_id: teacherId,
      type: "system",
      title: "تم قبول سيرتك الذاتية",
      body: "تمت الموافقة على سيرتك الذاتية — يمكنك الآن استقبال الطلاب",
      channel: ["in_app"],
    } as never);
  } catch { /* non-blocking */ }

  revalidatePath("/moderator/cv-review");
  revalidatePath("/admin/teachers/cv");
  revalidatePath("/teacher/cv");
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
    await supabase.from("notifications").insert({
      user_id: teacherId,
      type: "system",
      title: "تم رفض سيرتك الذاتية",
      body: `للأسف تم رفض سيرتك الذاتية — السبب: ${reason}`,
      channel: ["in_app"],
    } as never);
  } catch { /* non-blocking */ }

  revalidatePath("/moderator/cv-review");
  revalidatePath("/admin/teachers/cv");
  revalidatePath("/teacher/cv");
  return { success: true };
}
