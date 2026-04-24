"use client";

import Link from "next/link";
import { TrendingUp, BookOpen, CheckCircle, Clock, Star, Award, Target } from "lucide-react";
import { useLang } from "@/lib/i18n/context";

const ARABIC_NUMS = ["","١","٢","٣","٤","٥","٦","٧","٨","٩","١٠","١١","١٢","١٣","١٤","١٥","١٦","١٧","١٨","١٩","٢٠","٢١","٢٢","٢٣","٢٤","٢٥","٢٦","٢٧","٢٨","٢٩","٣٠"];

const LEVEL_CONFIG: Record<string, { ar: string; en: string; color: string }> = {
  beginner: { ar: "مبتدئ", en: "Beginner", color: "text-blue-400" },
  intermediate: { ar: "متوسط", en: "Intermediate", color: "text-amber-400" },
  advanced: { ar: "متقدم", en: "Advanced", color: "text-emerald-400" },
};

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
  latestEval: { overall_score: number | null; hifz_score: number | null; tajweed_score: number | null; strengths: string | null; weaknesses: string | null; recommendations: string | null } | null;
  progressRecords: ProgressRecord[];
}

export function ProgressContent({ data }: { data: ProgressData }) {
  const { t, dir } = useLang();
  const { completedCount, currentLevel, avgQuality, juzTouched, totalHours, evalScores, hwStats, latestEval, progressRecords } = data;

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

      {/* Latest Evaluation Summary */}
      {latestEval && (
        <div className="mb-8 glass-card p-5">
          <h3 className="mb-3 font-semibold">{t("آخر تقييم", "Latest Evaluation")}</h3>
          <div className="grid grid-cols-3 gap-3 text-center">
            {latestEval.hifz_score != null && (
              <div>
                <p className="text-xs text-muted">{t("حفظ", "Hifz")}</p>
                <p className="font-display text-lg font-bold text-emerald-400">{latestEval.hifz_score}/10</p>
              </div>
            )}
            {latestEval.tajweed_score != null && (
              <div>
                <p className="text-xs text-muted">{t("تجويد", "Tajweed")}</p>
                <p className="font-display text-lg font-bold text-sky-400">{latestEval.tajweed_score}/10</p>
              </div>
            )}
            {latestEval.overall_score != null && (
              <div>
                <p className="text-xs text-muted">{t("إجمالي", "Overall")}</p>
                <p className="font-display text-lg font-bold text-gold">{latestEval.overall_score}/10</p>
              </div>
            )}
          </div>
          {latestEval.strengths && (
            <p className="mt-3 text-xs"><span className="text-emerald-400">{t("نقاط القوة:", "Strengths:")}</span> {latestEval.strengths}</p>
          )}
          {latestEval.recommendations && (
            <p className="mt-1 text-xs"><span className="text-gold">{t("توصيات:", "Tips:")}</span> {latestEval.recommendations}</p>
          )}
        </div>
      )}

      {/* Homework Performance */}
      {hwStats.total > 0 && (
        <div className="mb-8">
          <h2 className="mb-4 font-display text-lg font-bold">{t("أداء الواجبات", "Homework Performance")}</h2>
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
                  <span>{new Date(r.created_at).toLocaleDateString("ar-SA", { month: "short", day: "numeric" })}</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Empty state */}
      {completedCount === 0 && (
        <div className="glass-card p-12 text-center">
          <BookOpen size={40} className="mx-auto mb-3 text-muted/40" />
          <p className="text-muted">{t("ابدأ رحلتك مع القرآن", "Start your Quran journey")}</p>
          <Link href="/student/teachers" className="mt-4 inline-block text-sm text-gold hover:text-gold-hover">
            {t("احجز جلستك الأولى ←", "Book your first session →")}
          </Link>
        </div>
      )}
    </div>
  );
}
