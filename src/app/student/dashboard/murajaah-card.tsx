"use client";

import { useState } from "react";
import { RotateCcw, Check, CheckCircle } from "lucide-react";
import { useLang } from "@/lib/i18n/context";
import { surahName } from "@/lib/quran/surahs";
import { ActionFeedback } from "@/components/shared/action-feedback";
import { markReviewComplete } from "./murajaah-actions";
import { REVIEW_QUALITY_OPTIONS } from "@/lib/domains/murajaah/quality-options";
import type { MurajaahDueItem } from "@/lib/dashboard-queries";

// Per-option Tailwind tones: emerald = positive recall, amber = effortful but
// passing, red = lapse. Tokens follow repo conventions (see
// src/lib/retention/ui.ts, src/lib/constants.ts).
const TONE_BY_QUALITY: Record<number, string> = {
  5: "border-emerald-500/30 bg-emerald-500/10 text-emerald-400 hover:bg-emerald-500/15",
  3: "border-amber-500/30 bg-amber-500/10 text-amber-400 hover:bg-amber-500/15",
  1: "border-red-500/30 bg-red-500/10 text-red-400 hover:bg-red-500/15",
};

/**
 * Daily Murajaah card (spec 001, SM-2 v1) — lists the portions due for review
 * today and lets the student mark each done with an honest SM-2 recall quality.
 * Three options map to the SM-2 quality scale: "حفظت" → 5 (good recall, grows
 * the interval), "بجهد" → 3 (passing recall, still grows but lowers easiness),
 * "لم أحفظ" → 1 (a lapse: complete_review resets the interval to 1 day and
 * lowers easiness). Hides when nothing is due; congratulates quietly when all
 * are done.
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
    try {
      const res = await markReviewComplete(scheduleId, quality);
      if (res.error) setError(res.error);
      else setDone((prev) => new Set(prev).add(scheduleId));
    } catch {
      setError(t("تعذّر تحديث المراجعة", "Couldn't update review"));
    } finally {
      setPendingIds((prev) => { const s = new Set(prev); s.delete(scheduleId); return s; });
    }
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
              {REVIEW_QUALITY_OPTIONS.map((opt) => (
                <button
                  key={opt.quality}
                  type="button"
                  disabled={pendingIds.has(item.scheduleId)}
                  onClick={() => complete(item.scheduleId, opt.quality)}
                  aria-label={`${t(opt.ar, opt.en)} — ${formatRange(item, lang === "ar" ? "ar" : "en", t)}`}
                  className={`inline-flex min-h-[44px] items-center gap-1.5 rounded-full border px-3 py-1.5 text-sm font-medium disabled:opacity-50 focus-ring ${TONE_BY_QUALITY[opt.quality]}`}
                >
                  {opt.quality === 5 && <Check size={14} aria-hidden="true" />}
                  {t(opt.ar, opt.en)}
                </button>
              ))}
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
