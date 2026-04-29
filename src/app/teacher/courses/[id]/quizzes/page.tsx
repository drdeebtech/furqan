import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ArrowLeft, ArrowRight, Plus, Pencil } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { getT } from "@/lib/i18n/server";
import { isFeatureEnabled } from "@/lib/settings";

export const metadata: Metadata = { title: "اختبارات الدورة" };

interface Props {
  params: Promise<{ id: string }>;
}

export default async function CourseQuizzesPage({ params }: Props) {
  if (!(await isFeatureEnabled("quizzes_enabled"))) notFound();

  const { id: courseId } = await params;
  const { t, dir, lang } = await getT();
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: course } = await supabase.from("courses")
    .select("id, title_ar, title_en, teacher_id")
    .eq("id", courseId)
    .single<{ id: string; title_ar: string; title_en: string | null; teacher_id: string }>();
  if (!course) notFound();

  if (course.teacher_id !== user.id) {
    const { data: profile } = await supabase
      .from("profiles").select("role").eq("id", user.id).single<{ role: string }>();
    if (profile?.role !== "admin" && profile?.role !== "moderator") redirect("/teacher/courses");
  }

  const { data: quizzes } = await supabase.from("quizzes")
    .select("id, title_ar, title_en, time_limit_minutes, passing_score_pct, is_published, due_at")
    .eq("course_id", courseId)
    .order("created_at", { ascending: false })
    .returns<{ id: string; title_ar: string; title_en: string | null; time_limit_minutes: number | null; passing_score_pct: number; is_published: boolean; due_at: string | null }[]>();

  const Arrow = dir === "rtl" ? ArrowRight : ArrowLeft;
  const list = quizzes ?? [];

  return (
    <div dir={dir} className="mx-auto max-w-4xl px-4 py-8 sm:px-6">
      <Link href={`/teacher/courses/${courseId}`} className="mb-4 inline-flex items-center gap-1.5 text-sm text-muted hover:text-foreground">
        <Arrow size={14} aria-hidden="true" />
        {lang === "ar" ? course.title_ar : (course.title_en ?? course.title_ar)}
      </Link>

      <header className="mb-6 flex items-center justify-between">
        <h1 className="font-display text-xl font-bold sm:text-2xl">{t("الاختبارات", "Quizzes")}</h1>
        <Link
          href={`/teacher/courses/${courseId}/quizzes/new`}
          className="glass-gold glass-pill inline-flex items-center gap-2 px-4 py-2 text-sm font-semibold"
        >
          <Plus size={14} aria-hidden="true" /> {t("اختبار جديد", "New Quiz")}
        </Link>
      </header>

      {list.length === 0 ? (
        <div className="glass-card p-10 text-center text-muted">
          {t("لا توجد اختبارات بعد", "No quizzes yet")}
        </div>
      ) : (
        <ul className="glass-card divide-y divide-[var(--surface-divider,#F0F0F2)] overflow-hidden">
          {list.map((q) => (
            <li key={q.id} className="flex items-center justify-between gap-3 px-5 py-3">
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium">
                  {lang === "ar" ? q.title_ar : (q.title_en ?? q.title_ar)}
                </p>
                <p className="mt-0.5 text-[11px] text-muted">
                  {q.time_limit_minutes ? `${q.time_limit_minutes} ${t("دقيقة", "min")}` : t("بدون حد زمني", "untimed")}
                  {" · "}
                  {q.passing_score_pct}% {t("للنجاح", "pass")}
                  {q.due_at && <> · {t("الموعد:", "due:")} {new Date(q.due_at).toLocaleDateString(lang === "ar" ? "ar" : "en-US")}</>}
                </p>
              </div>
              <span className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${
                q.is_published
                  ? "border border-emerald-500/30 bg-emerald-500/10 text-emerald-400"
                  : "border border-[var(--surface-border)] text-muted"
              }`}>
                {q.is_published ? t("منشور", "Published") : t("مسودة", "Draft")}
              </span>
              <Link
                href={`/teacher/courses/${courseId}/quizzes/${q.id}/edit`}
                aria-label={t("تعديل", "Edit")}
                className="rounded p-1.5 text-muted hover:text-foreground"
              >
                <Pencil size={14} aria-hidden="true" />
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
