"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";

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

  // Notify teacher
  await supabase.from("notifications").insert({
    user_id: teacherId,
    type: "system",
    title: "تم قبول سيرتك الذاتية",
    body: "تمت الموافقة على سيرتك الذاتية — يمكنك الآن استقبال الطلاب",
    channel: ["in_app"],
  } as never);

  revalidatePath("/admin/teachers/cv");
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

  // Notify teacher
  await supabase.from("notifications").insert({
    user_id: teacherId,
    type: "system",
    title: "تم رفض سيرتك الذاتية",
    body: `تم رفض سيرتك الذاتية — السبب: ${reason.trim()}`,
    channel: ["in_app"],
  } as never);

  revalidatePath("/admin/teachers/cv");
  revalidatePath("/teacher/cv");
  return { success: true };
}
