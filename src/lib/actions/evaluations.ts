"use server";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { notify } from "@/lib/notifications/dispatcher";
import { emitEvent } from "@/lib/automation/emit";
import { logError } from "@/lib/logger";

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
  await requireAdminOrMod(supabase);

  const student_id = formData.get("student_id") as string;
  const teacher_id = formData.get("teacher_id") as string;
  const evaluation_type = formData.get("evaluation_type") as string;
  const evaluation_date = formData.get("evaluation_date") as string;
  const hifz_score = formData.get("hifz_score") ? Number(formData.get("hifz_score")) : null;
  const tajweed_score = formData.get("tajweed_score") ? Number(formData.get("tajweed_score")) : null;
  const fluency_score = formData.get("fluency_score") ? Number(formData.get("fluency_score")) : null;
  const attendance_score = formData.get("attendance_score") ? Number(formData.get("attendance_score")) : null;
  const overall_score = formData.get("overall_score") ? Number(formData.get("overall_score")) : null;
  const strengths = formData.get("strengths") as string || null;
  const areas_for_improvement = formData.get("areas_for_improvement") as string || null;
  const next_goals = formData.get("next_goals") as string || null;
  const teacher_comments = formData.get("teacher_comments") as string || null;

  if (!student_id || !teacher_id || !evaluation_type || !evaluation_date) {
    return { error: "جميع الحقول المطلوبة يجب ملؤها" };
  }

  const { error } = await supabase.from("session_evaluations").insert({
    student_id, teacher_id,
    evaluation_type, evaluation_date,
    hifz_score, tajweed_score, fluency_score, attendance_score, overall_score,
    strengths, areas_for_improvement, next_goals, teacher_comments,
  } as never);

  if (error) return { error: "فشل إنشاء التقييم" };

  // Notify student and teacher
  try {
    for (const uid of [student_id, teacher_id]) {
      await notify({
        userId: uid,
        type: "system",
        title: "تقييم جديد",
        body: "تم إضافة تقييم جديد — يمكنك الاطلاع عليه من صفحة التقييمات",
      });
    }
  } catch (err) {
    logError("notify failed during createEvaluation", err, {
      component: "evaluations.createEvaluation",
      metadata: { student_id, teacher_id },
    });
  }

  revalidatePath("/admin/evaluations");
  revalidatePath("/moderator/evaluations");
  await emitEvent("evaluation.created", "evaluation", student_id, { student_id, teacher_id, evaluation_type })
    .catch((err) => logError("emit evaluation.created failed", err, { tag: "automation", event: "evaluation.created" }));
  return { success: true };
}

// Teacher-friendly version: takes direct params, allows teacher role
export async function createTeacherEvaluation(
  studentId: string,
  evaluationType: string,
  evaluationDate: string,
  scores: { hifz?: number; tajweed?: number; fluency?: number; attendance?: number; overall: number },
  text: { strengths?: string | null; areas_for_improvement?: string | null; next_goals?: string | null; teacher_comments?: string | null },
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

  // IDOR fix: a teacher may only evaluate students they actually teach.
  // Admin/moderator are exempt — they have legitimate cross-student standing.
  // Without this check, any logged-in teacher could write a session_evaluations
  // row against an arbitrary student_id.
  if (profile.role === "teacher") {
    const { data: relation } = await supabase
      .from("bookings")
      .select("id")
      .eq("teacher_id", user.id)
      .eq("student_id", studentId)
      .limit(1)
      .maybeSingle();
    if (!relation) {
      return { error: "لا يمكنك تقييم طالب لم تُدرّسه" };
    }
  }

  const { error } = await supabase.from("session_evaluations").insert({
    student_id: studentId,
    teacher_id: user.id,
    evaluation_type: evaluationType,
    evaluation_date: evaluationDate,
    hifz_score: scores.hifz ?? null,
    tajweed_score: scores.tajweed ?? null,
    fluency_score: scores.fluency ?? null,
    attendance_score: scores.attendance ?? null,
    overall_score: scores.overall,
    strengths: text.strengths ?? null,
    areas_for_improvement: text.areas_for_improvement ?? null,
    next_goals: text.next_goals ?? null,
    teacher_comments: text.teacher_comments ?? null,
  } as never);

  if (error) return { error: "فشل إنشاء التقييم" };

  try {
    await notify({
      userId: studentId,
      type: "system",
      title: "تقييم جديد من معلمك",
      body: "أضاف معلمك تقييماً جديداً — يمكنك الاطلاع عليه من صفحة التقييمات",
    });
  } catch (err) {
    logError("notify failed during createTeacherEvaluation", err, {
      component: "evaluations.createTeacherEvaluation",
      metadata: { studentId, teacherId: user.id },
    });
  }

  revalidatePath("/teacher/evaluations");
  revalidatePath("/teacher/students");
  await emitEvent("evaluation.created", "evaluation", studentId, { student_id: studentId, teacher_id: user.id, evaluation_type: evaluationType })
    .catch((err) => logError("emit evaluation.created failed", err, { tag: "automation", event: "evaluation.created" }));
  return { success: true };
}

export async function updateEvaluation(evaluationId: string, formData: FormData) {
  const supabase = await createClient();
  await requireAdminOrMod(supabase);

  const updates: Record<string, unknown> = {};
  for (const key of ["hifz_score", "tajweed_score", "fluency_score", "attendance_score", "overall_score"]) {
    const v = formData.get(key);
    if (v) updates[key] = Number(v);
  }
  for (const key of ["strengths", "areas_for_improvement", "next_goals", "teacher_comments"]) {
    const v = formData.get(key) as string;
    if (v !== null) updates[key] = v || null;
  }

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
