"use client";

import { useState } from "react";
import { BookOpen, Save, CheckCircle } from "lucide-react";
import { recordSessionProgress } from "./actions";
import { ActionFeedback } from "@/components/shared/action-feedback";
import { useLang } from "@/lib/i18n/context";
import { surahName } from "@/lib/quran/surahs";
import { ayahCount } from "@/lib/quran/ayah-counts";
import { validateRange, violationMessageAr } from "@/lib/domains/progress/validation";
import type { ProgressType } from "@/lib/domains/progress/types";

const SURAH_OPTIONS = Array.from({ length: 114 }, (_, i) => i + 1);

const TYPE_LABELS: Record<ProgressType, { ar: string; en: string }> = {
  new: { ar: "حفظ جديد", en: "New (sabaq)" },
  muraja: { ar: "مراجعة", en: "Review (murājaʿah)" },
  correction: { ar: "تصحيح", en: "Correction" },
};

/**
 * Ḥifẓ progress capture (spec 010) — bound to one student's booking. Writes a
 * validated `student_progress` row. Client-side validation mirrors the server
 * (validateRange) for instant feedback; the server action + DB trigger are the
 * authoritative guards.
 */
export function ProgressCaptureForm({
  sessionId,
  bookingId,
}: {
  sessionId: string;
  bookingId: string;
}) {
  const { t } = useLang();
  const [type, setType] = useState<ProgressType>("new");
  const [surahFrom, setSurahFrom] = useState(1);
  const [ayahFrom, setAyahFrom] = useState(1);
  const [surahTo, setSurahTo] = useState(1);
  const [ayahTo, setAyahTo] = useState(1);
  const [quality, setQuality] = useState<number | "">("");
  const [pages, setPages] = useState<number | "">("");
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const needsRange = type === "new"; // a memorized portion must have a range
  const fromMax = ayahCount(surahFrom) ?? 1;
  const toMax = ayahCount(surahTo) ?? 1;

  async function handleSave() {
    setError(null);
    if (needsRange) {
      const v = validateRange({ surahFrom, ayahFrom, surahTo, ayahTo });
      if (v) {
        setError(violationMessageAr(v, (n) => surahName(n, "ar")));
        return;
      }
    }
    setSaving(true);
    const res = await recordSessionProgress({
      sessionId,
      bookingId,
      progressType: type,
      surahFrom: needsRange ? surahFrom : null,
      ayahFrom: needsRange ? ayahFrom : null,
      surahTo: needsRange ? surahTo : null,
      ayahTo: needsRange ? ayahTo : null,
      qualityRating: quality === "" ? null : quality,
      pagesReviewed: pages === "" ? null : pages,
    });
    setSaving(false);
    if (res.error) {
      setError(res.error);
    } else {
      setSaved(true);
      setTimeout(() => setSaved(false), 4000);
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <BookOpen size={16} className="text-gold" aria-hidden="true" />
        <span className="text-sm font-semibold">{t("ماذا حفظ الطالب اليوم؟", "What did the student memorize today?")}</span>
      </div>

      <ActionFeedback
        state={error ? { error } : saved ? { success: true, message: t("تم تسجيل الحفظ", "Progress recorded") } : null}
      />

      {/* progress type */}
      <div className="flex flex-wrap gap-2">
        {(Object.keys(TYPE_LABELS) as ProgressType[]).map((pt) => (
          <button
            key={pt}
            type="button"
            onClick={() => setType(pt)}
            className={`rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors ${
              type === pt
                ? "border-gold/50 bg-gold/15 text-gold"
                : "border-[var(--surface-border)] text-muted hover:border-gold/30 hover:text-foreground"
            }`}
          >
            {t(TYPE_LABELS[pt].ar, TYPE_LABELS[pt].en)}
          </button>
        ))}
      </div>

      {needsRange && (
        <div className="grid grid-cols-2 gap-3">
          <RangeEnd
            label={t("من", "From")}
            surah={surahFrom}
            ayah={ayahFrom}
            max={fromMax}
            onSurah={(s) => { setSurahFrom(s); if (surahTo < s) setSurahTo(s); }}
            onAyah={setAyahFrom}
          />
          <RangeEnd
            label={t("إلى", "To")}
            surah={surahTo}
            ayah={ayahTo}
            max={toMax}
            onSurah={setSurahTo}
            onAyah={setAyahTo}
          />
        </div>
      )}

      <div className="grid grid-cols-2 gap-3">
        <label className="block text-xs text-muted">
          {t("التقييم (1-5)", "Quality (1-5)")}
          <input
            type="number" min={1} max={5} value={quality}
            onChange={(e) => setQuality(e.target.value === "" ? "" : Math.max(1, Math.min(5, Number(e.target.value))))}
            className="glass-input mt-1 w-full px-3 py-1.5 text-sm"
          />
        </label>
        <label className="block text-xs text-muted">
          {t("الصفحات", "Pages")}
          <input
            type="number" min={0} value={pages}
            onChange={(e) => setPages(e.target.value === "" ? "" : Math.max(0, Number(e.target.value)))}
            className="glass-input mt-1 w-full px-3 py-1.5 text-sm"
          />
        </label>
      </div>

      <button
        onClick={handleSave}
        disabled={saving}
        className="glass-gold glass-pill flex items-center gap-2 px-5 py-2 text-sm font-semibold transition-colors hover:bg-primary-hover disabled:opacity-50 focus-ring"
      >
        {saving ? (
          <span className="h-4 w-4 animate-spin rounded-full border-2 border-white/30 border-t-white" />
        ) : saved ? (
          <><CheckCircle size={16} />{t("تم", "Saved")}</>
        ) : (
          <><Save size={16} />{t("تسجيل الحفظ", "Record")}</>
        )}
      </button>
    </div>
  );
}

function RangeEnd({
  label, surah, ayah, max, onSurah, onAyah,
}: {
  label: string; surah: number; ayah: number; max: number;
  onSurah: (s: number) => void; onAyah: (a: number) => void;
}) {
  return (
    <div className="space-y-1">
      <span className="text-xs font-medium text-muted">{label}</span>
      <select
        value={surah}
        onChange={(e) => onSurah(Number(e.target.value))}
        className="glass-input w-full px-2 py-1.5 text-sm"
      >
        {SURAH_OPTIONS.map((n) => (
          <option key={n} value={n}>{n}. {surahName(n, "ar")}</option>
        ))}
      </select>
      <input
        type="number" min={1} max={max} value={ayah}
        onChange={(e) => onAyah(Math.max(1, Math.min(max, Number(e.target.value) || 1)))}
        className="glass-input w-full px-2 py-1.5 text-sm"
        aria-label={`${label} ayah (1-${max})`}
      />
      <span className="text-[10px] text-muted-light">{`آية 1–${max}`}</span>
    </div>
  );
}
