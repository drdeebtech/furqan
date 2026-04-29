import type { Metadata } from "next";
import Link from "next/link";
import { redirect, notFound } from "next/navigation";
import { Sparkles, CheckCircle2, AlertCircle } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { getT } from "@/lib/i18n/server";
import { isFeatureEnabled } from "@/lib/settings";

export const metadata: Metadata = { title: "اختباراتي" };

export default async function StudentQuizzesPage() {
  if (!(await isFeatureEnabled("quizzes_enabled"))) notFound();

  const { t, dir, lang } = await getT();
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  // Pull all enrollments → quizzes for those courses → joined attempts.
  const { data: enrollments } = await supabase.from("course_enrollments")
    .select("course_id")
    .eq("student_id", user.id)
    .returns<{ course_id: string }[]>();

  if (!enrollments || enrollments.length === 0) {
    return (
      <div dir={dir} className="mx-auto max-w-3xl px-4 py-12 text-center">
        <Sparkles size={32} className="mx-auto mb-3 text-gold" aria-hidden="true" />
        <h1 className="font-display text-2xl font-bold">{t("لا توجد اختبارات", "No quizzes yet")}</h1>
        <p className="mt-2 text-sm text-muted">
          {t("اشترك في دورة لتظهر اختباراتها هنا.", "Enroll in a course to see its quizzes here.")}
        </p>
      </div>
    );
  }

  const courseIds = enrollments.map((e) => e.course_id);

  const [quizzesRes, attemptsRes, coursesRes] = await Promise.all([
    supabase.from("quizzes")
      .select("id, course_id, title_ar, title_en, time_limit_minutes, passing_score_pct, due_at")
      .in("course_id", courseIds)
      .eq("is_published", true)
      .order("due_at", { ascending: true, nullsFirst: false })
      .returns<{ id: string; course_id: string; title_ar: string; title_en: string | null; time_limit_minutes: number | null; passing_score_pct: number; due_at: string | null }[]>(),
    supabase.from("quiz_attempts")
      .select("id, quiz_id, score_pct, passed, submitted_at")
      .eq("student_id", user.id)
      .order("submitted_at", { ascending: false })
      .returns<{ id: string; quiz_id: string; score_pct: number | null; passed: boolean | null; submitted_at: string | null }[]>(),
    supabase.from("courses")
      .select("id, title_ar, title_en")
      .in("id", courseIds)
      .returns<{ id: string; title_ar: string; title_en: string | null }[]>(),
  ]);

  const quizzes = quizzesRes.data ?? [];
  const attempts = attemptsRes.data ?? [];
  const courses = coursesRes.data ?? [];
  const courseMap: Record<string, { ar: string; en: string }> = {};
  for (const c of courses) courseMap[c.id] = { ar: c.title_ar, en: c.title_en ?? c.title_ar };

  // Latest attempt per quiz (attempts already sorted desc by submitted_at).
  const latestByQuiz: Record<string, { id: string; score_pct: number | null; passed: boolean | null; submitted_at: string | null }> = {};
  for (const a of attempts) {
    if (!latestByQuiz[a.quiz_id] && a.submitted_at) latestByQuiz[a.quiz_id] = a;
  }

  return (
    <div dir={dir} className="mx-auto max-w-3xl px-4 py-8 sm:px-6">
      <h1 className="font-display text-2xl font-bold sm:text-3xl">{t("اختباراتي", "My Quizzes")}</h1>
      <p className="mt-2 text-sm text-muted">
        {t("اختبارات الدورات التي تتابعها.", "Quizzes from courses you're enrolled in.")}
      </p>

      {quizzes.length === 0 ? (
        <div className="glass-card mt-8 p-10 text-center text-muted">
          {t("لا توجد اختبارات منشورة بعد", "No published quizzes yet")}
        </div>
      ) : (
        <ul className="mt-8 glass-card divide-y divide-[var(--surface-divider,#F0F0F2)] overflow-hidden">
          {quizzes.map((q) => {
            const last = latestByQuiz[q.id];
            const taken = !!last;
            const courseTitle = courseMap[q.course_id]
              ? (lang === "ar" ? courseMap[q.course_id].ar : courseMap[q.course_id].en)
              : "—";
            return (
              <li key={q.id}>
                <Link
                  href={taken ? `/student/quizzes/${q.id}/result` : `/student/quizzes/${q.id}/take`}
                  className="flex items-center gap-3 px-5 py-3 transition-colors hover:bg-foreground/5"
                >
                  <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-[var(--surface-light,#F5F5F7)]">
                    {taken ? (
                      last.passed
                        ? <CheckCircle2 size={16} className="text-emerald-400" aria-hidden="true" />
                        : <AlertCircle size={16} className="text-amber-400" aria-hidden="true" />
                    ) : <Sparkles size={16} className="text-gold" aria-hidden="true" />}
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">
                      {lang === "ar" ? q.title_ar : (q.title_en ?? q.title_ar)}
                    </p>
                    <p className="mt-0.5 truncate text-[11px] text-muted">
                      {courseTitle}
                      {q.due_at && <> · {t("الموعد:", "due:")} {new Date(q.due_at).toLocaleDateString(lang === "ar" ? "ar" : "en-US")}</>}
                    </p>
                  </div>
                  {taken && last.score_pct != null ? (
                    <span className={`font-mono text-sm font-semibold ${last.passed ? "text-emerald-400" : "text-amber-400"}`}>
                      {Math.round(last.score_pct)}%
                    </span>
                  ) : (
                    <span className="rounded-full border border-gold/30 bg-gold/10 px-2.5 py-0.5 text-[10px] font-medium text-gold">
                      {t("ابدأ", "Start")}
                    </span>
                  )}
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
