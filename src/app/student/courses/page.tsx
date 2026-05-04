import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { redirect } from "next/navigation";
import { GraduationCap, Inbox, PlayCircle } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { getT } from "@/lib/i18n/server";
import type { Course, CourseEnrollment } from "@/types/database";

export const metadata: Metadata = { title: "دوراتي" };

export default async function StudentCoursesPage() {
  const { t, dir } = await getT();
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: enrollments } = await supabase
    .from("course_enrollments")
    .select("id, course_id, enrolled_at, completed_at, last_accessed_at")
    .eq("student_id", user.id)
    .order("last_accessed_at", { ascending: false, nullsFirst: false })
    .returns<
      Pick<
        CourseEnrollment,
        "id" | "course_id" | "enrolled_at" | "completed_at" | "last_accessed_at"
      >[]
    >();

  const courseIds = (enrollments ?? []).map((e) => e.course_id);
  const courseMap: Record<string, Pick<Course, "id" | "slug" | "title_ar" | "title_en" | "cover_image_url" | "lesson_count_cached">> = {};
  if (courseIds.length > 0) {
    const { data: courses } = await supabase
      .from("courses")
      .select("id, slug, title_ar, title_en, cover_image_url, lesson_count_cached")
      .in("id", courseIds)
      .returns<
        Pick<Course, "id" | "slug" | "title_ar" | "title_en" | "cover_image_url" | "lesson_count_cached">[]
      >();
    for (const c of courses ?? []) courseMap[c.id] = c;
  }

  return (
    <div dir={dir} className="mx-auto max-w-5xl px-4 py-8">
      <div className="mb-6 flex items-center gap-3">
        <GraduationCap size={24} className="text-gold" />
        <h1 className="text-xl font-bold">{t("دوراتي", "My Courses")}</h1>
      </div>

      {!enrollments || enrollments.length === 0 ? (
        <div className="glass-card mx-auto max-w-2xl p-8 text-start">
          <div className="mb-4 flex items-start gap-3">
            <Inbox size={32} className="mt-1 text-muted/50 shrink-0" aria-hidden="true" />
            <div>
              <p className="text-base font-medium text-foreground">
                {t("لم تشترك في دورات بعد", "No enrollments yet")}
              </p>
              <p className="mt-2 text-sm leading-relaxed text-muted">
                {t(
                  "الدورات هنا مختلفة عن جلساتك المباشرة مع المعلم. كل دورة سلسلة دروس مسجلة تتقدم فيها بسرعتك الخاصة، يمكنك إعادتها متى شئت. الجلسات المباشرة مع معلمك تظهر في صفحة الجلسات.",
                  "Courses here are different from your live sessions with a teacher. Each course is a series of recorded lessons you can watch at your own pace and replay any time. Your live 1:1 sessions with your teacher live on the Sessions page.",
                )}
              </p>
            </div>
          </div>
          <div className="ms-11 flex flex-wrap items-center gap-3">
            <Link
              href="/courses"
              className="inline-flex items-center gap-1 rounded-full border border-gold/30 bg-gold/10 px-4 py-2 text-sm font-medium text-gold hover:bg-gold/15 focus-ring"
            >
              {t("تصفح الدورات", "Browse courses")}
            </Link>
            <Link
              href="/student/sessions"
              className="text-xs text-muted hover:text-foreground/80 focus-ring rounded"
            >
              {t("جلساتي مع المعلم ←", "My live sessions →")}
            </Link>
            <Link
              href="/student/recitations"
              className="text-xs text-muted hover:text-foreground/80 focus-ring rounded"
            >
              {t("تسميعاتي السابقة ←", "My past recitations →")}
            </Link>
          </div>
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {enrollments.map((e) => {
            const c = courseMap[e.course_id];
            if (!c) return null;
            return (
              <Link
                key={e.id}
                href={`/student/courses/${c.id}`}
                className="glass-card overflow-hidden transition hover:bg-white/40 dark:hover:bg-white/5"
              >
                {c.cover_image_url ? (
                  <div className="relative aspect-video w-full overflow-hidden">
                    <Image
                      src={c.cover_image_url}
                      alt={c.title_ar || t("غلاف الدورة", "Course cover")}
                      fill
                      sizes="(max-width: 640px) 100vw, (max-width: 1024px) 50vw, 33vw"
                      className="object-cover"
                    />
                  </div>
                ) : (
                  <div className="aspect-video w-full bg-gradient-to-br from-gold/30 to-gold/5" />
                )}
                <div className="p-4">
                  <h2 className="text-base font-semibold">{c.title_ar}</h2>
                  <div className="mt-2 flex items-center justify-between text-xs text-muted">
                    <span>{c.lesson_count_cached ?? 0} {t("درس", "lessons")}</span>
                    {e.completed_at ? (
                      <span className="text-success">{t("مكتملة", "Completed")}</span>
                    ) : e.last_accessed_at ? (
                      <span className="flex items-center gap-1 text-gold">
                        <PlayCircle size={12} />
                        {t("استكمل", "Continue")}
                      </span>
                    ) : (
                      <span>{t("ابدأ", "Start")}</span>
                    )}
                  </div>
                </div>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}
