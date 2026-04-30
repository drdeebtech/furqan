import type { Metadata } from "next";
import { notFound } from "next/navigation";
import Link from "next/link";
import { GraduationCap, PlayCircle, Lock, Star, Clock } from "lucide-react";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { getT } from "@/lib/i18n/server";
import type { Course, CourseLesson, CourseReview } from "@/types/database";
import { EnrollButton } from "./enroll-button";

interface PageProps {
  params: Promise<{ slug: string }>;
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { slug } = await params;
  const supabase = createAdminClient();
  const { data: course } = await supabase
    .from("courses")
    .select("title_ar, title_en, description_ar")
    .eq("slug", slug)
    .eq("status", "published")
    .single<Pick<Course, "title_ar" | "title_en" | "description_ar">>();
  if (!course) return { title: "دورة" };
  return {
    title: course.title_en ?? course.title_ar,
    description: (course.description_ar ?? "").slice(0, 160),
  };
}

export default async function CourseLandingPage({ params }: PageProps) {
  const { slug } = await params;
  const { t, dir, lang } = await getT();
  const adminSupabase = createAdminClient();

  const { data: course } = await adminSupabase
    .from("courses")
    .select("*")
    .eq("slug", slug)
    .eq("status", "published")
    .single<Course>();
  if (!course) notFound();

  const [{ data: teacher }, { data: lessons }, { data: reviews }] = await Promise.all([
    adminSupabase
      .from("profiles")
      .select("id, full_name, avatar_url")
      .eq("id", course.teacher_id)
      .single<{ id: string; full_name: string | null; avatar_url: string | null }>(),
    adminSupabase
      .from("course_lessons")
      .select("id, order_index, title_ar, title_en, duration_seconds, is_preview, video_status")
      .eq("course_id", course.id)
      .order("order_index", { ascending: true })
      .returns<
        Pick<CourseLesson, "id" | "order_index" | "title_ar" | "title_en" | "duration_seconds" | "is_preview" | "video_status">[]
      >(),
    adminSupabase
      .from("course_reviews")
      .select("id, stars, comment, student_id, created_at")
      .eq("course_id", course.id)
      .eq("status", "published")
      .order("created_at", { ascending: false })
      .limit(5)
      .returns<Pick<CourseReview, "id" | "stars" | "comment" | "student_id" | "created_at">[]>(),
  ]);

  // Check enrollment status if user is logged in
  const userSupabase = await createClient();
  const {
    data: { user },
  } = await userSupabase.auth.getUser();
  let isEnrolled = false;
  if (user) {
    const { data: enrollment } = await userSupabase
      .from("course_enrollments")
      .select("id")
      .eq("course_id", course.id)
      .eq("student_id", user.id)
      .maybeSingle();
    isEnrolled = !!enrollment;
  }

  const totalDuration = lessons?.reduce((s, l) => s + (l.duration_seconds ?? 0), 0) ?? 0;
  const hours = Math.floor(totalDuration / 3600);
  const minutes = Math.floor((totalDuration % 3600) / 60);

  return (
    <div dir={dir} className="mx-auto max-w-5xl px-4 py-10">
      <div className="grid gap-6 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <header className="mb-6">
            <h1 className="text-2xl font-bold leading-tight md:text-3xl">{course.title_ar}</h1>
            {course.title_en && <p className="mt-1 text-sm text-muted">{course.title_en}</p>}
            <div className="mt-3 flex flex-wrap items-center gap-3 text-xs">
              {teacher && (
                <Link
                  href={`/teachers/${teacher.id}`}
                  className="flex items-center gap-2 hover:text-gold"
                >
                  {teacher.avatar_url ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={teacher.avatar_url}
                      alt=""
                      className="h-6 w-6 rounded-full object-cover"
                    />
                  ) : (
                    <GraduationCap size={14} />
                  )}
                  <span>{teacher.full_name}</span>
                </Link>
              )}
              <span className="text-muted">·</span>
              {course.rating_count_cached && course.rating_count_cached > 0 ? (
                <span className="flex items-center gap-1 text-warning">
                  <Star size={12} fill="currentColor" />
                  {course.rating_avg_cached?.toFixed(1)} ({course.rating_count_cached})
                </span>
              ) : (
                <span className="text-muted">{t("لا توجد تقييمات بعد", "No ratings yet")}</span>
              )}
              <span className="text-muted">·</span>
              <span className="text-muted">
                {course.enrollment_count_cached ?? 0} {t("ملتحق", "enrolled")}
              </span>
            </div>
          </header>

          {course.description_ar && (
            <section className="mb-8">
              <h2 className="mb-3 text-lg font-semibold">{t("عن الدورة", "About this course")}</h2>
              <p className="whitespace-pre-line text-sm leading-relaxed text-foreground/90">
                {course.description_ar}
              </p>
            </section>
          )}

          <section className="mb-8">
            <h2 className="mb-3 text-lg font-semibold">
              {t("محتوى الدورة", "Course content")} · {lessons?.length ?? 0} {t("درس", "lessons")}
              {totalDuration > 0 && (
                <span className="text-sm text-muted">
                  {" "}
                  · {hours > 0 ? `${hours}h ` : ""}{minutes}m
                </span>
              )}
            </h2>
            {lessons && lessons.length > 0 ? (
              <ul className="divide-y rounded-lg border bg-white/30 dark:bg-white/5">
                {lessons.map((l) => {
                  const accessible = isEnrolled || l.is_preview;
                  return (
                    <li key={l.id} className="flex items-center gap-3 p-3">
                      {accessible ? (
                        <PlayCircle size={18} className="text-gold" />
                      ) : (
                        <Lock size={16} className="text-muted/60" />
                      )}
                      <div className="min-w-0 flex-1">
                        <span className="text-sm font-medium">
                          {l.order_index}. {lang === "ar" ? l.title_ar : (l.title_en ?? l.title_ar)}
                        </span>
                        {l.is_preview && (
                          <span className="ms-2 rounded-full border border-success/30 bg-success/10 px-2 py-0.5 text-xs font-medium text-success">
                            {t("معاينة مجانية", "Free preview")}
                          </span>
                        )}
                      </div>
                      {l.duration_seconds ? (
                        <span className="flex items-center gap-1 text-xs text-muted">
                          <Clock size={11} />
                          {Math.floor(l.duration_seconds / 60)}:
                          {String(l.duration_seconds % 60).padStart(2, "0")}
                        </span>
                      ) : null}
                    </li>
                  );
                })}
              </ul>
            ) : (
              <p className="text-sm text-muted">{t("لا دروس بعد", "No lessons yet")}</p>
            )}
          </section>

          {reviews && reviews.length > 0 && (
            <section className="mb-8">
              <h2 className="mb-3 text-lg font-semibold">{t("التقييمات", "Reviews")}</h2>
              <div className="space-y-3">
                {reviews.map((r) => (
                  <div key={r.id} className="rounded-lg border bg-white/30 p-4 dark:bg-white/5">
                    <div className="mb-1 flex items-center gap-1 text-warning">
                      {Array.from({ length: r.stars }).map((_, i) => (
                        <Star key={i} size={12} fill="currentColor" />
                      ))}
                    </div>
                    {r.comment && <p className="text-sm">{r.comment}</p>}
                  </div>
                ))}
              </div>
            </section>
          )}
        </div>

        {/* Sidebar — pricing + enroll */}
        <aside className="lg:col-span-1">
          <div className="glass-card sticky top-24 p-6">
            {course.pricing_type === "free" ? (
              <div className="mb-4">
                <span className="text-3xl font-bold text-success">
                  {t("مجاني", "Free")}
                </span>
              </div>
            ) : (
              <div className="mb-4">
                <span className="text-3xl font-bold text-gold">
                  {(course.price_cents / 100).toFixed(2)}
                </span>
                <span className="ms-1 text-sm text-muted">{course.currency}</span>
              </div>
            )}
            <EnrollButton
              courseId={course.id}
              isFree={course.pricing_type === "free"}
              isEnrolled={isEnrolled}
              isLoggedIn={!!user}
              labels={{
                enroll: t("اشترك مجاناً", "Enroll for free"),
                buy: t("اشتر الآن", "Buy now"),
                go: t("افتح الدورة", "Open course"),
                login: t("سجّل دخول للاشتراك", "Sign in to enroll"),
                soon: t("الدفع قيد التحضير — قريباً", "Payments launching soon"),
              }}
            />
            <ul className="mt-5 space-y-2 text-xs text-muted">
              <li>· {course.lesson_count_cached ?? 0} {t("درس", "lessons")}</li>
              {totalDuration > 0 && (
                <li>· {hours > 0 ? `${hours}h ` : ""}{minutes}m {t("محتوى", "content")}</li>
              )}
              <li>· {t("وصول مدى الحياة", "Lifetime access")}</li>
              <li>· {t("على الجوّال والكمبيوتر", "Mobile + desktop")}</li>
            </ul>
          </div>
        </aside>
      </div>
    </div>
  );
}
