"use client";

import Link from "next/link";
import { TrendingUp, BookOpen, CheckCircle, Clock, Star, Award, Target, MessageSquareQuote, Sparkles, AlertCircle, Mail } from "lucide-react";
import { useLang } from "@/lib/i18n/context";

const ARABIC_NUMS = ["","١","٢","٣","٤","٥","٦","٧","٨","٩","١٠","١١","١٢","١٣","١٤","١٥","١٦","١٧","١٨","١٩","٢٠","٢١","٢٢","٢٣","٢٤","٢٥","٢٦","٢٧","٢٨","٢٩","٣٠"];

const LEVEL_CONFIG: Record<string, { ar: string; en: string; color: string }> = {
  beginner: { ar: "مبتدئ", en: "Beginner", color: "text-blue-400" },
  intermediate: { ar: "متوسط", en: "Intermediate", color: "text-amber-400" },
  advanced: { ar: "متقدم", en: "Advanced", color: "text-emerald-400" },
};

const EVAL_TYPE_AR: Record<string, string> = {
  weekly: "أسبوعي",
  biweekly: "نصف شهري",
  monthly: "شهري",
  quarterly: "ربع سنوي",
};

const EVAL_TYPE_EN: Record<string, string> = {
  weekly: "Weekly",
  biweekly: "Bi-weekly",
  monthly: "Monthly",
  quarterly: "Quarterly",
};

/** The 5 classical tajweed error categories tracked in
 *  recitation_errors.error_type, plus the 'other' bucket. Order matters —
 *  it's the order the heatmap renders them. Hint text gives the student a
 *  one-line description of what each category covers, since not every
 *  student remembers their tajweed terminology. */
const ERROR_CATEGORIES = [
  { key: "makharij", ar: "مخارج", en: "Makharij", hintAr: "نقاط نطق الحروف", hintEn: "Articulation points" },
  { key: "sifat", ar: "صفات", en: "Sifat", hintAr: "صفات الحروف", hintEn: "Letter qualities" },
  { key: "madd", ar: "مدود", en: "Madd", hintAr: "أحكام المد", hintEn: "Elongation rules" },
  { key: "waqf", ar: "وقف", en: "Waqf", hintAr: "أحكام الوقف", hintEn: "Stopping rules" },
  { key: "ghunna", ar: "غنّة", en: "Ghunna", hintAr: "أحكام الغنّة", hintEn: "Nasalisation" },
] as const;

interface EvalScore {
  date: string;
  hifz: number | null;
  tajweed: number | null;
  overall: number | null;
}

interface ProgressRecord {
  id: string;
  surah_from: number | null;
  surah_to: number | null;
  quality_rating: number | null;
  level: string;
  progress_type: string;
  created_at: string;
}

interface ProgressData {
  completedCount: number;
  currentLevel: string;
  avgQuality: number | null;
  juzTouched: number[];
  totalHours: number;
  evalScores: EvalScore[];
  hwStats: { total: number; excellent: number; good: number; needsWork: number; notDone: number };
  /** Average completed sessions per week over the trailing 28-day window.
   *  Drives the milestone-projection line. 0 = student is new or inactive. */
  sessionsPerWeek: number;
  /** Counts of recitation_errors by error_type from the last 30 days.
   *  Always contains all 5 tajweed categories + 'other' so the heatmap
   *  renders consistently. A zero is meaningful, not a missing data point. */
  errorBreakdown: Record<string, number>;
  /** Most-recent parent_reports row for this student, or null if no parent
   *  report has ever been sent (typical for adult students). Surfaces what
   *  the parent sees so the student isn't out of the loop on their own
   *  progress. RLS-gated by the student_read_reports policy. */
  parentReport: { content: string; report_type: string; sent_at: string | null; created_at: string } | null;
  latestEval: {
    overall_score: number | null;
    hifz_score: number | null;
    tajweed_score: number | null;
    fluency_score: number | null;
    attendance_score: number | null;
    strengths: string | null;
    areas_for_improvement: string | null;
    next_goals: string | null;
    teacher_comments: string | null;
    evaluation_type: string | null;
    created_at: string;
  } | null;
  progressRecords: ProgressRecord[];
}

export function ProgressContent({ data }: { data: ProgressData }) {
  const { t, dir, lang } = useLang();
  const locale = lang === "ar" ? "ar-EG" : "en-US";
  const { completedCount, currentLevel, avgQuality, juzTouched, totalHours, evalScores, hwStats, latestEval, progressRecords, sessionsPerWeek, errorBreakdown, parentReport } = data;

  const level = LEVEL_CONFIG[currentLevel] ?? LEVEL_CONFIG.beginner;
  const juzSet = new Set(juzTouched);
  const juzCount = juzSet.size;

  // Milestones
  const milestones = [
    { threshold: 1, label: t("أول جلسة", "First session"), icon: Star },
    { threshold: 10, label: t("١٠ جلسات", "10 sessions"), icon: Award },
    { threshold: 25, label: t("٢٥ جلسة", "25 sessions"), icon: Award },
    { threshold: 50, label: t("٥٠ جلسة", "50 sessions"), icon: Award },
    { threshold: 100, label: t("١٠٠ جلسة", "100 sessions"), icon: Target },
  ];

  return (
    <div dir={dir} className="mx-auto max-w-4xl px-4 py-8">
      <h1 className="mb-2 flex items-center gap-2 font-display text-2xl font-bold">
        <TrendingUp size={24} className="text-gold" /> {t("تقدمي في تعلم القرآن", "My Quran Progress")}
      </h1>
      <p className="mb-8 text-xs text-muted">My Quran Learning Progress</p>

      {/* Stats Grid */}
      <div className="mb-8 grid grid-cols-2 gap-4 md:grid-cols-4">
        <div className="glass-card p-5 text-center">
          <CheckCircle size={20} className="mx-auto mb-2 text-gold" />
          <p className="font-display text-2xl font-bold text-gold">{completedCount}</p>
          <p className="text-xs text-muted">{t("جلسات مكتملة", "Sessions")}</p>
        </div>
        <div className="glass-card p-5 text-center">
          <Clock size={20} className="mx-auto mb-2 text-sky-400" />
          <p className="font-display text-2xl font-bold text-sky-400">{totalHours}</p>
          <p className="text-xs text-muted">{t("ساعات دراسة", "Study hours")}</p>
        </div>
        <div className="glass-card p-5 text-center">
          <BookOpen size={20} className="mx-auto mb-2 text-emerald-400" />
          <p className="font-display text-2xl font-bold text-emerald-400">{juzCount}/30</p>
          <p className="text-xs text-muted">{t("أجزاء مدروسة", "Juz studied")}</p>
        </div>
        <div className="glass-card p-5 text-center">
          <Star size={20} className={`mx-auto mb-2 ${level.color}`} />
          <p className={`font-display text-2xl font-bold ${level.color}`}>{t(level.ar, level.en)}</p>
          <p className="text-xs text-muted">{t("المستوى", "Level")}</p>
        </div>
      </div>

      {/* From your teacher — qualitative evaluation feedback elevated to be
          the lead pedagogical surface on this page. The teacher's voice
          (recommendations / strengths / what to improve) is what the student
          most needs to see; numeric scores serve it, not the other way around. */}
      {latestEval && (latestEval.strengths || latestEval.areas_for_improvement || latestEval.next_goals || latestEval.teacher_comments) && (
        <section className="mb-8 glass-card p-6">
          <div className="mb-4 flex flex-wrap items-baseline justify-between gap-2">
            <h2 className="flex items-center gap-2 font-display text-lg font-bold">
              <MessageSquareQuote size={20} className="text-gold" /> {t("من معلمك", "From your teacher")}
            </h2>
            <p className="text-xs text-muted">
              {latestEval.evaluation_type
                ? t(`تقييم ${EVAL_TYPE_AR[latestEval.evaluation_type] ?? latestEval.evaluation_type}`, `${EVAL_TYPE_EN[latestEval.evaluation_type] ?? latestEval.evaluation_type} evaluation`)
                : t("آخر تقييم", "Latest evaluation")}
              {" · "}
              {new Date(latestEval.created_at).toLocaleDateString(locale, { month: "short", day: "numeric", year: "numeric" })}
            </p>
          </div>

          {/* Score strip — five dimensions in one row, restrained typography. */}
          <div className="mb-5 grid grid-cols-2 gap-3 sm:grid-cols-5">
            {([
              { key: "hifz", label: t("حفظ", "Hifz"), value: latestEval.hifz_score, color: "text-emerald-400" },
              { key: "tajweed", label: t("تجويد", "Tajweed"), value: latestEval.tajweed_score, color: "text-sky-400" },
              { key: "fluency", label: t("طلاقة", "Fluency"), value: latestEval.fluency_score, color: "text-violet-400" },
              { key: "attendance", label: t("حضور", "Attendance"), value: latestEval.attendance_score, color: "text-amber-400" },
              { key: "overall", label: t("إجمالي", "Overall"), value: latestEval.overall_score, color: "text-gold" },
            ] as const).filter(s => s.value != null).map(s => (
              <div key={s.key} className="rounded-xl border border-card-border bg-card/50 p-3 text-center">
                <p className="text-[11px] uppercase tracking-wide text-muted">{s.label}</p>
                <p className={`font-display text-xl font-bold ${s.color}`}>{s.value}<span className="text-xs text-muted">/10</span></p>
              </div>
            ))}
          </div>

          {/* Next-step focus — placed first because it's the actionable next step. */}
          {latestEval.next_goals && (
            <div className="mb-3 rounded-xl border border-gold/30 bg-gold/5 p-4">
              <h3 className="mb-1 flex items-center gap-1.5 text-sm font-semibold text-gold">
                <Sparkles size={14} aria-hidden="true" /> {t("توصية معلمك للأسبوع القادم", "Your teacher's focus for next week")}
              </h3>
              <p className="text-sm leading-relaxed text-foreground">{latestEval.next_goals}</p>
            </div>
          )}

          {/* Strengths + areas-for-improvement — paired columns at sm+, stacked on mobile. */}
          {(latestEval.strengths || latestEval.areas_for_improvement) && (
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              {latestEval.strengths && (
                <div className="rounded-xl border border-emerald-500/20 bg-emerald-500/5 p-4">
                  <h3 className="mb-1 flex items-center gap-1.5 text-sm font-semibold text-emerald-400">
                    <CheckCircle size={14} aria-hidden="true" /> {t("نقاط القوة", "Strengths")}
                  </h3>
                  <p className="text-sm leading-relaxed text-foreground/90">{latestEval.strengths}</p>
                </div>
              )}
              {latestEval.areas_for_improvement && (
                <div className="rounded-xl border border-orange-500/20 bg-orange-500/5 p-4">
                  <h3 className="mb-1 flex items-center gap-1.5 text-sm font-semibold text-orange-400">
                    <AlertCircle size={14} aria-hidden="true" /> {t("للتحسين", "To improve")}
                  </h3>
                  <p className="text-sm leading-relaxed text-foreground/90">{latestEval.areas_for_improvement}</p>
                </div>
              )}
            </div>
          )}

          {/* Free-form teacher comments — shown last as supplementary context. */}
          {latestEval.teacher_comments && (
            <div className="mt-3 rounded-xl border border-card-border bg-card/30 p-4">
              <h3 className="mb-1 text-sm font-medium text-muted">{t("ملاحظات إضافية", "Additional notes")}</h3>
              <p className="text-sm leading-relaxed text-foreground/80">{latestEval.teacher_comments}</p>
            </div>
          )}
        </section>
      )}

      {/* Recitation-error heatmap — last 30 days, grouped by tajweed
          category. The classical taxonomy (makharij / sifat / madd / waqf /
          ghunna) is captured per session in recitation_errors but never
          surfaced to the student until now. Even a 0 in a category is a
          meaningful signal: "you're clean on madd this month". Helps the
          student self-direct practice between live sessions. */}
      {Object.values(errorBreakdown).some(v => v > 0) && (() => {
        const max = Math.max(...ERROR_CATEGORIES.map(c => errorBreakdown[c.key] ?? 0));
        const totalErrors = ERROR_CATEGORIES.reduce((sum, c) => sum + (errorBreakdown[c.key] ?? 0), 0);
        const topCategory = ERROR_CATEGORIES.reduce((top, c) =>
          (errorBreakdown[c.key] ?? 0) > (errorBreakdown[top.key] ?? 0) ? c : top, ERROR_CATEGORIES[0]);
        return (
          <section className="mb-8 glass-card p-6">
            <div className="mb-1 flex flex-wrap items-baseline justify-between gap-2">
              <h2 className="font-display text-lg font-bold">
                {t("أنماط الأخطاء — آخر ٣٠ يوماً", "Error patterns — last 30 days")}
              </h2>
              <p className="text-xs text-muted">
                {t(`إجمالي ${totalErrors}`, `${totalErrors} total`)}
              </p>
            </div>
            {totalErrors > 0 && (
              <p className="mb-4 text-xs text-muted">
                {t(
                  `أكثر فئة تحتاج مراجعة: ${topCategory.ar} (${topCategory.hintAr})`,
                  `Most-frequent category to review: ${topCategory.en} (${topCategory.hintEn})`,
                )}
              </p>
            )}
            <div className="grid grid-cols-5 gap-2">
              {ERROR_CATEGORIES.map(c => {
                const count = errorBreakdown[c.key] ?? 0;
                const intensity = max > 0 ? count / max : 0;
                // Map intensity → background opacity. Even at 0 we keep a
                // faint tint so the cell reads as "category present, not
                // accumulating errors here".
                const bg = count === 0
                  ? "bg-emerald-500/5 border-emerald-500/15"
                  : intensity >= 0.66
                  ? "bg-orange-500/20 border-orange-500/40"
                  : intensity >= 0.33
                  ? "bg-amber-500/15 border-amber-500/30"
                  : "bg-amber-500/5 border-amber-500/20";
                const textColor = count === 0
                  ? "text-emerald-400/80"
                  : intensity >= 0.66
                  ? "text-orange-300"
                  : "text-amber-300";
                return (
                  <div
                    key={c.key}
                    className={`flex flex-col items-center justify-center rounded-xl border p-3 ${bg}`}
                    title={t(`${c.ar} — ${c.hintAr}`, `${c.en} — ${c.hintEn}`)}
                  >
                    <p className={`font-display text-xl font-bold ${textColor}`}>{count}</p>
                    <p className="mt-0.5 text-xs font-medium text-foreground/80">{t(c.ar, c.en)}</p>
                    <p className="mt-0.5 text-[10px] leading-tight text-muted">{t(c.hintAr, c.hintEn)}</p>
                  </div>
                );
              })}
            </div>
          </section>
        );
      })()}

      {/* Parent's view — surfaces what was sent to the parent so the
          student isn't out of the loop on their own progress. Hidden when
          no parent report exists (typical for adult students). Collapsed
          by default since AI parent reports can run several paragraphs. */}
      {parentReport && (
        <details className="group mb-8 glass-card overflow-hidden">
          <summary className="flex cursor-pointer items-center justify-between gap-3 p-5 list-none">
            <div className="flex items-center gap-2">
              <Mail size={18} className="text-violet-400" aria-hidden="true" />
              <div>
                <h2 className="font-display text-base font-bold">
                  {t("ما رآه والدك", "What your parent saw")}
                </h2>
                <p className="text-xs text-muted">
                  {t(
                    `أُرسل إلى والدك في ${new Date(parentReport.sent_at ?? parentReport.created_at).toLocaleDateString(locale, { month: "short", day: "numeric", year: "numeric" })}`,
                    `Sent to your parent on ${new Date(parentReport.sent_at ?? parentReport.created_at).toLocaleDateString(locale, { month: "short", day: "numeric", year: "numeric" })}`,
                  )}
                </p>
              </div>
            </div>
            <span className="text-xs text-muted-light group-open:hidden">
              {t("اعرض", "Show")} ↓
            </span>
            <span className="hidden text-xs text-muted-light group-open:inline">
              {t("اطوِ", "Hide")} ↑
            </span>
          </summary>
          <div className="border-t border-card-border px-5 py-4">
            <p className="whitespace-pre-wrap text-sm leading-relaxed text-foreground/90">
              {parentReport.content}
            </p>
          </div>
        </details>
      )}

      {/* Quran verse */}
      <div className="mb-8 glass-card p-6 text-center">
        <p className="font-display text-sm text-gold/50">﴿ وَرَتِّلِ الْقُرْآنَ تَرْتِيلًا ﴾</p>
        {avgQuality && (
          <p className="mt-2 text-sm text-muted">
            {t("متوسط جودة الأداء", "Avg quality rating")}: <span className="font-bold text-gold">{avgQuality.toFixed(1)}/5</span>
          </p>
        )}
      </div>

      {/* Juz Tracker */}
      <div className="mb-8">
        <h2 className="mb-4 font-display text-lg font-bold">{t("رحلتك مع القرآن", "Your Quran Journey")}</h2>
        <div className="grid grid-cols-6 gap-2 md:grid-cols-10">
          {Array.from({ length: 30 }, (_, i) => {
            const juzNum = i + 1;
            const touched = juzSet.has(juzNum);
            return (
              <div
                key={juzNum}
                className={`flex aspect-square items-center justify-center rounded-lg text-sm font-medium transition-colors ${
                  touched
                    ? "border border-gold/40 bg-gold/10 text-gold"
                    : "glass text-muted"
                }`}
                title={`${t("الجزء", "Juz")} ${juzNum}`}
              >
                {ARABIC_NUMS[juzNum]}
              </div>
            );
          })}
        </div>
        <p className="mt-3 text-xs text-muted">
          {juzCount > 0
            ? t(`تدرس حالياً في ${juzCount} أجزاء — استمر!`, `Studying ${juzCount} juz — keep going!`)
            : t("سيحدثها معلمك بعد كل جلسة", "Your teacher updates this after each session")}
        </p>
      </div>

      {/* Evaluation Scores Chart (simple bar representation) */}
      {evalScores.length > 0 && (
        <div className="mb-8">
          <h2 className="mb-4 font-display text-lg font-bold">{t("تقييماتي", "My Evaluations")}</h2>
          <div className="glass-card overflow-x-auto p-5">
            <div className="flex items-end gap-4" style={{ minWidth: evalScores.length * 80 }}>
              {evalScores.map((e, i) => (
                <div key={i} className="flex flex-1 flex-col items-center gap-1">
                  {/* Bars */}
                  <div className="flex items-end gap-1" style={{ height: 100 }}>
                    {e.hifz != null && (
                      <div
                        className="w-3 rounded-t bg-emerald-400/60"
                        style={{ height: `${(e.hifz / 10) * 100}%` }}
                        title={`${t("حفظ", "Hifz")}: ${e.hifz}/10`}
                      />
                    )}
                    {e.tajweed != null && (
                      <div
                        className="w-3 rounded-t bg-sky-400/60"
                        style={{ height: `${(e.tajweed / 10) * 100}%` }}
                        title={`${t("تجويد", "Tajweed")}: ${e.tajweed}/10`}
                      />
                    )}
                    {e.overall != null && (
                      <div
                        className="w-3 rounded-t bg-gold/60"
                        style={{ height: `${(e.overall / 10) * 100}%` }}
                        title={`${t("إجمالي", "Overall")}: ${e.overall}/10`}
                      />
                    )}
                  </div>
                  <span className="text-[10px] text-muted">{e.date}</span>
                </div>
              ))}
            </div>
            <div className="mt-3 flex gap-4 text-xs">
              <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-emerald-400/60" /> {t("حفظ", "Hifz")}</span>
              <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-sky-400/60" /> {t("تجويد", "Tajweed")}</span>
              <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-gold/60" /> {t("إجمالي", "Overall")}</span>
            </div>
          </div>
        </div>
      )}

      {/* Follow-up Performance */}
      {hwStats.total > 0 && (
        <div className="mb-8">
          <h2 className="mb-4 font-display text-lg font-bold">{t("أداء المتابعات", "Follow-up Performance")}</h2>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            <div className="glass-card p-4 text-center">
              <p className="font-display text-xl font-bold text-emerald-400">{hwStats.excellent}</p>
              <p className="text-xs text-muted">{t("ممتاز", "Excellent")}</p>
            </div>
            <div className="glass-card p-4 text-center">
              <p className="font-display text-xl font-bold text-sky-400">{hwStats.good}</p>
              <p className="text-xs text-muted">{t("جيد", "Good")}</p>
            </div>
            <div className="glass-card p-4 text-center">
              <p className="font-display text-xl font-bold text-orange-400">{hwStats.needsWork}</p>
              <p className="text-xs text-muted">{t("يحتاج تحسين", "Needs Work")}</p>
            </div>
            <div className="glass-card p-4 text-center">
              <p className="font-display text-xl font-bold text-red-400">{hwStats.notDone}</p>
              <p className="text-xs text-muted">{t("لم يُنجز", "Not Done")}</p>
            </div>
          </div>
        </div>
      )}

      {/* Milestones */}
      <div className="mb-8">
        <h2 className="mb-4 font-display text-lg font-bold">{t("إنجازاتي", "Milestones")}</h2>
        <div className="flex flex-wrap gap-3">
          {milestones.map(m => {
            const achieved = completedCount >= m.threshold;
            const Icon = m.icon;
            return (
              <div
                key={m.threshold}
                className={`glass-card flex items-center gap-2 px-4 py-2.5 ${
                  achieved ? "border-gold/30 bg-gold/5" : "opacity-40"
                }`}
              >
                <Icon size={16} className={achieved ? "text-gold" : "text-muted"} />
                <span className={`text-sm ${achieved ? "font-semibold" : "text-muted"}`}>{m.label}</span>
                {achieved && <CheckCircle size={12} className="text-gold" />}
              </div>
            );
          })}
        </div>
        {/* Projection — quietly tells the student when the next milestone
            will arrive at their current pace. Hidden if pace is 0
            (brand-new or inactive — projecting infinity helps no one) or
            if all milestones are already achieved. */}
        {(() => {
          const next = milestones.find(m => completedCount < m.threshold);
          if (!next || sessionsPerWeek <= 0) return null;
          const remaining = next.threshold - completedCount;
          const weeks = remaining / sessionsPerWeek;
          const eta = new Date(Date.now() + weeks * 7 * 86400_000);
          const etaLabel = eta.toLocaleDateString(locale, { month: "short", day: "numeric", year: weeks > 26 ? "numeric" : undefined });
          // Round pace to one decimal (e.g. 1.5/week reads cleaner than 1.4285714285).
          const paceLabel = Math.round(sessionsPerWeek * 10) / 10;
          return (
            <p className="mt-3 text-xs text-muted">
              {t(
                `${remaining} ${remaining === 1 ? "جلسة" : "جلسات"} إلى ${next.label}. بمعدلك الحالي (${paceLabel} جلسة/أسبوع)، تصل في ${etaLabel}.`,
                `${remaining} ${remaining === 1 ? "session" : "sessions"} until ${next.label}. At your current pace (${paceLabel}/week), you'll reach it around ${etaLabel}.`,
              )}
            </p>
          );
        })()}
      </div>

      {/* Recent Progress Records */}
      {progressRecords.length > 0 && (
        <div>
          <h2 className="mb-4 font-display text-lg font-bold">{t("سجل التقدم", "Progress Log")}</h2>
          <div className="space-y-2">
            {progressRecords.map(r => (
              <div key={r.id} className="glass-card flex items-center justify-between px-4 py-3">
                <div className="flex items-center gap-3">
                  <span className={`rounded-full border px-2 py-0.5 text-xs ${
                    r.progress_type === "new" ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-400" :
                    r.progress_type === "muraja" ? "border-blue-500/30 bg-blue-500/10 text-blue-400" :
                    "border-orange-500/30 bg-orange-500/10 text-orange-400"
                  }`}>
                    {r.progress_type === "new" ? t("جديد", "New") : r.progress_type === "muraja" ? t("مراجعة", "Review") : t("تصحيح", "Correction")}
                  </span>
                  {r.surah_from && (
                    <span className="text-sm">
                      {t("سورة", "Surah")} {r.surah_from}
                      {r.surah_to && r.surah_to !== r.surah_from && ` → ${r.surah_to}`}
                    </span>
                  )}
                </div>
                <div className="flex items-center gap-3 text-xs text-muted">
                  {r.quality_rating && (
                    <span className="font-medium text-gold">{r.quality_rating}/5</span>
                  )}
                  <span>{new Date(r.created_at).toLocaleDateString(locale, { month: "short", day: "numeric" })}</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Empty state */}
      {completedCount === 0 && progressRecords.length === 0 && (
        <div className="glass-card p-12 text-center">
          <BookOpen size={40} className="mx-auto mb-3 text-muted/40" />
          <p className="text-muted">{t("لم تُكمل أي تلاوة بعد", "No recitations completed yet")}</p>
          <p className="mt-1 text-sm text-muted/60">{t("ستظهر تلاواتك هنا بعد كل جلسة مع معلمك", "Your recitations will appear here after each session with your teacher")}</p>
          <Link href="/student/teachers" className="mt-4 inline-block text-sm text-gold hover:text-gold-hover">
            {t("احجز جلستك الأولى ←", "Book your first session →")}
          </Link>
        </div>
      )}
    </div>
  );
}
