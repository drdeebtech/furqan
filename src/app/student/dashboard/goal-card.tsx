"use client";

import { GoalForm } from "@/components/goals/goal-form";
import { WidgetCard } from "@/components/shared/widget-card";
import { useLang } from "@/lib/i18n/context";
import type { GoalDashboardData } from "@/lib/domains/goals/goals";
import { surahName } from "@/lib/quran/surahs";

export function GoalCard({ goal }: { goal: GoalDashboardData | null }) {
  const { t, lang } = useLang();
  const locale = lang === "ar" ? "ar-EG" : "en-US";

  if (!goal) {
    return (
      <WidgetCard title={t("هدفي", "My goal")} subtitle={t("حدّد وجهتك في الحفظ", "Set your memorization destination")}>
        <p className="mb-4 text-sm text-muted">
          {t("ليس لديك هدف حالي. حدّد نطاقًا وتاريخًا لتتابع تقدّمك.", "You do not have a goal yet. Choose a range and target date to track your progress.")}
        </p>
        <GoalForm />
      </WidgetCard>
    );
  }

  const progress = goal.totalAyahs > 0
    ? Math.min(100, Math.round((goal.memorizedAyahs / goal.totalAyahs) * 100))
    : 0;
  const startName = surahName(goal.surah_start, lang === "ar" ? "ar" : "en") ?? String(goal.surah_start);
  const endName = surahName(goal.surah_end, lang === "ar" ? "ar" : "en") ?? String(goal.surah_end);
  const range = `${startName} ${goal.ayah_start} — ${endName} ${goal.ayah_end}`;
  const targetDate = new Date(`${goal.target_date}T00:00:00Z`).toLocaleDateString(locale);
  const projectedDate = goal.projectedDate
    ? new Date(goal.projectedDate).toLocaleDateString(locale)
    : t("غير معروف حتى يتوفر معدل حفظ", "Unknown until a pace is established");

  return (
    <WidgetCard title={t("هدفي", "My goal")} subtitle={range}>
      <div className="flex items-end justify-between gap-4">
        <p className="text-2xl font-bold text-gold" dir="ltr">
          {goal.memorizedAyahs} / {goal.totalAyahs}
        </p>
        <p className="text-xs text-muted">{progress}%</p>
      </div>
      <div className="mt-2 h-2 overflow-hidden rounded-full bg-surface-light" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={progress}>
        <div className="h-full rounded-full bg-gold transition-[width]" style={{ width: `${progress}%` }} />
      </div>
      <dl className="mt-4 grid gap-3 text-sm sm:grid-cols-2">
        <div>
          <dt className="text-xs text-muted">{t("التاريخ المستهدف", "Target date")}</dt>
          <dd className="mt-1 font-medium">{targetDate}</dd>
        </div>
        <div>
          <dt className="text-xs text-muted">{t("الإكمال المتوقع", "Projected completion")}</dt>
          <dd className="mt-1 font-medium">{projectedDate}</dd>
        </div>
      </dl>
      <details className="mt-5 border-t border-card-border pt-4">
        <summary className="cursor-pointer text-sm font-medium text-gold">
          {t("تعديل الهدف", "Edit goal")}
        </summary>
        <div className="mt-4"><GoalForm initialGoal={goal} /></div>
      </details>
    </WidgetCard>
  );
}
