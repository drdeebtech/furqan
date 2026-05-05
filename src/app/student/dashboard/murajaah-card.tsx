"use client";

import Link from "next/link";
import { BookOpen, RotateCcw, CheckCircle } from "lucide-react";
import { useLang } from "@/lib/i18n/context";
import { surahName } from "@/lib/quran/surahs";
import type { MurajaahWindow } from "@/lib/dashboard-queries";

interface MurajaahCardProps {
  yesterday: MurajaahWindow | null;
  lastWeek: MurajaahWindow | null;
  lastMonth: MurajaahWindow | null;
  reviewedToday: boolean;
}

/**
 * Daily Murajaah prompt — surfaces the student's most-recently-memorized
 * portions across three windows (yesterday / last week / last month) so
 * memorization doesn't decay between sessions. Murajaah (مراجعة) is the
 * core hifz preservation practice; without daily review, new memorization
 * decays within weeks.
 *
 * Hides itself when the student has already logged review today (a
 * progress_type='muraja' row OR a study_log kind='review' entry today)
 * — its job is done. Hides also when no windows have any "new"
 * memorization to review (a brand-new student with nothing yet learned).
 *
 * Brand discipline: no streak fireworks, no badges. Just a quiet "today's
 * review" prompt and a CTA pointing at the time-tracker. Per .impeccable.md
 * "Progress is celebrated quietly, not gamified."
 */
export function MurajaahCard({
  yesterday, lastWeek, lastMonth, reviewedToday,
}: MurajaahCardProps) {
  const { t, lang } = useLang();
  const locale = lang === "ar" ? "ar" : "en-US";

  // Nothing to review yet — student is brand-new.
  if (!yesterday && !lastWeek && !lastMonth) return null;

  // Already reviewed today — quiet acknowledgment, no prompt nag.
  if (reviewedToday) {
    return (
      <section
        id="today-murajaah"
      aria-label={t("مراجعة اليوم", "Today's Murajaah")}
        className="rounded-2xl border border-emerald-500/20 bg-emerald-500/5 p-4"
      >
        <p className="flex items-center gap-2 text-sm text-emerald-400">
          <CheckCircle size={16} aria-hidden="true" />
          {t("تمت مراجعة اليوم — بارك الله فيك", "Today's Murajaah is done — well done")}
        </p>
      </section>
    );
  }

  const windows: { key: string; labelAr: string; labelEn: string; data: MurajaahWindow | null }[] = [
    { key: "yesterday", labelAr: "أمس", labelEn: "Yesterday", data: yesterday },
    { key: "lastWeek", labelAr: "الأسبوع الماضي", labelEn: "Last week", data: lastWeek },
    { key: "lastMonth", labelAr: "الشهر الماضي", labelEn: "Last month", data: lastMonth },
  ];

  return (
    <section
      id="today-murajaah"
      aria-label={t("مراجعة اليوم", "Today's Murajaah")}
      className="rounded-2xl border border-card-border bg-card p-5"
    >
      <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="flex items-center gap-2 font-display text-base font-bold">
          <RotateCcw size={16} className="text-gold" aria-hidden="true" />
          {t("مراجعة اليوم", "Today's Murajaah")}
        </h2>
        <p className="text-xs text-muted">
          {t("راجع ٥ دقائق فقط", "Review for just 5 minutes")}
        </p>
      </div>

      <ul className="space-y-2">
        {windows.map(w => (
          <li
            key={w.key}
            className="flex items-baseline justify-between gap-3 rounded-lg border border-card-border/60 bg-card/30 px-3 py-2"
          >
            <span className="shrink-0 text-xs font-medium uppercase tracking-wide text-muted-light">
              {t(w.labelAr, w.labelEn)}
            </span>
            {w.data ? (
              <span className="text-sm text-foreground/90">
                {formatRange(w.data, lang === "ar" ? "ar" : "en", locale, t)}
              </span>
            ) : (
              <span className="text-xs italic text-muted/70">
                {t("لا شيء جديد في هذه الفترة", "Nothing new in this window")}
              </span>
            )}
          </li>
        ))}
      </ul>

      <div className="mt-4 flex items-center justify-end">
        <Link
          href="/student/time-tracker"
          className="inline-flex items-center gap-1.5 rounded-full border border-gold/30 bg-gold/10 px-3.5 py-1.5 text-sm font-medium text-gold hover:bg-gold/15 focus-ring"
        >
          <BookOpen size={14} aria-hidden="true" />
          {t("ابدأ المراجعة", "Start review")}
        </Link>
      </div>
    </section>
  );
}

function formatRange(
  w: MurajaahWindow,
  lang: "ar" | "en",
  locale: string,
  t: (ar: string, en: string) => string,
): string {
  const surahNum = w.surahTo ?? w.surahFrom;
  const surah = surahName(surahNum, lang) ?? t("القرآن", "Quran");
  const ayahFrom = w.ayahFrom;
  const ayahTo = w.ayahTo;

  let ayahRange = "";
  if (ayahFrom != null && ayahTo != null && ayahFrom !== ayahTo) {
    ayahRange = lang === "ar" ? ` (${ayahFrom}–${ayahTo})` : ` (${ayahFrom}–${ayahTo})`;
  } else if (ayahFrom != null) {
    ayahRange = lang === "ar" ? ` (${ayahFrom})` : ` (${ayahFrom})`;
  }

  const dateLabel = new Date(w.loggedAt).toLocaleDateString(locale, { month: "short", day: "numeric" });
  const surahPart = lang === "ar" ? `سورة ${surah}${ayahRange}` : `Surah ${surah}${ayahRange}`;
  return `${surahPart} · ${dateLabel}`;
}
