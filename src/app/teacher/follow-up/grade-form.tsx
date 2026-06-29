"use client";

import { useState, type Dispatch, type SetStateAction } from "react";
import { CheckCircle, Plus, X } from "lucide-react";
import { gradeFollowUp } from "@/lib/actions/follow-up";
import { useLang } from "@/lib/i18n/context";
import type { HomeworkStatus } from "@/types/database";
import type { CapturedError, ErrorType } from "@/lib/domains/progress/types";

const GRADES: { value: HomeworkStatus; ar: string; en: string; className: string }[] = [
  { value: "completed_excellent", ar: "ممتاز", en: "Excellent", className: "border-success/40 bg-success/10 text-success hover:bg-success/20" },
  { value: "completed_good", ar: "جيد", en: "Good", className: "border-gold/40 bg-gold/10 text-gold hover:bg-gold/20" },
  { value: "completed_needs_work", ar: "يحتاج تحسين", en: "Needs Work", className: "border-warning/40 bg-warning/10 text-warning hover:bg-warning/20" },
  { value: "completed_not_done", ar: "لم يُنجز", en: "Not Done", className: "border-error/40 bg-error/10 text-red-400 hover:bg-error/20" },
];

const ERROR_TYPES: { value: ErrorType; ar: string; en: string }[] = [
  { value: "makharij", ar: "مخارج", en: "Makharij" },
  { value: "sifat", ar: "صفات", en: "Sifat" },
  { value: "madd", ar: "مدّ", en: "Madd" },
  { value: "waqf", ar: "وقف", en: "Waqf" },
  { value: "ghunna", ar: "غنّة", en: "Ghunna" },
  { value: "other", ar: "أخرى", en: "Other" },
];

/** Talqeen error-capture context (#541): the captured-error list is owned by the
 *  parent (TalqeenRow) so the audio player's "tag error" button can append to it
 *  directly — controlled props, no effect. `defaults` pre-fills new rows. */
export interface ErrorCaptureProps {
  errors: CapturedError[];
  // A state setter (not a value-only callback): updates use the functional form
  // so a manual edit and the audio player's concurrent "tag error" append never
  // overwrite each other from a stale snapshot. (#541 CR)
  onErrorsChange: Dispatch<SetStateAction<CapturedError[]>>;
  defaults: { surah: number | null; ayahStart: number | null };
}

export function GradeForm({
  homeworkId,
  homeworkTitle,
  onGraded,
  errorCapture,
}: {
  homeworkId: string;
  homeworkTitle: string;
  onGraded?: () => void;
  /** When set, renders the tajweed error-capture section (Talqeen review). */
  errorCapture?: ErrorCaptureProps;
}) {
  const { t } = useLang();
  const [selectedGrade, setSelectedGrade] = useState<HomeworkStatus | null>(null);
  const [teacherNotes, setTeacherNotes] = useState("");
  const [saving, setSaving] = useState(false);
  const [success, setSuccess] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const errors = errorCapture?.errors ?? [];

  function updateError(idx: number, patch: Partial<CapturedError>) {
    errorCapture?.onErrorsChange((prev) => prev.map((e, i) => (i === idx ? { ...e, ...patch } : e)));
  }
  function removeError(idx: number) {
    errorCapture?.onErrorsChange((prev) => prev.filter((_, i) => i !== idx));
  }
  function addError() {
    if (!errorCapture) return;
    const { surah, ayahStart } = errorCapture.defaults;
    errorCapture.onErrorsChange((prev) => [
      ...prev,
      { surahNum: surah ?? 1, ayahNum: ayahStart ?? 1, errorType: "madd", note: null },
    ]);
  }

  // A captured error is valid only with an in-range surah (1–114) and a
  // positive ayah; the server re-validates against canonical ayah counts, but
  // gating here stops a cleared/NaN field from being saved as 1:1 or dropped
  // silently by the best-effort persistence layer. (#541 CR)
  const hasInvalidError = errors.some(
    (e) => !Number.isInteger(e.surahNum) || e.surahNum < 1 || e.surahNum > 114 || !Number.isInteger(e.ayahNum) || e.ayahNum < 1,
  );

  async function handleSubmit() {
    if (!selectedGrade) {
      setError(t("يرجى اختيار التقييم", "Please select a grade"));
      return;
    }
    if (hasInvalidError) {
      setError(t("راجع أرقام السورة/الآية في الأخطاء المحددة", "Check the surah/ayah numbers on the tagged errors"));
      return;
    }
    setSaving(true);
    setError(null);

    const fd = new FormData();
    fd.set("grade", selectedGrade);
    if (teacherNotes.trim()) fd.set("teacher_notes", teacherNotes.trim());
    if (errors.length > 0) fd.set("errors", JSON.stringify(errors));

    const result = await gradeFollowUp(homeworkId, fd);
    if ("error" in result && result.error) {
      setError(result.error);
    } else {
      setSuccess(true);
      onGraded?.();
    }
    setSaving(false);
  }

  if (success) {
    return (
      <div className="flex items-center gap-2 rounded-xl border border-success/30 bg-success/10 p-3 text-sm text-success">
        <CheckCircle size={16} />
        {t("تم تقييم المتابعة بنجاح", "Follow-up graded successfully")}
        {(selectedGrade === "completed_needs_work" || selectedGrade === "completed_not_done") && (
          <span className="text-xs text-muted"> — {t("تم إعادة تكليف الطالب تلقائياً", "Student auto-reassigned")}</span>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {error && (
        <div className="rounded-xl border border-error/30 bg-error/10 p-2 text-sm text-error">{error}</div>
      )}

      <fieldset>
        <legend className="mb-2 text-sm font-medium">{t("تقييم", "Grade")}: {homeworkTitle}</legend>
        <div className="flex flex-wrap gap-2">
          {GRADES.map((g) => (
            <button
              key={g.value}
              type="button"
              onClick={() => setSelectedGrade(g.value)}
              className={`rounded-full border px-3 py-1.5 text-sm font-medium transition-all ${g.className} ${
                selectedGrade === g.value ? "ring-2 ring-white/30" : ""
              }`}
            >
              {t(g.ar, g.en)}
            </button>
          ))}
        </div>
      </fieldset>

      <label htmlFor="teacher-notes" className="sr-only">{t("ملاحظات المعلم", "Teacher notes")}</label>
      <textarea
        id="teacher-notes"
        value={teacherNotes}
        onChange={(e) => setTeacherNotes(e.target.value)}
        rows={2}
        className="glass-input w-full resize-none px-4 py-2 text-sm focus:border-input-focus focus:outline-none focus:ring-1 focus:ring-input-focus"
        placeholder={t("ملاحظات للطالب (اختياري)…", "Feedback for student (optional)...")}
      />

      {errorCapture && (
        <fieldset className="rounded-xl border border-card-border bg-card/20 p-3">
          <legend className="px-1 text-xs font-medium text-muted">{t("أخطاء التجويد", "Tajweed errors")}</legend>
          {errors.length === 0 ? (
            <p className="text-xs text-muted-light">{t("استمع وحدّد الأخطاء بزر «وسم خطأ هنا» أو أضِف يدويًا.", 'Listen and mark errors with "Tag error here", or add manually.')}</p>
          ) : (
            <ul className="space-y-2">
              {errors.map((e, idx) => (
                <li key={idx} className="flex flex-wrap items-center gap-1.5">
                  <label className="sr-only" htmlFor={`err-surah-${idx}`}>{t("السورة", "Surah")}</label>
                  <input
                    id={`err-surah-${idx}`}
                    type="number" min={1} max={114} inputMode="numeric"
                    value={Number.isNaN(e.surahNum) ? "" : e.surahNum}
                    onChange={(ev) => updateError(idx, { surahNum: ev.currentTarget.valueAsNumber })}
                    className="glass-input w-16 px-2 py-1 text-xs"
                    aria-label={t("رقم السورة", "Surah number")}
                  />
                  <label className="sr-only" htmlFor={`err-ayah-${idx}`}>{t("الآية", "Ayah")}</label>
                  <input
                    id={`err-ayah-${idx}`}
                    type="number" min={1} inputMode="numeric"
                    value={Number.isNaN(e.ayahNum) ? "" : e.ayahNum}
                    onChange={(ev) => updateError(idx, { ayahNum: ev.currentTarget.valueAsNumber })}
                    className="glass-input w-16 px-2 py-1 text-xs"
                    aria-label={t("رقم الآية", "Ayah number")}
                  />
                  <select
                    value={e.errorType}
                    onChange={(ev) => updateError(idx, { errorType: ev.target.value as ErrorType })}
                    className="glass-input px-2 py-1 text-xs"
                    aria-label={t("نوع الخطأ", "Error type")}
                  >
                    {ERROR_TYPES.map((et) => (
                      <option key={et.value} value={et.value}>{t(et.ar, et.en)}</option>
                    ))}
                  </select>
                  <input
                    type="text"
                    value={e.note ?? ""}
                    onChange={(ev) => updateError(idx, { note: ev.target.value || null })}
                    placeholder={t("ملاحظة…", "Note…")}
                    className="glass-input min-w-[5rem] flex-1 px-2 py-1 text-xs"
                    aria-label={t("ملاحظة الخطأ", "Error note")}
                  />
                  <button
                    type="button"
                    onClick={() => removeError(idx)}
                    className="focus-ring inline-flex min-h-11 min-w-11 items-center justify-center rounded-full text-muted hover:text-error"
                    aria-label={t("حذف الخطأ", "Remove error")}
                  >
                    <X size={14} />
                  </button>
                </li>
              ))}
            </ul>
          )}
          <button
            type="button"
            onClick={addError}
            className="focus-ring mt-2 inline-flex min-h-11 items-center gap-1 rounded-full border border-card-border bg-card/30 px-3 py-2 text-xs text-muted hover:bg-card/50"
          >
            <Plus size={12} aria-hidden="true" /> {t("أضف خطأ", "Add error")}
          </button>
        </fieldset>
      )}

      <button
        type="button"
        onClick={handleSubmit}
        disabled={saving || !selectedGrade}
        className="glass-gold glass-pill px-5 py-2 text-sm font-semibold transition-colors hover:bg-primary-hover disabled:opacity-50 focus-ring"
      >
        {saving ? (
          <span className="h-4 w-4 animate-spin rounded-full border-2 border-white/30 border-t-white" />
        ) : (
          t("تأكيد التقييم", "Confirm grade")
        )}
      </button>
    </div>
  );
}
