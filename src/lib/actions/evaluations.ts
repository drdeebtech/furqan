"use server";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";

// Helper to verify caller is admin or moderator
async function requireAdminOrMod(supabase: Awaited<ReturnType<typeof createClient>>) {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error("غير مسجل الدخول");
  const { data: profile } = await supabase
    .from("profiles").select("role").eq("id", user.id)
    .single().then(r => ({ data: r.data as { role: string } | null }));
  if (!profile || !["admin", "moderator"].includes(profile.role)) throw new Error("غير مصرح");
  return user;
}

export async function createEvaluation(formData: FormData) {
  const supabase = await createClient();
  const user = await requireAdminOrMod(supabase);

  const student_id = formData.get("student_id") as string;
  const teacher_id = formData.get("teacher_id") as string;
  const evaluation_type = formData.get("evaluation_type") as string;
  const period_start = formData.get("period_start") as string;
  const period_end = formData.get("period_end") as string;
  const hifz_score = formData.get("hifz_score") ? Number(formData.get("hifz_score")) : null;
  const tajweed_score = formData.get("tajweed_score") ? Number(formData.get("tajweed_score")) : null;
  const akhlaq_score = formData.get("akhlaq_score") ? Number(formData.get("akhlaq_score")) : null;
  const attendance_score = formData.get("attendance_score") ? Number(formData.get("attendance_score")) : null;
  const overall_score = formData.get("overall_score") ? Number(formData.get("overall_score")) : null;
  const strengths = formData.get("strengths") as string || null;
  const weaknesses = formData.get("weaknesses") as string || null;
  const recommendations = formData.get("recommendations") as string || null;
  const notes = formData.get("notes") as string || null;

  if (!student_id || !teacher_id || !evaluation_type || !period_start || !period_end) {
    return { error: "جميع الحقول المطلوبة يجب ملؤها" };
  }

  const { error } = await supabase.from("session_evaluations").insert({
    student_id, teacher_id, evaluator_id: user.id,
    evaluation_type, period_start, period_end,
    hifz_score, tajweed_score, akhlaq_score, attendance_score, overall_score,
    strengths, weaknesses, recommendations, notes,
  } as never);

  if (error) return { error: "فشل إنشاء التقييم" };

  // Notify student and teacher
  try {
    for (const uid of [student_id, teacher_id]) {
      await supabase.from("notifications").insert({
        user_id: uid, type: "system",
        title: "تقييم جديد",
        body: "تم إضافة تقييم جديد — يمكنك الاطلاع عليه من صفحة التقييمات",
        channel: ["in_app"],
      } as never);
    }
  } catch { /* non-blocking */ }

  revalidatePath("/admin/evaluations");
  revalidatePath("/moderator/evaluations");
  return { success: true };
}

export async function updateEvaluation(evaluationId: string, formData: FormData) {
  const supabase = await createClient();
  await requireAdminOrMod(supabase);

  const updates: Record<string, unknown> = {};
  for (const key of ["hifz_score", "tajweed_score", "akhlaq_score", "attendance_score", "overall_score"]) {
    const v = formData.get(key);
    if (v) updates[key] = Number(v);
  }
  for (const key of ["strengths", "weaknesses", "recommendations", "notes"]) {
    const v = formData.get(key) as string;
    if (v !== null) updates[key] = v || null;
  }
  updates.updated_at = new Date().toISOString();

  const { error } = await supabase.from("session_evaluations")
    .update(updates as never).eq("id", evaluationId);

  if (error) return { error: "فشل تحديث التقييم" };
  revalidatePath("/admin/evaluations");
  revalidatePath("/moderator/evaluations");
  return { success: true };
}

export async function deleteEvaluation(evaluationId: string) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: "غير مصرح" };

  const { data: profile } = await supabase
    .from("profiles").select("role").eq("id", user.id)
    .single<{ role: string }>();
  if (!profile || !["admin", "moderator"].includes(profile.role)) {
    return { error: "ليس لديك صلاحية" };
  }

  const { error } = await supabase
    .from("session_evaluations")
    .delete()
    .eq("id", evaluationId);

  if (error) return { error: "فشل حذف التقييم" };
  revalidatePath("/admin/evaluations");
  revalidatePath("/moderator/evaluations");
  return { success: true };
}
