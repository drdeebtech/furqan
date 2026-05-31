"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { logError } from "@/lib/logger";
import type { TableInsert, TableUpdate } from "@/lib/supabase/typed-helpers";

interface ActionResult { ok: boolean; error?: string; id?: string }

export type QuestionType = "mcq" | "fill_in" | "true_false";

interface MCQOption {
  id: string;
  text_ar: string;
  text_en?: string;
}

// Auth helpers ----------------------------------------------------------------

async function authCourseOwner(courseId: string): Promise<{ ok: true; userId: string } | { ok: false; error: string }> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "غير مسجل الدخول" };

  const { data: course } = await supabase
    .from("courses").select("teacher_id").eq("id", courseId).single<{ teacher_id: string | null }>();
  if (!course) return { ok: false, error: "الدورة غير موجودة" };
  if (course.teacher_id === user.id) return { ok: true, userId: user.id };

  const { data: profile } = await supabase
    .from("profiles").select("role").eq("id", user.id).single<{ role: string }>();
  if (profile?.role === "admin") {
    return { ok: true, userId: user.id };
  }
  return { ok: false, error: "غير مصرح" };
}

async function authQuizOwner(quizId: string): Promise<{ ok: true; userId: string; courseId: string } | { ok: false; error: string }> {
  const supabase = await createClient();
  const { data: quiz } = await supabase.from("quizzes").select("course_id").eq("id", quizId)
    .single<{ course_id: string }>();
  if (!quiz) return { ok: false, error: "الاختبار غير موجود" };
  const auth = await authCourseOwner(quiz.course_id);
  if (!auth.ok) return auth;
  return { ok: true, userId: auth.userId, courseId: quiz.course_id };
}

// Quiz CRUD ------------------------------------------------------------------

export async function createQuiz(courseId: string, formData: FormData): Promise<ActionResult> {
  const auth = await authCourseOwner(courseId);
  if (!auth.ok) return auth;

  const title_ar = String(formData.get("title_ar") ?? "").trim();
  if (!title_ar) return { ok: false, error: "العنوان بالعربية مطلوب" };

  const insert: TableInsert<"quizzes"> = {
    course_id: courseId,
    title_ar,
    title_en: String(formData.get("title_en") ?? "").trim() || null,
    description_ar: String(formData.get("description_ar") ?? "").trim() || null,
    description_en: String(formData.get("description_en") ?? "").trim() || null,
    lesson_id: String(formData.get("lesson_id") ?? "").trim() || null,
    time_limit_minutes: Number(formData.get("time_limit_minutes") ?? 0) || null,
    passing_score_pct: Math.max(0, Math.min(100, Number(formData.get("passing_score_pct") ?? 70) || 70)),
    available_at: String(formData.get("available_at") ?? "").trim() || null,
    due_at: String(formData.get("due_at") ?? "").trim() || null,
    is_published: formData.get("is_published") === "on",
    created_by: auth.userId,
  };

  const supabase = await createClient();
  const { data, error } = await supabase.from("quizzes").insert(insert).select("id").single<{ id: string }>();
  if (error) {
    logError("createQuiz failed", error, { tag: "quizzes", courseId });
    return { ok: false, error: error.message };
  }
  revalidatePath(`/teacher/courses/${courseId}/quizzes`);
  revalidatePath("/student/quizzes");
  return { ok: true, id: data!.id };
}

export async function updateQuiz(quizId: string, formData: FormData): Promise<ActionResult> {
  const auth = await authQuizOwner(quizId);
  if (!auth.ok) return auth;

  const title_ar = String(formData.get("title_ar") ?? "").trim();
  if (!title_ar) return { ok: false, error: "العنوان بالعربية مطلوب" };

  const update: TableUpdate<"quizzes"> = {
    title_ar,
    title_en: String(formData.get("title_en") ?? "").trim() || null,
    description_ar: String(formData.get("description_ar") ?? "").trim() || null,
    description_en: String(formData.get("description_en") ?? "").trim() || null,
    lesson_id: String(formData.get("lesson_id") ?? "").trim() || null,
    time_limit_minutes: Number(formData.get("time_limit_minutes") ?? 0) || null,
    passing_score_pct: Math.max(0, Math.min(100, Number(formData.get("passing_score_pct") ?? 70) || 70)),
    available_at: String(formData.get("available_at") ?? "").trim() || null,
    due_at: String(formData.get("due_at") ?? "").trim() || null,
    is_published: formData.get("is_published") === "on",
  };

  const supabase = await createClient();
  const { error } = await supabase.from("quizzes").update(update).eq("id", quizId);
  if (error) {
    logError("updateQuiz failed", error, { tag: "quizzes", quizId });
    return { ok: false, error: error.message };
  }
  revalidatePath(`/teacher/courses/${auth.courseId}/quizzes`);
  return { ok: true, id: quizId };
}

export async function deleteQuiz(quizId: string): Promise<ActionResult> {
  const auth = await authQuizOwner(quizId);
  if (!auth.ok) return auth;
  const supabase = await createClient();
  const { error } = await supabase.from("quizzes").delete().eq("id", quizId);
  if (error) return { ok: false, error: error.message };
  revalidatePath(`/teacher/courses/${auth.courseId}/quizzes`);
  return { ok: true };
}

// Question CRUD --------------------------------------------------------------

export async function addQuestion(quizId: string, formData: FormData): Promise<ActionResult> {
  const auth = await authQuizOwner(quizId);
  if (!auth.ok) return auth;

  const question_ar = String(formData.get("question_ar") ?? "").trim();
  if (!question_ar) return { ok: false, error: "نص السؤال مطلوب" };

  const question_type = String(formData.get("question_type") ?? "mcq") as QuestionType;
  if (!["mcq", "fill_in", "true_false"].includes(question_type)) {
    return { ok: false, error: "نوع غير صالح" };
  }

  // Parse options + correct answer based on question type.
  let options: MCQOption[] | null = null;
  let correct_answer: unknown = null;
  if (question_type === "mcq") {
    const optionLabels = String(formData.get("options") ?? "").split("\n")
      .map((s) => s.trim()).filter(Boolean);
    if (optionLabels.length < 2) return { ok: false, error: "يجب على الأقل خياران" };
    options = optionLabels.map((label, i) => ({
      id: `opt_${i}_${Date.now()}`,
      text_ar: label,
    }));
    const correctIdx = Number(formData.get("correct_index") ?? -1);
    if (!Number.isInteger(correctIdx) || correctIdx < 0 || correctIdx >= options.length) {
      return { ok: false, error: "يجب اختيار الإجابة الصحيحة" };
    }
    correct_answer = { mcq: options[correctIdx].id };
  } else if (question_type === "fill_in") {
    const accepted = String(formData.get("acceptable_answers") ?? "").split(",")
      .map((s) => s.trim().toLowerCase()).filter(Boolean);
    if (accepted.length === 0) return { ok: false, error: "أدخل إجابة مقبولة واحدة على الأقل" };
    correct_answer = { fill_in: accepted };
  } else {
    correct_answer = { true_false: formData.get("tf_correct") === "true" };
  }

  const insert: TableInsert<"quiz_questions"> = {
    quiz_id: quizId,
    question_ar,
    question_en: String(formData.get("question_en") ?? "").trim() || null,
    question_type,
    options: options as never,
    points: Math.max(0, Number(formData.get("points") ?? 1) || 1),
    sort_order: Number(formData.get("sort_order") ?? 0) || 0,
  };

  const supabase = await createClient();
  const { data, error } = await supabase.from("quiz_questions").insert(insert).select("id").single<{ id: string }>();
  if (error) {
    logError("addQuestion failed", error, { tag: "quizzes", quizId });
    return { ok: false, error: error.message };
  }

  // Answer key lives in a separate table students cannot read (audit C1).
  const { error: keyErr } = await supabase
    .from("quiz_question_keys")
    .insert({ question_id: data!.id, correct_answer: correct_answer as never } satisfies TableInsert<"quiz_question_keys">);
  if (keyErr) {
    // Roll back the orphan question so we never leave a question with no key
    // (grading would silently mark it unanswerable for every student).
    await supabase.from("quiz_questions").delete().eq("id", data!.id);
    logError("addQuestion key insert failed", keyErr, { tag: "quizzes", quizId });
    return { ok: false, error: keyErr.message };
  }

  revalidatePath(`/teacher/courses/${auth.courseId}/quizzes/${quizId}/edit`);
  return { ok: true, id: data!.id };
}

export async function deleteQuestion(questionId: string): Promise<ActionResult> {
  const supabase = await createClient();
  const { data: q } = await supabase.from("quiz_questions").select("quiz_id").eq("id", questionId)
    .single<{ quiz_id: string }>();
  if (!q) return { ok: false, error: "السؤال غير موجود" };
  const auth = await authQuizOwner(q.quiz_id);
  if (!auth.ok) return auth;

  const { error } = await supabase.from("quiz_questions").delete().eq("id", questionId);
  if (error) return { ok: false, error: error.message };
  revalidatePath(`/teacher/courses/${auth.courseId}/quizzes/${q.quiz_id}/edit`);
  return { ok: true };
}

// Attempts -------------------------------------------------------------------

export async function startQuizAttempt(quizId: string): Promise<ActionResult> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "غير مسجل الدخول" };

  // Resume in-progress attempt instead of creating a duplicate.
  const { data: existing } = await supabase.from("quiz_attempts")
    .select("id").eq("quiz_id", quizId).eq("student_id", user.id)
    .is("submitted_at", null).maybeSingle<{ id: string }>();
  if (existing) return { ok: true, id: existing.id };

  const { data, error } = await supabase.from("quiz_attempts")
    .insert({ quiz_id: quizId, student_id: user.id } satisfies TableInsert<"quiz_attempts">)
    .select("id").single<{ id: string }>();
  if (error) return { ok: false, error: error.message };
  return { ok: true, id: data!.id };
}

export async function submitQuizAttempt(
  attemptId: string,
  answers: Record<string, unknown>,
): Promise<ActionResult & { score_pct?: number; passed?: boolean }> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "غير مسجل الدخول" };

  const { data: attempt } = await supabase.from("quiz_attempts")
    .select("id, quiz_id, student_id, started_at, submitted_at")
    .eq("id", attemptId)
    .single<{ id: string; quiz_id: string; student_id: string; started_at: string; submitted_at: string | null }>();
  if (!attempt) return { ok: false, error: "المحاولة غير موجودة" };
  if (attempt.student_id !== user.id) return { ok: false, error: "غير مصرح" };
  if (attempt.submitted_at) return { ok: false, error: "تم التسليم بالفعل" };

  // Auto-grade. Answer keys live in quiz_question_keys, which students cannot
  // read (audit C1). Read them via the service-role admin client, which bypasses
  // RLS — grading is server-side and the student never sees the key.
  const { data: questions } = await supabase.from("quiz_questions")
    .select("id, question_type, options, points")
    .eq("quiz_id", attempt.quiz_id)
    .returns<{
      id: string; question_type: string;
      options: { id: string }[] | null;
      points: number;
    }[]>();

  const admin = createAdminClient();
  const { data: keys, error: keysErr } = await admin.from("quiz_question_keys")
    .select("question_id, correct_answer")
    .in("question_id", (questions ?? []).map((q) => q.id))
    .returns<{ question_id: string; correct_answer: { mcq?: string; fill_in?: string[]; true_false?: boolean } }[]>();
  if (keysErr) {
    logError("submitQuizAttempt key read failed", keysErr, { tag: "quizzes", attemptId });
    return { ok: false, error: "تعذّر تصحيح الاختبار" };
  }
  const keyById = new Map((keys ?? []).map((k) => [k.question_id, k.correct_answer]));

  let earned = 0;
  let total = 0;
  for (const q of questions ?? []) {
    total += q.points;
    const ans = answers[q.id];
    const key = keyById.get(q.id);
    if (!key) continue;
    if (q.question_type === "mcq") {
      if (typeof ans === "string" && ans === key.mcq) earned += q.points;
    } else if (q.question_type === "fill_in") {
      if (typeof ans === "string") {
        const norm = ans.trim().toLowerCase();
        if ((key.fill_in ?? []).includes(norm)) earned += q.points;
      }
    } else if (q.question_type === "true_false") {
      if (typeof ans === "boolean" && ans === key.true_false) earned += q.points;
    }
  }
  const score_pct = total > 0 ? Math.round((earned / total) * 100) : 0;

  const { data: quizRow } = await supabase.from("quizzes")
    .select("passing_score_pct, course_id").eq("id", attempt.quiz_id)
    .single<{ passing_score_pct: number; course_id: string }>();
  const passed = score_pct >= (quizRow?.passing_score_pct ?? 70);

  const submitted_at = new Date().toISOString();
  const duration_seconds = Math.max(
    0,
    Math.floor((Date.now() - new Date(attempt.started_at).getTime()) / 1000),
  );

  const { error } = await supabase.from("quiz_attempts").update({
    submitted_at,
    // `answers` arrives as a free-shape JSON object from the student form;
    // the column type is `Json` but the gen-types model it as `never` for
    // updates. Cast retained per ADR-0002 jsonb-retention category.
    answers: answers as never,
    score_pct,
    passed,
    duration_seconds,
  } satisfies TableUpdate<"quiz_attempts">).eq("id", attemptId);
  if (error) return { ok: false, error: error.message };

  revalidatePath("/student/quizzes");
  if (quizRow) revalidatePath(`/teacher/courses/${quizRow.course_id}/quizzes`);
  return { ok: true, id: attemptId, score_pct, passed };
}
