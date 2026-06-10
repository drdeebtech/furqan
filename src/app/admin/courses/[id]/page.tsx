import { notFound, redirect } from "next/navigation";
import Link from "next/link";
import { ChevronRight, Check, X, Archive, PlayCircle } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { getT } from "@/lib/i18n/server";
import { approveCourse, rejectCourse, archiveCourse } from "@/lib/actions/courses";
import type { Course, CourseLesson } from "@/types/database";

interface PageProps {
  params: Promise<{ id: string }>;
}

const VIDEO_STATUS_LABEL: Record<string, { ar: string; en: string; cls: string }> = {
  pending: { ar: "بانتظار الرفع", en: "Pending", cls: "bg-muted/20 text-muted" },
  uploading: { ar: "جاري الرفع", en: "Uploading", cls: "bg-blue-500/20 text-blue-700" },
  processing: { ar: "قيد المعالجة", en: "Processing", cls: "bg-warning/20 text-warning" },
  ready: { ar: "جاهز", en: "Ready", cls: "bg-success/20 text-success" },
  failed: { ar: "فشل", en: "Failed", cls: "bg-error/20 text-error" },
};

export default async function AdminCourseReviewPage({ params }: PageProps) {
  const { id } = await params;
  const { t, dir, lang } = await getT();
  const supabase = await createClient();

  const { data: course } = await supabase
    .from("courses")
    .select("*")
    .eq("id", id)
    .single<Course>();
  if (!course) notFound();

  // Platform-owned courses have no teacher_id; skip the lookup entirely.
  const teacher = course.teacher_id
    ? (
        await supabase
          .from("profiles")
          // email lives on auth.users, not public.profiles — fetch via
          // admin.auth.admin.getUserById(course.teacher_id) if needed.
          // (Sentry E4-18.)
          .select("id, full_name")
          .eq("id", course.teacher_id)
          .single<{ id: string; full_name: string | null }>()
      ).data
    : null;

  const { data: lessons } = await supabase
    .from("course_lessons")
    .select("*")
    .eq("course_id", id)
    .order("order_index", { ascending: true })
    .returns<CourseLesson[]>();

  const reviewable = course.status === "pending_review";
  const archivable = course.status === "published";

  return (
    <div dir={dir} className="mx-auto max-w-4xl px-4 py-8">
      <div className="mb-4 flex items-center gap-2 text-sm text-muted">
        <Link href="/admin/courses" className="hover:text-gold">
          {t("مراجعة الدورات", "Course Review")}
        </Link>
        <ChevronRight size={14} className={dir === "rtl" ? "rotate-180" : ""} />
        <span className="truncate">{course.title_ar}</span>
      </div>

      <header className="glass-card mb-6 p-6">
        <h1 className="text-xl font-bold">{course.title_ar}</h1>
        {course.title_en && <p className="text-sm text-muted">{course.title_en}</p>}
        <div className="mt-3 flex flex-wrap gap-3 text-xs">
          {course.ownership === "platform" ? (
            <span className="rounded-full bg-gold/15 px-3 py-1 font-medium text-gold">
              {t("المالك: المنصة", "Owner: Platform")}
            </span>
          ) : (
            <span className="rounded-full bg-muted/20 px-3 py-1">
              {t("المعلم:", "Teacher:")} {teacher?.full_name ?? "—"} ·{" "}
              {(course.teacher_revenue_share_bps / 100).toFixed(0)}%
            </span>
          )}
          <span className="rounded-full bg-muted/20 px-3 py-1">
            {course.pricing_type === "free"
              ? t("مجاني", "Free")
              : `${(course.price_cents / 100).toFixed(2)} ${course.currency}`}
          </span>
          <span className="rounded-full bg-muted/20 px-3 py-1">
            {course.lesson_count_cached ?? lessons?.length ?? 0} {t("درس", "lessons")}
          </span>
          {course.specialty && (
            <span className="rounded-full bg-muted/20 px-3 py-1">{course.specialty}</span>
          )}
          {course.level && (
            <span className="rounded-full bg-muted/20 px-3 py-1">{course.level}</span>
          )}
        </div>
        {course.description_ar && (
          <p className="mt-4 whitespace-pre-line text-sm leading-relaxed">{course.description_ar}</p>
        )}
      </header>

      {/* Lesson list */}
      <section className="glass-card mb-6 p-6">
        <h2 className="mb-3 text-base font-semibold">
          {t("الدروس", "Lessons")} ({lessons?.length ?? 0})
        </h2>
        {!lessons || lessons.length === 0 ? (
          <p className="text-sm text-muted">{t("لا دروس", "No lessons")}</p>
        ) : (
          <ul className="space-y-2">
            {lessons.map((l) => {
              const badge = VIDEO_STATUS_LABEL[l.video_status] ?? VIDEO_STATUS_LABEL.pending;
              return (
                <li key={l.id} className="flex items-center gap-3 rounded-lg border bg-white/30 p-3 dark:bg-white/5">
                  <PlayCircle size={20} className="text-muted" />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="text-xs text-muted">#{l.order_index}</span>
                      <span className="truncate text-sm font-medium">{l.title_ar}</span>
                      {l.is_preview && (
                        <span className="rounded-full bg-success/20 px-2 py-0.5 text-xs text-success">
                          {t("معاينة", "Preview")}
                        </span>
                      )}
                    </div>
                    <div className="mt-1 flex items-center gap-3 text-xs text-muted">
                      <span className={`rounded-full px-2 py-0.5 ${badge.cls}`}>
                        {lang === "ar" ? badge.ar : badge.en}
                      </span>
                      {l.duration_seconds && (
                        <span>
                          {Math.floor(l.duration_seconds / 60)}:
                          {String(l.duration_seconds % 60).padStart(2, "0")}
                        </span>
                      )}
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      {/* Review actions */}
      {reviewable && (
        <section className="glass-card mb-6 p-6">
          <h3 className="mb-3 text-sm font-semibold">
            {t("إجراءات المراجعة", "Review actions")}
          </h3>
          <div className="grid gap-3 sm:grid-cols-2">
            <form
              action={async () => {
                "use server";
                await approveCourse(id);
              }}
            >
              <button
                type="submit"
                className="flex w-full items-center justify-center gap-2 rounded-lg bg-success px-4 py-2.5 text-sm font-medium text-white transition hover:bg-success/90"
              >
                <Check size={16} />
                {t("موافقة ونشر", "Approve & publish")}
              </button>
            </form>
            <form
              action={async (fd) => {
                "use server";
                const reason = String(fd.get("reason") ?? "").trim();
                if (reason) await rejectCourse({ courseId: id, reason });
              }}
              className="flex flex-col gap-2"
            >
              <textarea
                name="reason"
                required
                placeholder={t("سبب الرفض", "Rejection reason")}
                rows={2}
                className="rounded-lg border bg-white/40 px-3 py-2 text-sm dark:bg-white/5"
              />
              <button
                type="submit"
                className="flex items-center justify-center gap-2 rounded-lg bg-error px-4 py-2 text-sm font-medium text-white transition hover:bg-error"
              >
                <X size={16} />
                {t("رفض", "Reject")}
              </button>
            </form>
          </div>
        </section>
      )}

      {archivable && (
        <section className="text-center">
          <form
            action={async () => {
              "use server";
              await archiveCourse(id);
            }}
          >
            <button
              type="submit"
              className="inline-flex items-center gap-2 text-xs text-muted hover:text-foreground"
            >
              <Archive size={14} />
              {t("أرشفة الدورة (إخفاء من العرض العام)", "Archive course (hide from public)")}
            </button>
          </form>
        </section>
      )}
    </div>
  );
}
