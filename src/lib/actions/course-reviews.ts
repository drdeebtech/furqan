"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { logError } from "@/lib/logger";
import { emitEvent } from "@/lib/automation/emit";

export type ReviewResult =
  | { ok: true }
  | { ok: false; error: string };

// ─── writeReview ────────────────────────────────────────────────────────────
// Student writes (or updates) their review of a course they're enrolled in.
// RLS already gates: student must own the enrollment row referenced.
// We additionally require ≥1 lesson completed before allowing — a soft
// quality gate so someone who just enrolled and bounced can't drop a 1-star.

export async function writeReview(formData: FormData): Promise<ReviewResult> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "غير مسجل الدخول" };

  const courseId = String(formData.get("course_id") ?? "");
  const stars = Number(formData.get("stars") ?? 0) | 0;
  const comment = (formData.get("comment") as string | null)?.trim() || null;

  if (!courseId) return { ok: false, error: "معرف الدورة مفقود" };
  if (stars < 1 || stars > 5) return { ok: false, error: "قيّم من 1 إلى 5 نجوم" };

  // Find the student's enrollment for this course
  const { data: enrollment } = await supabase
    .from("course_enrollments")
    .select("id")
    .eq("course_id", courseId)
    .eq("student_id", user.id)
    .single<{ id: string }>();

  if (!enrollment) {
    return { ok: false, error: "يجب الاشتراك بالدورة لتقييمها" };
  }

  // Soft gate: at least one lesson must be marked completed
  const { count: completedCount } = await supabase
    .from("course_lesson_progress")
    .select("id", { count: "exact", head: true })
    .eq("enrollment_id", enrollment.id)
    .not("completed_at", "is", null);

  if (!completedCount || completedCount < 1) {
    return {
      ok: false,
      error: "أكمل درساً واحداً على الأقل قبل التقييم",
    };
  }

  // Upsert: if review already exists, update it
  const { error } = await supabase
    .from("course_reviews")
    .upsert(
      {
        course_id: courseId,
        student_id: user.id,
        enrollment_id: enrollment.id,
        stars,
        comment,
        status: "published",
      } as never,
      { onConflict: "student_id,course_id" },
    );

  if (error) {
    logError("writeReview failed", error, {
      tag: "course-reviews",
      courseId,
      studentId: user.id,
    });
    return { ok: false, error: error.message };
  }

  await emitEvent("review.created", "course", courseId, {
    student_id: user.id,
    stars,
  }, user.id).catch((err) =>
    logError("emit review.created failed", err, { tag: "course-reviews", courseId }),
  );

  revalidatePath(`/courses`);
  revalidatePath(`/student/courses/${courseId}`);
  return { ok: true };
}

// ─── hideReview (admin/mod) ─────────────────────────────────────────────────

export async function hideReview(reviewId: string): Promise<ReviewResult> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "غير مسجل الدخول" };

  const { data: profile } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .single<{ role: string }>();
  if (!profile || !["admin"].includes(profile.role)) {
    return { ok: false, error: "غير مصرح" };
  }

  const { data, error } = await supabase
    .from("course_reviews")
    .update({ status: "hidden" } as never)
    .eq("id", reviewId)
    .select("course_id")
    .single<{ course_id: string }>();

  if (error) {
    logError("hideReview failed", error, { tag: "course-reviews", reviewId });
    return { ok: false, error: error.message };
  }

  if (data?.course_id) {
    revalidatePath(`/courses`);
  }
  return { ok: true };
}
