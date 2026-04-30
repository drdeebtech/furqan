"use client";

import { useState, useTransition } from "react";
import { Save, CheckCircle, AlertCircle } from "lucide-react";
import { useLang } from "@/lib/i18n/context";
import { bulkGradeHomework, type GradeKey, type BulkGradeResult } from "./actions";

interface HomeworkItem {
  id: string;
  title: string;
  description: string | null;
  homeworkType: string;
  surah: number | null;
  ayahStart: number | null;
  ayahEnd: number | null;
  pagesCount: number | null;
  createdAt: string;
  dueAt: string | null;
  studentName: string;
  teacherName: string;
}

type RowState = {
  grade: GradeKey | null;
  feedback: string;
};

const GRADE_OPTIONS: {
  key: GradeKey;
  ar: string;
  en: string;
  tone: "emerald" | "lime" | "amber" | "red";
}[] = [
  { key: "excellent", ar: "ممتاز", en: "Excellent", tone: "emerald" },
  { key: "good", ar: "جيد", en: "Good", tone: "lime" },
  { key: "needs_work", ar: "يحتاج عمل", en: "Needs Work", tone: "amber" },
  { key: "not_done", ar: "لم يُنجز", en: "Not Done", tone: "red" },
];

const TONE_BG: Record<string, string> = {
  emerald: "border-success/50 bg-success/15 text-success",
  lime: "border-lime-500/50 bg-lime-500/15 text-lime-300",
  amber: "border-warning/50 bg-warning/15 text-warning",
  red: "border-error/50 bg-error/15 text-red-300",
};

function relativeTime(iso: string, locale: "ar" | "en"): string {
  const diff = Date.now() - new Date(iso).getTime();
  const days = Math.floor(diff / (24 * 60 * 60 * 1000));
  if (days === 0) return locale === "ar" ? "اليوم" : "today";
  if (days === 1) return locale === "ar" ? "أمس" : "yesterday";
  return locale === "ar" ? `منذ ${days} يوم` : `${days}d ago`;
}

export function GraderClient({ items }: { items: HomeworkItem[] }) {
  const { t, lang } = useLang();
  const [states, setStates] = useState<Record<string, RowState>>(() => {
    const initial: Record<string, RowState> = {};
    for (const it of items) initial[it.id] = { grade: null, feedback: "" };
    return initial;
  });
  const [result, setResult] = useState<BulkGradeResult | null>(null);
  const [pending, start] = useTransition();

  const gradedCount = Object.values(states).filter((s) => s.grade !== null).length;

  if (items.length === 0) {
    return (
      <div className="rounded-2xl border border-surface-border/60 bg-surface/40 p-10 text-center text-sm text-muted">
        {t("لا يوجد واجبات بانتظار التقييم.", "No pending homework.")}
      </div>
    );
  }

  const saveAll = () => {
    const payload = Object.entries(states)
      .filter(([, s]) => s.grade !== null)
      .map(([id, s]) => ({ id, grade: s.grade as GradeKey, feedback: s.feedback || null }));
    start(async () => {
      const r = await bulkGradeHomework(payload);
      setResult(r);
    });
  };

  const saveOne = (id: string) => {
    const s = states[id];
    if (!s?.grade) return;
    start(async () => {
      const r = await bulkGradeHomework([
        { id, grade: s.grade as GradeKey, feedback: s.feedback || null },
      ]);
      setResult(r);
    });
  };

  return (
    <div>
      <div className="mb-4 flex items-center justify-between gap-4 rounded-xl border border-surface-border/60 bg-surface/30 px-4 py-3">
        <span className="text-sm text-muted">
          {t(`${gradedCount} / ${items.length} مُقَيَّم`, `${gradedCount} of ${items.length} graded`)}
        </span>
        <button
          onClick={saveAll}
          disabled={pending || gradedCount === 0}
          className="glass-gold glass-pill flex items-center gap-2 px-5 py-2 text-sm font-semibold disabled:opacity-40"
        >
          <Save size={14} />
          {t("حفظ الكل", "Save All Graded")}
        </button>
      </div>

      {result && (
        <div
          className={`mb-4 rounded-lg border p-3 text-sm ${
            result.failed === 0
              ? "border-success/30 bg-success/10 text-success"
              : "border-warning/30 bg-warning/10 text-warning"
          }`}
        >
          {result.failed === 0 ? <CheckCircle size={14} className="me-1 inline" /> : <AlertCircle size={14} className="me-1 inline" />}
          {t(
            `تم تقييم ${result.graded} واجب${result.failed > 0 ? ` · فشل ${result.failed}` : ""}`,
            `Graded ${result.graded}${result.failed > 0 ? ` · ${result.failed} failed` : ""}`,
          )}
          {result.errors.length > 0 && (
            <ul className="mt-2 list-disc ps-5 text-xs opacity-80">
              {result.errors.slice(0, 5).map((e, i) => (
                <li key={i}>{e}</li>
              ))}
            </ul>
          )}
        </div>
      )}

      <ul className="space-y-3">
        {items.map((h) => (
          <li
            key={h.id}
            className="rounded-2xl border border-surface-border/60 bg-surface/40 p-5"
          >
            <div className="mb-2 flex flex-wrap items-baseline justify-between gap-3">
              <div>
                <p className="text-sm font-bold">{h.title}</p>
                <p className="mt-1 text-xs text-muted">
                  {t("الطالب", "Student")}: <span className="text-foreground">{h.studentName}</span>
                  <span className="mx-2">·</span>
                  {t("المعلم", "Teacher")}: <span className="text-foreground">{h.teacherName}</span>
                  <span className="mx-2">·</span>
                  {t("تم الإرسال", "Submitted")} {relativeTime(h.createdAt, lang)}
                </p>
              </div>
              {h.surah !== null && (
                <span className="rounded-full bg-surface/60 px-2 py-0.5 text-xs text-muted">
                  {t("سورة", "Surah")} {h.surah}
                  {h.ayahStart !== null && h.ayahEnd !== null && (
                    <> : {h.ayahStart}–{h.ayahEnd}</>
                  )}
                </span>
              )}
            </div>

            {h.description && (
              <p className="mb-3 rounded-lg bg-surface/50 px-3 py-2 text-xs text-muted">{h.description}</p>
            )}

            <fieldset className="mb-3">
              <legend className="mb-2 text-xs font-medium text-muted">{t("التقييم", "Grade")}</legend>
              <div className="flex flex-wrap gap-2">
                {GRADE_OPTIONS.map((g) => {
                  const selected = states[h.id]?.grade === g.key;
                  return (
                    <button
                      key={g.key}
                      type="button"
                      onClick={() =>
                        setStates((prev) => ({
                          ...prev,
                          [h.id]: { ...prev[h.id], grade: g.key },
                        }))
                      }
                      className={`rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors ${
                        selected ? TONE_BG[g.tone] : "border-surface-border/60 text-muted hover:border-foreground/40 hover:text-foreground"
                      }`}
                    >
                      {t(g.ar, g.en)}
                    </button>
                  );
                })}
              </div>
            </fieldset>

            <div className="flex flex-wrap items-end gap-2">
              <div className="flex-1">
                <label htmlFor={`feedback-${h.id}`} className="mb-1 block text-xs font-medium text-muted">
                  {t("تعليق للطالب (اختياري)", "Feedback (optional)")}
                </label>
                <textarea
                  id={`feedback-${h.id}`}
                  rows={2}
                  value={states[h.id]?.feedback ?? ""}
                  onChange={(e) =>
                    setStates((prev) => ({
                      ...prev,
                      [h.id]: { ...prev[h.id], feedback: e.target.value },
                    }))
                  }
                  className="glass-input w-full rounded-lg px-3 py-2 text-xs"
                />
              </div>
              <button
                type="button"
                onClick={() => saveOne(h.id)}
                disabled={pending || states[h.id]?.grade == null}
                className="flex items-center gap-1 rounded-lg border border-gold/40 bg-gold/15 px-3 py-2 text-xs font-medium text-gold transition-colors hover:bg-gold/25 disabled:opacity-40"
              >
                <Save size={14} /> {t("حفظ", "Save")}
              </button>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
