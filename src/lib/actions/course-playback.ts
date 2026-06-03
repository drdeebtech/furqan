"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { logError } from "@/lib/logger";
import { emitEvent } from "@/lib/automation/emit";
import { getSignedPlaybackUrl, isBunnyConfigured } from "@/lib/bunny/client";
import type { TableInsert, TableUpdate } from "@/lib/supabase/typed-helpers";

// ─── getLessonPlaybackUrl ───────────────────────────────────────────────────
// Mints a 5-minute signed Bunny CDN URL for the given lesson, after
// verifying the caller is enrolled (or the lesson is a free preview, in
// which case anyone can watch).
//
// Returns { ok: true, url } or { ok: false, error }.

export async function getLessonPlaybackUrl(lessonId: string): Promise<
  | { ok: true; url: string }
  | { ok: false; error: string }
> {
  if (!isBunnyConfigured()) {
    return { ok: false, error: "خدمة الفيديو غير مهيأة" };
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  // Fetch lesson + parent course + (optional) enrollment for caller in one
  // round-trip via two parallel queries.
  const { data: lesson } = await supabase
    .from("course_lessons")
    .select("id, course_id, bunny_video_id, video_status, is_preview")
    .eq("id", lessonId)
    .single<{
      id: string;
      course_id: string;
      bunny_video_id: string | null;
      video_status: string;
      is_preview: boolean;
    }>();

  if (!lesson) return { ok: false, error: "الدرس غير موجود" };
  if (lesson.video_status !== "ready" || !lesson.bunny_video_id) {
    return { ok: false, error: "الدرس قيد المعالجة" };
  }

  const { data: course } = await supabase
    .from("courses")
    .select("status, teacher_id")
    .eq("id", lesson.course_id)
    .single<{ status: string; teacher_id: string | null }>();

  if (!course) return { ok: false, error: "الدورة غير موجودة" };

  // Access logic:
  //   - free preview lesson on a published course → anyone (incl. anon)
  //   - teacher who owns the course → always
  //   - admin/mod → always (verified in-action — RLS doesn't gate signed
  //     URL minting since we go straight to Bunny, not through Supabase)
  //   - enrolled student on a published course → yes
  let allowed = false;
  if (lesson.is_preview && course.status === "published") {
    allowed = true;
  }
  if (user && course.teacher_id && course.teacher_id === user.id) {
    allowed = true;
  }
  if (!allowed && user) {
    const { data: profile } = await supabase
      .from("profiles")
      .select("role")
      .eq("id", user.id)
      .single<{ role: string }>();
    if (profile?.role === "admin") {
      allowed = true;
    }
  }
  if (!allowed && user) {
    const { data: enrollment } = await supabase
      .from("course_enrollments")
      .select("id")
      .eq("course_id", lesson.course_id)
      .eq("student_id", user.id)
      .maybeSingle();
    if (enrollment && course.status === "published") allowed = true;
  }

  if (!allowed) {
    return { ok: false, error: "لا تملك صلاحية مشاهدة هذا الدرس" };
  }

  const url = getSignedPlaybackUrl(lesson.bunny_video_id, 300);
  return { ok: true, url };
}

// ─── upsertLessonProgress ───────────────────────────────────────────────────
// Save the student's playback position for a lesson (called every ~15s by
// the player). Auto-marks complete when watchedRatio ≥ 0.9.

export async function upsertLessonProgress(
  lessonId: string,
  positionSeconds: number,
  durationSeconds: number,
) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false as const, error: "غير مسجل الدخول" };

  // Find the enrollment for this user + lesson's course
  const { data: lesson } = await supabase
    .from("course_lessons")
    .select("course_id")
    .eq("id", lessonId)
    .single<{ course_id: string }>();
  if (!lesson) return { ok: false as const, error: "الدرس غير موجود" };

  const { data: enrollment } = await supabase
    .from("course_enrollments")
    .select("id")
    .eq("course_id", lesson.course_id)
    .eq("student_id", user.id)
    .single<{ id: string }>();
  if (!enrollment) return { ok: false as const, error: "غير ملتحق بالدورة" };

  const ratio = durationSeconds > 0 ? positionSeconds / durationSeconds : 0;
  const completed_at = ratio >= 0.9 ? new Date().toISOString() : null;

  const { error } = await supabase
    .from("course_lesson_progress")
    .upsert(
      {
        enrollment_id: enrollment.id,
        lesson_id: lessonId,
        last_position_seconds: Math.floor(positionSeconds),
        completed_at,
        watch_count: 1,
      } as never,
      { onConflict: "enrollment_id,lesson_id", ignoreDuplicates: false },
    );

  if (error) {
    logError("upsertLessonProgress failed", error, {
      tag: "course-playback",
      lessonId,
    });
    return { ok: false as const, error: error.message };
  }

  // Refresh enrollment.last_accessed_at, but at most once per 5 minutes per
  // enrollment. The player ticks every ~15s, so an unconditional UPDATE here is
  // ~250k+ writes/day at 50k learners (audit H10). The courses list only needs
  // coarse recency for its ordering, so gate the write on a staleness WHERE
  // clause — most ticks become a no-op match.
  const staleThreshold = new Date(Date.now() - 5 * 60 * 1000).toISOString();
  // The timestamp must be double-quoted inside the PostgREST or() filter — the
  // ISO `:`/`.` characters otherwise break value parsing (CodeRabbit).
  const { error: touchErr } = await supabase
    .from("course_enrollments")
    .update({ last_accessed_at: new Date().toISOString() } satisfies TableUpdate<"course_enrollments">)
    .eq("id", enrollment.id)
    .or(`last_accessed_at.is.null,last_accessed_at.lt."${staleThreshold}"`);
  if (touchErr) {
    logError("upsertLessonProgress last_accessed_at refresh failed", touchErr, {
      tag: "course-playback",
      lessonId,
    });
  }

  // If just completed, emit the event and revalidate the courses list — a
  // meaningful state change. Position-only ticks must NOT bust the courses
  // cache every 15s (audit H10); the position upsert above already persists
  // resume state, which the page re-reads on its next natural load.
  if (completed_at) {
    await emitEvent("lesson.completed", "course_lesson", lessonId, {
      enrollment_id: enrollment.id,
      student_id: user.id,
    }, user.id).catch((err) =>
      logError("emit lesson.completed failed", err, { tag: "course-playback" }),
    );
    revalidatePath(`/student/courses`);
  }

  return { ok: true as const, completed: !!completed_at };
}

// ─── markLessonComplete ─────────────────────────────────────────────────────
// Student-side "I'm done with this" action from the Continue Watching row
// menu. Stamps `completed_at = now()` on the progress row, regardless of how
// far they actually watched. Idempotent — re-calling on a completed lesson
// is a no-op.

export async function markLessonComplete(lessonId: string) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { ok: false as const, error: "غير مسجل الدخول" };

  const { data: lesson } = await supabase
    .from("course_lessons")
    .select("course_id")
    .eq("id", lessonId)
    .single<{ course_id: string }>();
  if (!lesson) return { ok: false as const, error: "الدرس غير موجود" };

  const { data: enrollment } = await supabase
    .from("course_enrollments")
    .select("id")
    .eq("course_id", lesson.course_id)
    .eq("student_id", user.id)
    .single<{ id: string }>();
  if (!enrollment) return { ok: false as const, error: "غير ملتحق بالدورة" };

  // Guard against double-emit: read existing completion state before upserting.
  // upsertLessonProgress already fires lesson.completed when the watch ratio
  // crosses 90% — re-calling this on an already-completed lesson must not
  // re-trigger n8n automations.
  const { data: existing } = await supabase
    .from("course_lesson_progress")
    .select("completed_at")
    .eq("enrollment_id", enrollment.id)
    .eq("lesson_id", lessonId)
    .maybeSingle<{ completed_at: string | null }>();
  const alreadyCompleted = !!existing?.completed_at;

  const now = new Date().toISOString();
  const { error } = await supabase
    .from("course_lesson_progress")
    .upsert(
      { enrollment_id: enrollment.id, lesson_id: lessonId, completed_at: now } satisfies TableInsert<"course_lesson_progress">,
      { onConflict: "enrollment_id,lesson_id", ignoreDuplicates: false },
    );

  if (error) {
    logError("markLessonComplete failed", error, { tag: "course-playback", lessonId });
    return { ok: false as const, error: error.message };
  }

  if (!alreadyCompleted) {
    await emitEvent("lesson.completed", "course_lesson", lessonId, {
      enrollment_id: enrollment.id,
      student_id: user.id,
      via: "manual",
    }, user.id).catch((err) =>
      logError("emit lesson.completed failed", err, { tag: "course-playback" }),
    );
  }

  revalidatePath("/student/dashboard");
  revalidatePath("/student/courses");
  return { ok: true as const };
}

// ─── setLessonHidden ────────────────────────────────────────────────────────
// Toggle `hidden_from_dashboard` for a student's progress row, so the lesson
// disappears from the Continue Watching widget. Lesson stays accessible from
// the course page; this only affects dashboard visibility.

export async function setLessonHidden(lessonId: string, hidden: boolean) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { ok: false as const, error: "غير مسجل الدخول" };

  const { data: lesson } = await supabase
    .from("course_lessons")
    .select("course_id")
    .eq("id", lessonId)
    .single<{ course_id: string }>();
  if (!lesson) return { ok: false as const, error: "الدرس غير موجود" };

  const { data: enrollment } = await supabase
    .from("course_enrollments")
    .select("id")
    .eq("course_id", lesson.course_id)
    .eq("student_id", user.id)
    .single<{ id: string }>();
  if (!enrollment) return { ok: false as const, error: "غير ملتحق بالدورة" };

  const { error } = await supabase
    .from("course_lesson_progress")
    .update({ hidden_from_dashboard: hidden } satisfies TableUpdate<"course_lesson_progress">)
    .eq("enrollment_id", enrollment.id)
    .eq("lesson_id", lessonId);

  if (error) {
    logError("setLessonHidden failed", error, { tag: "course-playback", lessonId });
    return { ok: false as const, error: error.message };
  }

  revalidatePath("/student/dashboard");
  return { ok: true as const };
}
