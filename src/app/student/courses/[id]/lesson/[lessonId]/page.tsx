import { notFound, redirect } from "next/navigation";
import Link from "next/link";
import { ChevronRight, PlayCircle, CheckCircle2, Lock } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { getT } from "@/lib/i18n/server";
import { getLessonPlaybackUrl } from "@/lib/actions/course-playback";
import { isLessonUnlocked } from "@/lib/actions/modules";
import { isFeatureEnabled } from "@/lib/settings";
import { LessonPlayer } from "./lesson-player";
import { ReviewForm } from "@/components/courses/review-form";
import type { Course, CourseLesson, CourseLessonProgress, CourseReview } from "@/types/database";

interface PageProps {
  params: Promise<{ id: string; lessonId: string }>;
}

export default async function LessonPlaybackPage({ params }: PageProps) {
  const { id: courseId, lessonId } = await params;
  const { t, dir, lang } = await getT();
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: course } = await supabase
    .from("courses")
    .select("id, slug, title_ar, title_en, status, teacher_id")
    .eq("id", courseId)
    .single<Pick<Course, "id" | "slug" | "title_ar" | "title_en" | "status" | "teacher_id">>();
  if (!course) notFound();

  const { data: lessons } = await supabase
    .from("course_lessons")
    .select("id, order_index, title_ar, title_en, duration_seconds, is_preview, video_status")
    .eq("course_id", courseId)
    .order("order_index", { ascending: true })
    .returns<
      Pick<CourseLesson, "id" | "order_index" | "title_ar" | "title_en" | "duration_seconds" | "is_preview" | "video_status">[]
    >();
  if (!lessons || lessons.length === 0) notFound();

  const lesson = lessons.find((l) => l.id === lessonId);
  if (!lesson) notFound();

  // Check enrollment
  const { data: enrollment } = await supabase
    .from("course_enrollments")
    .select("id")
    .eq("course_id", courseId)
    .eq("student_id", user.id)
    .maybeSingle<{ id: string }>();

  const isOwner = course.teacher_id === user.id;
  if (!enrollment && !isOwner && !lesson.is_preview) {
    redirect(`/courses/${course.slug}`);
  }

  // Saved progress
  let initialPosition = 0;
  if (enrollment) {
    const { data: progress } = await supabase
      .from("course_lesson_progress")
      .select("last_position_seconds, completed_at")
      .eq("enrollment_id", enrollment.id)
      .eq("lesson_id", lessonId)
      .maybeSingle<Pick<CourseLessonProgress, "last_position_seconds" | "completed_at">>();
    initialPosition = progress?.last_position_seconds ?? 0;
  }

  // Linear-module unlock gate. When modules feature is on AND the lesson
  // belongs to a linear module AND prior lessons aren't completed,
  // playback is blocked. Course owner + admins skip the gate.
  let unlocked = true;
  if (!isOwner && (await isFeatureEnabled("modules_enabled"))) {
    unlocked = await isLessonUnlocked(user.id, lessonId);
  }

  // Mint signed URL only when unlocked.
  const playbackResult = unlocked
    ? await getLessonPlaybackUrl(lessonId)
    : { ok: false as const, error: t(
        "أكمل الدروس السابقة في هذه الوحدة لفتح هذا الدرس.",
        "Complete the earlier lessons in this module to unlock this one.",
      ) };

  // Per-lesson completion lookup
  let completedLessonIds = new Set<string>();
  let existingReview: Pick<CourseReview, "stars" | "comment"> | null = null;
  if (enrollment) {
    const { data: progressRows } = await supabase
      .from("course_lesson_progress")
      .select("lesson_id, completed_at")
      .eq("enrollment_id", enrollment.id)
      .not("completed_at", "is", null)
      .returns<{ lesson_id: string; completed_at: string }[]>();
    completedLessonIds = new Set((progressRows ?? []).map((p) => p.lesson_id));

    // Existing review (if any) — used to pre-fill the review form
    const { data: reviewRow } = await supabase
      .from("course_reviews")
      .select("stars, comment")
      .eq("course_id", courseId)
      .eq("student_id", user.id)
      .maybeSingle<Pick<CourseReview, "stars" | "comment">>();
    existingReview = reviewRow ?? null;
  }
  const reviewUnlocked = enrollment && completedLessonIds.size > 0;

  return (
    <div dir={dir} className="mx-auto max-w-6xl px-4 py-6">
      <div className="mb-3 flex items-center gap-2 text-sm text-muted">
        <Link href="/student/courses" className="hover:text-gold">
          {t("دوراتي", "My Courses")}
        </Link>
        <ChevronRight size={14} className={dir === "rtl" ? "rotate-180" : ""} />
        <span className="truncate">{course.title_ar}</span>
      </div>

      <div className="grid gap-6 lg:grid-cols-[1fr_320px]">
        <div>
          <h1 className="mb-4 text-lg font-semibold">
            {lesson.order_index}. {lang === "ar" ? lesson.title_ar : (lesson.title_en ?? lesson.title_ar)}
          </h1>

          {playbackResult.ok ? (
            <LessonPlayer
              lessonId={lesson.id}
              initialPositionSeconds={initialPosition}
              signedUrl={playbackResult.url}
              errorLabel={t("تعذر تشغيل الفيديو", "Playback error")}
              loadingLabel={t("جاري التحميل...", "Loading...")}
            />
          ) : (
            <div className="flex aspect-video w-full items-center justify-center rounded-lg border bg-muted/10 text-sm text-muted">
              {playbackResult.error}
            </div>
          )}
        </div>

        <aside>
          <h2 className="mb-3 text-sm font-semibold">
            {t("الدروس", "Lessons")} ({lessons.length})
          </h2>
          <ul className="space-y-1 rounded-lg border bg-white/30 p-2 dark:bg-white/5">
            {lessons.map((l) => {
              const active = l.id === lesson.id;
              const completed = completedLessonIds.has(l.id);
              const accessible = enrollment || isOwner || l.is_preview;
              return (
                <li key={l.id}>
                  {accessible ? (
                    <Link
                      href={`/student/courses/${courseId}/lesson/${l.id}`}
                      className={`flex items-center gap-2 rounded-md p-2 text-sm transition ${
                        active
                          ? "bg-gold/30 font-medium"
                          : "hover:bg-white/40 dark:hover:bg-white/10"
                      }`}
                    >
                      {completed ? (
                        <CheckCircle2 size={14} className="text-success" />
                      ) : (
                        <PlayCircle size={14} className="text-muted" />
                      )}
                      <span className="text-xs text-muted">#{l.order_index}</span>
                      <span className="truncate flex-1">
                        {lang === "ar" ? l.title_ar : (l.title_en ?? l.title_ar)}
                      </span>
                      {l.duration_seconds && (
                        <span className="text-xs text-muted">
                          {Math.floor(l.duration_seconds / 60)}:
                          {String(l.duration_seconds % 60).padStart(2, "0")}
                        </span>
                      )}
                    </Link>
                  ) : (
                    <div className="flex items-center gap-2 rounded-md p-2 text-sm text-muted/60">
                      <Lock size={14} />
                      <span className="text-xs">#{l.order_index}</span>
                      <span className="truncate flex-1">
                        {lang === "ar" ? l.title_ar : (l.title_en ?? l.title_ar)}
                      </span>
                    </div>
                  )}
                </li>
              );
            })}
          </ul>

          {reviewUnlocked && (
            <div className="mt-6 rounded-lg border bg-white/30 p-4 dark:bg-white/5">
              <ReviewForm
                courseId={courseId}
                existingStars={existingReview?.stars ?? null}
                existingComment={existingReview?.comment ?? null}
                labels={{
                  title: t("قيّم هذه الدورة", "Rate this course"),
                  placeholder: t("شاركنا تجربتك (اختياري)", "Share your experience (optional)"),
                  submit: t("إرسال التقييم", "Submit review"),
                  update: t("تحديث التقييم", "Update review"),
                  saved: t("تم الحفظ", "Saved"),
                }}
              />
            </div>
          )}
        </aside>
      </div>
    </div>
  );
}
