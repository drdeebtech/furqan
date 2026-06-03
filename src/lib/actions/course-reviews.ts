"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { logError } from "@/lib/logger";
import { emitEvent } from "@/lib/automation/emit";
import type { TableUpdate } from "@/lib/supabase/typed-helpers";
import { loudAction } from "@/lib/actions/loud";

class UserError extends Error {
  readonly userError = true;
  constructor(msg: string, options?: { cause?: unknown }) {
    super(msg, options);
    this.name = "UserError";
  }
}

// ─── writeReview ────────────────────────────────────────────────────────────
// Student writes (or updates) their review of a course they're enrolled in.
// RLS already gates: student must own the enrollment row referenced.
// We additionally require ≥1 lesson completed before allowing — a soft
// quality gate so someone who just enrolled and bounced can't drop a 1-star.

export const writeReview = loudAction<FormData, void>({
  name: "course-reviews.writeReview",
  handler: async (formData) => {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) throw new UserError("غير مسجل الدخول");

    const courseId = String(formData.get("course_id") ?? "");
    const stars = Number(formData.get("stars") ?? 0) | 0;
    const comment = (formData.get("comment") as string | null)?.trim() || null;

    if (!courseId) throw new UserError("معرف الدورة مفقود");
    if (stars < 1 || stars > 5) throw new UserError("قيّم من 1 إلى 5 نجوم");

    // Find the student's enrollment for this course
    const { data: enrollment } = await supabase
      .from("course_enrollments")
      .select("id")
      .eq("course_id", courseId)
      .eq("student_id", user.id)
      .single<{ id: string }>();

    if (!enrollment) {
      throw new UserError("يجب الاشتراك بالدورة لتقييمها");
    }

    // Soft gate: at least one lesson must be marked completed
    const { count: completedCount } = await supabase
      .from("course_lesson_progress")
      .select("id", { count: "exact", head: true })
      .eq("enrollment_id", enrollment.id)
      .not("completed_at", "is", null);

    if (!completedCount || completedCount < 1) {
      throw new UserError("أكمل درساً واحداً على الأقل قبل التقييم");
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

    if (error) throw new UserError("فشل حفظ التقييم", { cause: error });

    await emitEvent("review.created", "course", courseId, {
      student_id: user.id,
      stars,
    }, user.id).catch((err) =>
      logError("emit review.created failed", err, { tag: "course-reviews", courseId }),
    );

    revalidatePath(`/courses`);
    revalidatePath(`/student/courses/${courseId}`);
  },
});

// ─── hideReview (admin/mod) ─────────────────────────────────────────────────

export const hideReview = loudAction<string, void>({
  name: "course-reviews.hideReview",
  severity: "warning",
  handler: async (reviewId) => {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) throw new UserError("غير مسجل الدخول");

    const { data: profile } = await supabase
      .from("profiles")
      .select("role")
      .eq("id", user.id)
      .single<{ role: string }>();
    if (!profile || !["admin"].includes(profile.role)) {
      throw new UserError("غير مصرح");
    }

    const { data, error } = await supabase
      .from("course_reviews")
      .update({ status: "hidden" } satisfies TableUpdate<"course_reviews">)
      .eq("id", reviewId)
      .select("course_id")
      .single<{ course_id: string }>();

    if (error) throw new UserError("فشل إخفاء التقييم", { cause: error });

    if (data?.course_id) {
      revalidatePath(`/courses`);
    }
  },
});
