"use client";

import { useState } from "react";
import { BookOpen, Save, CheckCircle, AlertCircle, Plus, Trash2 } from "lucide-react";
import { recordSessionProgress } from "./actions";
import { ActionFeedback } from "@/components/shared/action-feedback";
import { useLang } from "@/lib/i18n/context";
import { surahName } from "@/lib/quran/surahs";
import { ayahCount } from "@/lib/quran/ayah-counts";
import { validateRange, violationMessageAr } from "@/lib/domains/progress/validation";
import type { ProgressType, ErrorType, CapturedError } from "@/lib/domains/progress/types";

const SURAH_OPTIONS = Array.from({ length: 114 }, (_, i) => i + 1);

const TYPE_LABELS: Record<ProgressType, { ar: string; en: string }> = {
  new: { ar: "حفظ جديد", en: "New (sabaq)" },
  muraja: { ar: "مراجعة", en: "Review (murājaʿah)" },
  correction: { ar: "تصحيح", en: "Correction" },
};

const ERROR_TYPE_LABELS: Record<ErrorType, { ar: string; en: string }> = {
  makharij: { ar: "المخارج", en: "Makhārij (articulation)" },
  sifat: { ar: "الصفات", en: "Ṣifāt (attributes)" },
  madd: { ar: "المد", en: "Madd (elongation)" },
  waqf: { ar: "الوقف", en: "Waqf (stopping)" },
  ghunna: { ar: "الغنة", en: "Ghunnah (nasalization)" },
  other: { ar: "أخرى", en: "Other" },
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
  const [errors, setErrors] = useState<CapturedError[]>([]);
  const [showErrors, setShowErrors] = useState(false);
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
      errors: errors.length > 0 ? errors : undefined,
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
            className={`min-h-[44px] rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors ${
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
            onChange={(e) => {
              const v = Number(e.target.value);
              setQuality(e.target.value === "" || Number.isNaN(v) ? "" : Math.max(1, Math.min(5, Math.round(v))));
            }}
            className="glass-input mt-1 min-h-[44px] w-full px-3 py-1.5 text-sm"
          />
        </label>
        <label className="block text-xs text-muted">
          {t("الصفحات", "Pages")}
          <input
            type="number" min={0} value={pages}
            onChange={(e) => {
              const v = Number(e.target.value);
              setPages(e.target.value === "" || Number.isNaN(v) ? "" : Math.max(0, Math.round(v)));
            }}
            className="glass-input mt-1 min-h-[44px] w-full px-3 py-1.5 text-sm"
          />
        </label>
      </div>

      <TajweedErrorsSection
        errors={errors}
        showErrors={showErrors}
        onToggle={() => setShowErrors((v) => !v)}
        onChange={setErrors}
        defaultSurah={needsRange ? surahFrom : 1}
      />

      <button
        onClick={handleSave}
        disabled={saving}
        className="glass-gold glass-pill flex min-h-[44px] items-center gap-2 px-5 py-2 text-sm font-semibold transition-colors hover:bg-primary-hover disabled:opacity-50 focus-ring"
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

/**
 * Expandable Tajweed-error capture. Each row: surah (defaults to the session's
 * starting surah), ayah (bounded by that surah's count), error-type dropdown,
 * optional note. Rows can be removed. The whole section is collapsible so it
 * stays out of the way for sessions with no errors.
 *
 * For progressType=correction the domain requires ≥1 error; the server guard
 * (capture.ts) is authoritative — here we just surface a hint.
 */
function TajweedErrorsSection({
  errors,
  showErrors,
  onToggle,
  onChange,
  defaultSurah,
}: {
  errors: CapturedError[];
  showErrors: boolean;
  onToggle: () => void;
  onChange: (next: CapturedError[]) => void;
  defaultSurah: number;
}) {
  const { t } = useLang();

  function addError() {
    onChange([
      ...errors,
      { surahNum: defaultSurah, ayahNum: 1, errorType: "makharij", note: null },
    ]);
  }

  function updateAt(idx: number, patch: Partial<CapturedError>) {
    onChange(errors.map((e, i) => (i === idx ? { ...e, ...patch } : e)));
  }

  function removeAt(idx: number) {
    onChange(errors.filter((_, i) => i !== idx));
  }

  return (
    <div className="rounded-lg border border-[var(--surface-border)]">
      <button
        type="button"
        onClick={onToggle}
        className="flex w-full min-h-[44px] items-center gap-2 px-3 py-2 text-xs font-medium text-muted hover:text-foreground"
        aria-expanded={showErrors}
      >
        <AlertCircle size={15} className="text-gold" aria-hidden="true" />
        <span>{t("أخطاء التجويد", "Tajweed Errors")}</span>
        {errors.length > 0 && (
          <span className="rounded-full bg-gold/15 px-2 py-0.5 text-[10px] font-semibold text-gold">
            {errors.length}
          </span>
        )}
        <span className="ms-auto text-muted-light">{showErrors ? "▲" : "▼"}</span>
      </button>

      {showErrors && (
        <div className="space-y-3 border-t border-[var(--surface-border)] p-3">
          {errors.length === 0 && (
            <p className="text-xs text-muted-light">
              {t("لا توجد أخطاء مُسجّلة.", "No errors recorded.")}
            </p>
          )}

          {errors.map((e, idx) => {
            const max = ayahCount(e.surahNum) ?? 1;
            return (
              <div key={idx} className="space-y-2 rounded-md bg-surface/40 p-2">
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                  <label className="block text-[11px] text-muted">
                    {t("السورة", "Surah")}
                    <select
                      value={e.surahNum}
                      onChange={(ev) => {
                        const s = Number(ev.target.value);
                        const m = ayahCount(s) ?? 1;
                        updateAt(idx, { surahNum: s, ayahNum: Math.min(e.ayahNum, m) });
                      }}
                      className="glass-input mt-1 min-h-[44px] w-full px-2 py-1.5 text-sm"
                    >
                      {SURAH_OPTIONS.map((n) => (
                        <option key={n} value={n}>{n}. {surahName(n, "ar")}</option>
                      ))}
                    </select>
                  </label>
                  <label className="block text-[11px] text-muted">
                    {t("الآية", "Āyah")}
                    <input
                      type="number" min={1} max={max} value={e.ayahNum}
                      onChange={(ev) => updateAt(idx, { ayahNum: Math.max(1, Math.min(max, Math.round(Number(ev.target.value)) || 1)) })}
                      className="glass-input mt-1 min-h-[44px] w-full px-2 py-1.5 text-sm"
                    />
                  </label>
                  <label className="block text-[11px] text-muted">
                    {t("النوع", "Type")}
                    <select
                      value={e.errorType}
                      onChange={(ev) => updateAt(idx, { errorType: ev.target.value as ErrorType })}
                      className="glass-input mt-1 min-h-[44px] w-full px-2 py-1.5 text-sm"
                    >
                      {(Object.keys(ERROR_TYPE_LABELS) as ErrorType[]).map((et) => (
                        <option key={et} value={et}>{t(ERROR_TYPE_LABELS[et].ar, ERROR_TYPE_LABELS[et].en)}</option>
                      ))}
                    </select>
                  </label>
                  <div className="flex items-end">
                    <button
                      type="button"
                      onClick={() => removeAt(idx)}
                      className="glass-input flex min-h-[44px] w-full items-center justify-center gap-1 px-2 py-1.5 text-xs text-destructive hover:bg-destructive/10"
                      aria-label={t("حذف الخطأ", "Remove error")}
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>
                </div>
                <label className="block text-[11px] text-muted">
                  {t("ملاحظة (اختياري)", "Note (optional)")}
                  <input
                    type="text" maxLength={1000} value={e.note ?? ""}
                    onChange={(ev) => updateAt(idx, { note: ev.target.value || null })}
                    className="glass-input mt-1 min-h-[44px] w-full px-3 py-1.5 text-sm"
                  />
                </label>
              </div>
            );
          })}

          <button
            type="button"
            onClick={addError}
            className="flex min-h-[44px] w-full items-center justify-center gap-1.5 rounded-md border border-dashed border-[var(--surface-border)] px-3 py-1.5 text-xs font-medium text-muted hover:border-gold/40 hover:text-gold"
          >
            <Plus size={14} />
            {t("إضافة خطأ", "Add error")}
          </button>
        </div>
      )}
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
        className="glass-input min-h-[44px] w-full px-2 py-1.5 text-sm"
      >
        {SURAH_OPTIONS.map((n) => (
          <option key={n} value={n}>{n}. {surahName(n, "ar")}</option>
        ))}
      </select>
      <input
        type="number" min={1} max={max} value={ayah}
        onChange={(e) => onAyah(Math.max(1, Math.min(max, Math.round(Number(e.target.value)) || 1)))}
        className="glass-input min-h-[44px] w-full px-2 py-1.5 text-sm"
        aria-label={`${label} ayah (1-${max})`}
      />
      <span className="text-[10px] text-muted-light">{`آية 1–${max}`}</span>
    </div>
  );
}
