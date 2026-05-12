import type { Metadata } from "next";
import Link from "next/link";
import { redirect, notFound } from "next/navigation";
import { Sparkles, CheckCircle2, AlertCircle } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { logError } from "@/lib/logger";
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
  const { data: enrollments, error: enrollmentsError } = await supabase.from("course_enrollments")
    .select("course_id")
    .eq("student_id", user.id)
    .returns<{ course_id: string }[]>();

  if (enrollmentsError) {
    logError("quizzes page: course_enrollments query failed", enrollmentsError, {
      tag: "quizzes", route: "/student/quizzes", userId: user.id,
    });
  }

  if (!enrollments || enrollments.length === 0) {
    // No-enrollment branch: keep the page header (audit P2-1 caught this
    // empty-state branch missing the title) and frame the empty state
    // with pedagogical scaffolding instead of a generic "no quizzes" line.
    // The student needs to know that quizzes are tied to courses, and
    // courses are different from live 1:1 sessions.
    return (
      <div dir={dir} className="mx-auto max-w-3xl px-4 py-8 sm:px-6">
        <h1 className="font-display text-2xl font-bold sm:text-3xl">{t("اختباراتي", "My Quizzes")}</h1>
        <p className="mt-2 text-sm text-muted">
          {t("اختبارات الدورات التي تتابعها.", "Quizzes from courses you're enrolled in.")}
        </p>

        <div className="mt-8 glass-card p-8">
          <div className="mb-4 flex items-start gap-3">
            <Sparkles size={28} className="mt-1 text-gold/70 shrink-0" aria-hidden="true" />
            <div>
              <p className="text-base font-medium">
                {t("لم تشترك في دورة بعد", "You haven't enrolled in a course yet")}
              </p>
              <p className="mt-2 text-sm leading-relaxed text-muted">
                {t(
                  "الاختبارات هنا مرتبطة بالدورات المسجلة — كل دورة لها اختباراتها التي تثبّت ما تعلمته. عند اشتراكك في دورة تظهر اختباراتها هنا تلقائياً. الاختبارات تختلف عن المتابعات التي يكلّفك بها معلمك في الجلسات المباشرة.",
                  "Quizzes are tied to enrolled courses — each course has its own quizzes that consolidate what you've learned. When you enroll in a course, its quizzes appear here automatically. Quizzes are different from the follow-ups your teacher assigns in your live sessions.",
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
              href="/student/follow-up"
              className="text-xs text-muted hover:text-foreground/80 focus-ring rounded"
            >
              {t("متابعاتي من المعلم ←", "My follow-ups from teacher →")}
            </Link>
          </div>
        </div>
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

  for (const [name, res] of [
    ["quizzes", quizzesRes],
    ["quiz_attempts", attemptsRes],
    ["courses", coursesRes],
  ] as const) {
    if (res.error) {
      logError(`quizzes page: ${name} query failed`, res.error, {
        tag: "quizzes", route: "/student/quizzes", userId: user.id,
      });
    }
  }
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
        <div className="glass-card mt-8 p-10 text-center">
          <p className="text-muted">
            {t("لا توجد اختبارات منشورة بعد", "No published quizzes yet")}
          </p>
          <p className="mt-2 text-xs text-muted/70">
            {t(
              "ستظهر هنا تلقائياً حين ينشر المعلم اختبار دورة تتابعها.",
              "These appear automatically when a teacher publishes a quiz in a course you're enrolled in.",
            )}
          </p>
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
                        ? <CheckCircle2 size={16} className="text-success" aria-hidden="true" />
                        : <AlertCircle size={16} className="text-warning" aria-hidden="true" />
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
                    <span className={`font-mono text-sm font-semibold ${last.passed ? "text-success" : "text-warning"}`}>
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
