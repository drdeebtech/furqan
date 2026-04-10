"use server";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { notify } from "@/lib/notifications/dispatcher";
import { emitEvent } from "@/lib/automation/emit";

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
      await notify(uid, "system", "تقييم جديد", "تم إضافة تقييم جديد — يمكنك الاطلاع عليه من صفحة التقييمات");
    }
  } catch { /* non-blocking */ }

  revalidatePath("/admin/evaluations");
  revalidatePath("/moderator/evaluations");
  try { await emitEvent("evaluation.created", "evaluation", student_id, { student_id, teacher_id, evaluation_type }); } catch {}
  return { success: true };
}

// Teacher-friendly version: takes direct params, allows teacher role
export async function createTeacherEvaluation(
  studentId: string,
  evaluationType: string,
  periodStart: string,
  periodEnd: string,
  scores: { hifz?: number; tajweed?: number; akhlaq?: number; attendance?: number; overall: number },
  text: { strengths?: string | null; weaknesses?: string | null; recommendations?: string | null },
) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: "غير مصرح" };

  const { data: profile } = await supabase
    .from("profiles").select("role").eq("id", user.id)
    .single<{ role: string }>();
  if (!profile || !["admin", "moderator", "teacher"].includes(profile.role)) {
    return { error: "ليس لديك صلاحية" };
  }

  const { error } = await supabase.from("session_evaluations").insert({
    student_id: studentId,
    teacher_id: user.id,
    evaluator_id: user.id,
    evaluation_type: evaluationType,
    period_start: periodStart,
    period_end: periodEnd,
    hifz_score: scores.hifz ?? null,
    tajweed_score: scores.tajweed ?? null,
    akhlaq_score: scores.akhlaq ?? null,
    attendance_score: scores.attendance ?? null,
    overall_score: scores.overall,
    strengths: text.strengths ?? null,
    weaknesses: text.weaknesses ?? null,
    recommendations: text.recommendations ?? null,
  } as never);

  if (error) return { error: "فشل إنشاء التقييم" };

  try {
    await notify(studentId, "system", "تقييم جديد من معلمك", "أضاف معلمك تقييماً جديداً — يمكنك الاطلاع عليه من صفحة التقييمات");
  } catch { /* non-blocking */ }

  revalidatePath("/teacher/evaluations");
  revalidatePath("/teacher/students");
  try { await emitEvent("evaluation.created", "evaluation", studentId, { student_id: studentId, teacher_id: user.id, evaluation_type: evaluationType }); } catch {}
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
