import type { Metadata } from "next";
import { redirect } from "next/navigation";
import Link from "next/link";
import { GraduationCap, Inbox } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { getT } from "@/lib/i18n/server";
import { isFeatureEnabled } from "@/lib/settings";
import { logWarn } from "@/lib/logger";
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
  pending_review: "bg-warning/20 text-warning",
  published: "bg-success/20 text-success",
  archived: "bg-muted/30 text-muted",
  rejected: "bg-error/20 text-error",
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
    !["admin", "teacher"].includes(profile.role)
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
      <div className="mb-6 flex items-center gap-3">
        <GraduationCap size={24} className="text-gold" aria-hidden="true" />
        <h1 className="text-xl font-bold">{t("الدورات المسجلة", "Recorded Courses")}</h1>
      </div>
      <p className="mb-6 max-w-2xl text-sm text-muted">
        {t(
          "تظهر هنا فقط الدورات المسندة إليك. تنشأ الدورات من قبل الإدارة وتنسبها إليك ليعود إليك جزء من إيرادها؛ يمكنك بعد ذلك إضافة الدروس وإرسال الدورة للمراجعة. الدورات التي تنشرها المنصة باسمها لا تظهر هنا.",
          "Only courses assigned to you appear here. Staff create courses and link them to you so you receive a share of their revenue; you can then add lessons and submit for review. Courses that the platform publishes under its own name do not appear here.",
        )}
      </p>

      {!enabled && (() => {
        // Surface a usage signal to the admin so the decision to flip the
        // courses_enabled flag is driven by real teacher interest, not by
        // guessing. Best-effort — never blocks the page render.
        logWarn("teacher viewed /teacher/courses while courses_enabled flag is off", {
          tag: "courses-flag", route: "/teacher/courses", userId: user.id,
        });
        return (
          <div className="mb-6 rounded-lg border border-card-border/60 bg-surface/40 p-4 text-sm text-muted">
            {t(
              "الميزة في إصدار تجريبي — الدورات التي تنشئها هنا محفوظة ومرئية لك، وستظهر للطلاب فور تفعيل الميزة من قبل الإدارة.",
              "Beta feature — courses you create here are saved and visible to you. They'll appear to students once an admin enables the feature.",
            )}
          </div>
        );
      })()}

      {!courses || courses.length === 0 ? (
        <div className="glass-card p-12 text-center">
          <Inbox size={40} className="mx-auto mb-3 text-muted/40" aria-hidden="true" />
          <p className="text-muted">{t("لا توجد دورات بعد", "No courses yet")}</p>
          <p className="mt-1 text-sm text-muted/60">
            {t(
              "ستظهر الدورات هنا بعد أن تنشئها الإدارة وتنسبها إليك.",
              "Courses will appear here once staff create them and assign them to you.",
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
                    <span className="text-success">{t("مجاني", "Free")}</span>
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
