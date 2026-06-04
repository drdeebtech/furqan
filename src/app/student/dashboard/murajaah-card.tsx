"use client";

import { useState } from "react";
import { RotateCcw, Check, CheckCircle } from "lucide-react";
import { useLang } from "@/lib/i18n/context";
import { surahName } from "@/lib/quran/surahs";
import { ActionFeedback } from "@/components/shared/action-feedback";
import { markReviewComplete } from "./murajaah-actions";
import type { MurajaahDueItem } from "@/lib/dashboard-queries";

/**
 * Daily Murajaah card (spec 001, SM-2 v1) — lists the portions due for review
 * today and lets the student mark each done. Marking pushes the item forward on
 * the SM-2 schedule (complete_review); "صعبة" records a lapse (shorter next
 * interval, lower easiness). Hides when nothing is due; congratulates quietly
 * when all are done.
 *
 * Brand discipline (.impeccable.md): quiet, no gamification.
 */
export function MurajaahCard({ items }: { items: MurajaahDueItem[] }) {
  const { t, lang } = useLang();
  const [done, setDone] = useState<Set<string>>(new Set());
  const [pendingIds, setPendingIds] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(null);
  if (items.length === 0) return null;

  const remaining = items.filter((i) => !done.has(i.scheduleId));

  if (remaining.length === 0) {
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

  async function complete(scheduleId: string, quality: number) {
    setError(null);
    setPendingIds((prev) => new Set(prev).add(scheduleId));
    const res = await markReviewComplete(scheduleId, quality);
    if (res.error) setError(res.error);
    else setDone((prev) => new Set(prev).add(scheduleId));
    setPendingIds((prev) => { const s = new Set(prev); s.delete(scheduleId); return s; });
  }

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
          {t(`${remaining.length} مقطع للمراجعة`, `${remaining.length} to review`)}
        </p>
      </div>

      {error && <div className="mb-3"><ActionFeedback state={{ error }} /></div>}

      <ul className="space-y-2">
        {remaining.map((item) => (
          <li
            key={item.scheduleId}
            className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-card-border/60 bg-card/30 px-3 py-2"
          >
            <span className="text-sm text-foreground/90">{formatRange(item, lang === "ar" ? "ar" : "en", t)}</span>
            <div className="flex items-center gap-2">
              <button
                type="button"
                disabled={pendingIds.has(item.scheduleId)}
                onClick={() => complete(item.scheduleId, 4)}
                className="inline-flex min-h-[44px] items-center gap-1.5 rounded-full border border-emerald-500/30 bg-emerald-500/10 px-3 py-1.5 text-sm font-medium text-emerald-400 hover:bg-emerald-500/15 disabled:opacity-50 focus-ring"
              >
                <Check size={14} aria-hidden="true" />
                {t("تمت", "Done")}
              </button>
              <button
                type="button"
                disabled={pendingIds.has(item.scheduleId)}
                onClick={() => complete(item.scheduleId, 2)}
                className="inline-flex min-h-[44px] items-center rounded-full border border-card-border px-3 py-1.5 text-sm font-medium text-muted hover:text-foreground disabled:opacity-50 focus-ring"
              >
                {t("صعبة", "Hard")}
              </button>
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}

function formatRange(i: MurajaahDueItem, lang: "ar" | "en", t: (ar: string, en: string) => string): string {
  const surahNum = i.surahTo ?? i.surahFrom;
  const surah = (surahNum != null ? surahName(surahNum, lang) : null) ?? t("القرآن", "Quran");
  let ayah = "";
  if (i.ayahFrom != null && i.ayahTo != null && i.ayahFrom !== i.ayahTo) ayah = ` (${i.ayahFrom}–${i.ayahTo})`;
  else if (i.ayahFrom != null) ayah = ` (${i.ayahFrom})`;
  return lang === "ar" ? `سورة ${surah}${ayah}` : `Surah ${surah}${ayah}`;
}
