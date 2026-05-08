"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { logError } from "@/lib/logger";
import type { TableInsert, TableUpdate } from "@/lib/supabase/typed-helpers";

interface ModuleResult {
  ok: boolean;
  error?: string;
  id?: string;
}

// Verify the caller is the course owner OR admin/moderator.
async function authorizeCourseOwner(courseId: string): Promise<{ ok: true } | { ok: false; error: string }> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "غير مسجل الدخول" };

  const { data: course } = await supabase
    .from("courses")
    .select("teacher_id")
    .eq("id", courseId)
    .single<{ teacher_id: string | null }>();
  if (!course) return { ok: false, error: "الدورة غير موجودة" };
  if (course.teacher_id === user.id) return { ok: true };

  const { data: profile } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .single<{ role: string }>();
  if (profile?.role === "admin") return { ok: true };
  return { ok: false, error: "غير مصرح" };
}

// ─── createModule ───────────────────────────────────────────────────────────

export async function createModule(
  courseId: string,
  formData: FormData,
): Promise<ModuleResult> {
  const auth = await authorizeCourseOwner(courseId);
  if (!auth.ok) return auth;

  const title_ar = String(formData.get("title_ar") ?? "").trim();
  const title_en = String(formData.get("title_en") ?? "").trim() || null;
  const description_ar = String(formData.get("description_ar") ?? "").trim() || null;
  const description_en = String(formData.get("description_en") ?? "").trim() || null;
  const is_linear = formData.get("is_linear") === "on";
  const sort_order = Number(formData.get("sort_order") ?? 0) || 0;

  if (!title_ar) return { ok: false, error: "العنوان بالعربية مطلوب" };

  const supabase = await createClient();
  const insert: TableInsert<"modules"> = {
    course_id: courseId,
    title_ar, title_en,
    description_ar, description_en,
    is_linear, sort_order,
  };

  const { data, error } = await supabase
    .from("modules")
    .insert(insert)
    .select("id")
    .single<{ id: string }>();
  if (error) {
    logError("createModule failed", error, { tag: "modules", courseId });
    return { ok: false, error: error.message };
  }

  revalidatePath(`/teacher/courses/${courseId}`);
  revalidatePath(`/teacher/courses/${courseId}/modules`);
  revalidatePath(`/student/courses/${courseId}`);
  return { ok: true, id: data!.id };
}

// ─── updateModule ───────────────────────────────────────────────────────────

export async function updateModule(
  moduleId: string,
  formData: FormData,
): Promise<ModuleResult> {
  const supabase = await createClient();
  const { data: row } = await supabase
    .from("modules")
    .select("course_id")
    .eq("id", moduleId)
    .single<{ course_id: string }>();
  if (!row) return { ok: false, error: "الوحدة غير موجودة" };

  const auth = await authorizeCourseOwner(row.course_id);
  if (!auth.ok) return auth;

  const title_ar = String(formData.get("title_ar") ?? "").trim();
  if (!title_ar) return { ok: false, error: "العنوان بالعربية مطلوب" };

  const update: TableUpdate<"modules"> = {
    title_ar,
    title_en: String(formData.get("title_en") ?? "").trim() || null,
    description_ar: String(formData.get("description_ar") ?? "").trim() || null,
    description_en: String(formData.get("description_en") ?? "").trim() || null,
    is_linear: formData.get("is_linear") === "on",
    sort_order: Number(formData.get("sort_order") ?? 0) || 0,
  };

  const { error } = await supabase.from("modules").update(update).eq("id", moduleId);
  if (error) {
    logError("updateModule failed", error, { tag: "modules", moduleId });
    return { ok: false, error: error.message };
  }
  revalidatePath(`/teacher/courses/${row.course_id}/modules`);
  revalidatePath(`/student/courses/${row.course_id}`);
  return { ok: true, id: moduleId };
}

// ─── deleteModule ───────────────────────────────────────────────────────────

export async function deleteModule(moduleId: string): Promise<ModuleResult> {
  const supabase = await createClient();
  const { data: row } = await supabase
    .from("modules")
    .select("course_id")
    .eq("id", moduleId)
    .single<{ course_id: string }>();
  if (!row) return { ok: false, error: "الوحدة غير موجودة" };

  const auth = await authorizeCourseOwner(row.course_id);
  if (!auth.ok) return auth;

  const { error } = await supabase.from("modules").delete().eq("id", moduleId);
  if (error) {
    logError("deleteModule failed", error, { tag: "modules", moduleId });
    return { ok: false, error: error.message };
  }
  revalidatePath(`/teacher/courses/${row.course_id}/modules`);
  revalidatePath(`/student/courses/${row.course_id}`);
  return { ok: true };
}

// ─── assignLesson ───────────────────────────────────────────────────────────
// Move a lesson into a module. Removes it from any other module first
// (lesson_id is unique in module_lessons).

export async function assignLesson(
  moduleId: string,
  lessonId: string,
  sort_order = 0,
): Promise<ModuleResult> {
  const supabase = await createClient();
  const { data: m } = await supabase
    .from("modules")
    .select("course_id")
    .eq("id", moduleId)
    .single<{ course_id: string }>();
  if (!m) return { ok: false, error: "الوحدة غير موجودة" };

  const auth = await authorizeCourseOwner(m.course_id);
  if (!auth.ok) return auth;

  // Remove any prior assignment first.
  await supabase.from("module_lessons").delete().eq("lesson_id", lessonId);

  const { error } = await supabase
    .from("module_lessons")
    .insert({ module_id: moduleId, lesson_id: lessonId, sort_order } satisfies TableInsert<"module_lessons">);
  if (error) {
    logError("assignLesson failed", error, { tag: "modules", moduleId, lessonId });
    return { ok: false, error: error.message };
  }
  revalidatePath(`/teacher/courses/${m.course_id}/modules`);
  revalidatePath(`/student/courses/${m.course_id}`);
  return { ok: true };
}

// ─── unassignLesson ─────────────────────────────────────────────────────────

export async function unassignLesson(lessonId: string): Promise<ModuleResult> {
  const supabase = await createClient();
  const { data: lesson } = await supabase
    .from("course_lessons")
    .select("course_id")
    .eq("id", lessonId)
    .single<{ course_id: string }>();
  if (!lesson) return { ok: false, error: "الدرس غير موجود" };

  const auth = await authorizeCourseOwner(lesson.course_id);
  if (!auth.ok) return auth;

  const { error } = await supabase.from("module_lessons").delete().eq("lesson_id", lessonId);
  if (error) {
    logError("unassignLesson failed", error, { tag: "modules", lessonId });
    return { ok: false, error: error.message };
  }
  revalidatePath(`/teacher/courses/${lesson.course_id}/modules`);
  revalidatePath(`/student/courses/${lesson.course_id}`);
  return { ok: true };
}

// ─── isLessonUnlocked ───────────────────────────────────────────────────────
// Server-side gate for linear modules. Returns true if:
//   - lesson is not in a module, OR
//   - lesson's module is_linear=false (thematic), OR
//   - all earlier lessons in the same linear module are completed by this student.
// Used by the lesson player to decide whether to show the video or a "complete X first" overlay.

export async function isLessonUnlocked(
  studentId: string,
  lessonId: string,
): Promise<boolean> {
  const supabase = await createClient();

  type Row = {
    sort_order: number;
    module: { id: string; is_linear: boolean; course_id: string } | null;
  };

  const { data } = await supabase
    .from("module_lessons")
    .select("sort_order, module:modules(id, is_linear, course_id)")
    .eq("lesson_id", lessonId)
    .single<Row>();

  if (!data?.module) return true; // not in a module → no gate
  if (!data.module.is_linear) return true; // thematic → no gate

  // Linear: find all module_lessons with lower sort_order, then check if
  // all of those are completed by this student.
  const { data: earlier } = await supabase
    .from("module_lessons")
    .select("lesson_id")
    .eq("module_id", data.module.id)
    .lt("sort_order", data.sort_order)
    .returns<{ lesson_id: string }[]>();

  if (!earlier || earlier.length === 0) return true; // first lesson in module

  const earlierIds = earlier.map((e) => e.lesson_id);

  // Check enrollment + progress for this student on these lessons.
  const { data: enrollment } = await supabase
    .from("course_enrollments")
    .select("id")
    .eq("course_id", data.module.course_id)
    .eq("student_id", studentId)
    .single<{ id: string }>();
  if (!enrollment) return false;

  const { data: progress } = await supabase
    .from("course_lesson_progress")
    .select("lesson_id, completed_at")
    .eq("enrollment_id", enrollment.id)
    .in("lesson_id", earlierIds)
    .returns<{ lesson_id: string; completed_at: string | null }[]>();

  const completed = new Set(
    (progress ?? []).filter((p) => p.completed_at).map((p) => p.lesson_id),
  );
  return earlierIds.every((id) => completed.has(id));
}
