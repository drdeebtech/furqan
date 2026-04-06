"use client";

import { useState } from "react";
import { Star, CheckCircle } from "lucide-react";
import { createTeacherEvaluation } from "@/lib/actions/evaluations";

const SCORES = [
  { key: "hifz_score", ar: "الحفظ", en: "Hifz" },
  { key: "tajweed_score", ar: "التجويد", en: "Tajweed" },
  { key: "akhlaq_score", ar: "الأخلاق", en: "Akhlaq" },
  { key: "attendance_score", ar: "الحضور", en: "Attendance" },
  { key: "overall_score", ar: "الكلية", en: "Overall" },
];

const EVAL_TYPES = [
  { value: "weekly", ar: "أسبوعي" },
  { value: "biweekly", ar: "نصف شهري" },
  { value: "monthly", ar: "شهري" },
  { value: "quarterly", ar: "ربع سنوي" },
];

export function EvalForm({
  studentId,
  studentName,
  compact,
}: {
  studentId: string;
  studentName: string;
  compact?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [scores, setScores] = useState<Record<string, number>>({});
  const [evalType, setEvalType] = useState("weekly");
  const [strengths, setStrengths] = useState("");
  const [weaknesses, setWeaknesses] = useState("");
  const [recommendations, setRecommendations] = useState("");

  async function handleSubmit() {
    if (!scores.overall_score) {
      setError("يجب إدخال الدرجة الكلية على الأقل");
      return;
    }
    setLoading(true);
    setError(null);

    const now = new Date();
    const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);

    const result = await createTeacherEvaluation(
      studentId,
      evalType,
      weekAgo.toISOString().split("T")[0],
      now.toISOString().split("T")[0],
      {
        hifz: scores.hifz_score,
        tajweed: scores.tajweed_score,
        akhlaq: scores.akhlaq_score,
        attendance: scores.attendance_score,
        overall: scores.overall_score,
      },
      { strengths: strengths || null, weaknesses: weaknesses || null, recommendations: recommendations || null },
    );

    setLoading(false);
    if (result.error) {
      setError(result.error);
    } else {
      setDone(true);
    }
  }

  if (done) {
    return (
      <div className="rounded-xl border border-green-500/30 bg-green-500/5 p-4 text-center">
        <CheckCircle size={24} className="mx-auto mb-2 text-green-400" />
        <p className="text-sm font-medium text-green-400">تم حفظ التقييم بنجاح</p>
      </div>
    );
  }

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className={`flex items-center gap-2 ${compact ? "rounded-lg border border-gold/30 bg-gold/10 px-4 py-2 text-sm" : "rounded-xl border border-gold/30 bg-gold/5 px-6 py-3"} font-medium text-gold transition-colors hover:bg-gold/20`}
      >
        <Star size={16} />
        {compact ? "تقييم سريع" : `تقييم ${studentName}`}
      </button>
    );
  }

  const input = "w-full rounded-lg border border-input-border bg-input px-3 py-2 text-sm focus:border-gold focus:outline-none";

  return (
    <div className="rounded-xl border border-gold/30 bg-card p-5">
      <h3 className="mb-4 flex items-center gap-2 text-sm font-bold">
        <Star size={16} className="text-gold" />
        تقييم {studentName}
      </h3>

      {error && (
        <div className="mb-3 rounded-xl border border-error/30 bg-error/10 p-3 text-sm text-error">{error}</div>
      )}

      {/* Eval type */}
      <div className="mb-4">
        <label className="mb-1 block text-xs text-muted">نوع التقييم</label>
        <div className="flex flex-wrap gap-2">
          {EVAL_TYPES.map(t => (
            <button
              key={t.value}
              type="button"
              onClick={() => setEvalType(t.value)}
              className={`rounded-lg border px-3 py-1.5 text-xs transition-colors ${evalType === t.value ? "border-gold bg-gold/10 text-gold" : "border-input-border text-muted hover:border-gold/50"}`}
            >
              {t.ar}
            </button>
          ))}
        </div>
      </div>

      {/* Scores */}
      <div className="mb-4 grid grid-cols-5 gap-2">
        {SCORES.map(s => (
          <div key={s.key}>
            <label className="mb-1 block text-center text-xs text-muted">{s.ar}</label>
            <select
              value={scores[s.key] ?? ""}
              onChange={(e) => setScores(prev => ({ ...prev, [s.key]: Number(e.target.value) }))}
              className={`${input} text-center`}
            >
              <option value="">—</option>
              {[1,2,3,4,5,6,7,8,9,10].map(n => (
                <option key={n} value={n}>{n}</option>
              ))}
            </select>
          </div>
        ))}
      </div>

      {/* Text fields */}
      <div className="mb-3 grid gap-3 sm:grid-cols-3">
        <div>
          <label className="mb-1 block text-xs text-muted">نقاط القوة</label>
          <textarea value={strengths} onChange={e => setStrengths(e.target.value)} rows={2} className={`${input} resize-none`} placeholder="مميزات الطالب..." />
        </div>
        <div>
          <label className="mb-1 block text-xs text-muted">نقاط الضعف</label>
          <textarea value={weaknesses} onChange={e => setWeaknesses(e.target.value)} rows={2} className={`${input} resize-none`} placeholder="نقاط تحتاج تحسين..." />
        </div>
        <div>
          <label className="mb-1 block text-xs text-muted">توصيات</label>
          <textarea value={recommendations} onChange={e => setRecommendations(e.target.value)} rows={2} className={`${input} resize-none`} placeholder="توصيات للطالب..." />
        </div>
      </div>

      <div className="flex gap-2">
        <button
          onClick={handleSubmit}
          disabled={loading}
          className="rounded-lg bg-gold px-5 py-2 text-sm font-semibold text-background transition-colors hover:bg-gold-hover disabled:opacity-50"
        >
          {loading ? (
            <span className="inline-block h-4 w-4 animate-spin rounded-full border-2 border-background/30 border-t-background" />
          ) : null}
          {loading ? "جاري الحفظ…" : "حفظ التقييم"}
        </button>
        <button
          onClick={() => setOpen(false)}
          className="rounded-lg border border-card-border px-4 py-2 text-sm text-muted hover:text-foreground"
        >
          إلغاء
        </button>
      </div>
    </div>
  );
}
