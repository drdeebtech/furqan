import type { Metadata } from "next";
import { redirect } from "next/navigation";
import Link from "next/link";
import { GraduationCap, Plus, Inbox } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { getT } from "@/lib/i18n/server";
import { isFeatureEnabled } from "@/lib/settings";
import type { Course } from "@/types/database";

export const metadata: Metadata = { title: "الدورات المسجلة" };

const STATUS_LABEL_AR: Record<string, string> = {
  draft: "مسودة",
  pending_review: "قيد المراجعة",
  published: "منشورة",
  archived: "مؤرشفة",
  rejected: "مرفوضة",
};

const STATUS_BADGE: Record<string, string> = {
  draft: "bg-muted/20 text-muted",
  pending_review: "bg-amber-500/20 text-amber-700",
  published: "bg-emerald-500/20 text-emerald-700",
  archived: "bg-muted/30 text-muted",
  rejected: "bg-red-500/20 text-red-700",
};

export default async function TeacherCoursesPage() {
  const enabled = await isFeatureEnabled("courses_enabled");

  const { t, dir } = await getT();
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: profile } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .single<{ role: string }>();
  if (
    !profile ||
    !["admin", "moderator", "teacher"].includes(profile.role)
  ) {
    redirect("/login");
  }

  const { data: courses } = await supabase
    .from("courses")
    .select(
      "id, slug, title_ar, title_en, status, pricing_type, price_cents, currency, lesson_count_cached, enrollment_count_cached, rating_avg_cached, rating_count_cached, created_at, updated_at",
    )
    .eq("teacher_id", user.id)
    .is("deleted_at", null)
    .order("updated_at", { ascending: false })
    .returns<
      Pick<
        Course,
        | "id"
        | "slug"
        | "title_ar"
        | "title_en"
        | "status"
        | "pricing_type"
        | "price_cents"
        | "currency"
        | "lesson_count_cached"
        | "enrollment_count_cached"
        | "rating_avg_cached"
        | "rating_count_cached"
        | "created_at"
        | "updated_at"
      >[]
    >();

  return (
    <div dir={dir} className="mx-auto max-w-5xl px-4 py-8">
      <div className="mb-6 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <GraduationCap size={24} className="text-gold" />
          <h1 className="text-xl font-bold">{t("الدورات المسجلة", "Recorded Courses")}</h1>
        </div>
        <Link
          href="/teacher/courses/new"
          className="flex items-center gap-2 rounded-lg bg-gold px-4 py-2 text-sm font-medium text-white transition hover:opacity-90"
        >
          <Plus size={16} />
          {t("دورة جديدة", "New course")}
        </Link>
      </div>

      {!enabled && (
        <div className="mb-6 rounded-lg border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900 dark:border-amber-700 dark:bg-amber-950 dark:text-amber-100">
          {t(
            "ميزة الدورات لا تزال في وضع التطوير. الدورات التي تنشئها الآن ستكون مرئية للطلاب فور تفعيل الميزة.",
            "The courses feature is still in development. Courses you create now will become visible to students once the feature is enabled.",
          )}
        </div>
      )}

      {!courses || courses.length === 0 ? (
        <div className="glass-card p-12 text-center">
          <Inbox size={40} className="mx-auto mb-3 text-muted/40" />
          <p className="text-muted">{t("لا توجد دورات بعد", "No courses yet")}</p>
          <p className="mt-1 text-sm text-muted/60">
            {t(
              "أنشئ دورتك الأولى وابدأ في تسجيل الدروس",
              "Create your first course and start recording lessons",
            )}
          </p>
        </div>
      ) : (
        <div className="grid gap-4">
          {courses.map((c) => (
            <Link
              key={c.id}
              href={`/teacher/courses/${c.id}`}
              className="glass-card flex items-start justify-between gap-4 p-5 transition hover:bg-white/40 dark:hover:bg-white/5"
            >
              <div className="flex-1">
                <div className="mb-1 flex items-center gap-2">
                  <h2 className="text-base font-semibold">{c.title_ar}</h2>
                  <span
                    className={`rounded-full px-2 py-0.5 text-xs ${STATUS_BADGE[c.status] ?? STATUS_BADGE.draft}`}
                  >
                    {STATUS_LABEL_AR[c.status] ?? c.status}
                  </span>
                </div>
                {c.title_en && (
                  <p className="text-xs text-muted/70">{c.title_en}</p>
                )}
                <div className="mt-2 flex flex-wrap gap-3 text-xs text-muted">
                  <span>
                    {c.lesson_count_cached ?? 0} {t("درس", "lessons")}
                  </span>
                  <span>
                    {c.enrollment_count_cached ?? 0} {t("ملتحق", "enrolled")}
                  </span>
                  {c.pricing_type === "free" ? (
                    <span className="text-emerald-600">{t("مجاني", "Free")}</span>
                  ) : (
                    <span className="text-gold">
                      {(c.price_cents / 100).toFixed(2)} {c.currency}
                    </span>
                  )}
                  {c.rating_count_cached && c.rating_count_cached > 0 ? (
                    <span>
                      ★ {c.rating_avg_cached?.toFixed(1)} ({c.rating_count_cached})
                    </span>
                  ) : null}
                </div>
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
