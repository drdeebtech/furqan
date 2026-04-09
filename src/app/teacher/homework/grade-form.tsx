"use client";

import { useState } from "react";
import { CheckCircle } from "lucide-react";
import { gradeHomework } from "@/lib/actions/homework";
import { useLang } from "@/lib/i18n/context";
import type { HomeworkStatus } from "@/types/database";

const GRADES: { value: HomeworkStatus; ar: string; en: string; className: string }[] = [
  { value: "completed_excellent", ar: "ممتاز", en: "Excellent", className: "border-emerald-500/40 bg-emerald-500/10 text-emerald-400 hover:bg-emerald-500/20" },
  { value: "completed_good", ar: "جيد", en: "Good", className: "border-sky-500/40 bg-sky-500/10 text-sky-400 hover:bg-sky-500/20" },
  { value: "completed_needs_work", ar: "يحتاج تحسين", en: "Needs Work", className: "border-orange-500/40 bg-orange-500/10 text-orange-400 hover:bg-orange-500/20" },
  { value: "completed_not_done", ar: "لم يُنجز", en: "Not Done", className: "border-red-500/40 bg-red-500/10 text-red-400 hover:bg-red-500/20" },
];

export function GradeForm({
  homeworkId,
  homeworkTitle,
  onGraded,
}: {
  homeworkId: string;
  homeworkTitle: string;
  onGraded?: () => void;
}) {
  const { t } = useLang();
  const [selectedGrade, setSelectedGrade] = useState<HomeworkStatus | null>(null);
  const [teacherNotes, setTeacherNotes] = useState("");
  const [saving, setSaving] = useState(false);
  const [success, setSuccess] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit() {
    if (!selectedGrade) {
      setError(t("يرجى اختيار التقييم", "Please select a grade"));
      return;
    }
    setSaving(true);
    setError(null);

    const fd = new FormData();
    fd.set("grade", selectedGrade);
    if (teacherNotes.trim()) fd.set("teacher_notes", teacherNotes.trim());

    const result = await gradeHomework(homeworkId, fd);
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
        {t("تم تقييم الواجب بنجاح", "Homework graded successfully")}
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

      <p className="text-sm font-medium">{t("تقييم", "Grade")}: {homeworkTitle}</p>

      <div className="flex flex-wrap gap-2">
        {GRADES.map((g) => (
          <button
            key={g.value}
            onClick={() => setSelectedGrade(g.value)}
            className={`rounded-full border px-3 py-1.5 text-sm font-medium transition-all ${g.className} ${
              selectedGrade === g.value ? "ring-2 ring-white/30" : ""
            }`}
          >
            {t(g.ar, g.en)}
          </button>
        ))}
      </div>

      <textarea
        value={teacherNotes}
        onChange={(e) => setTeacherNotes(e.target.value)}
        rows={2}
        className="glass-input w-full resize-none px-4 py-2 text-sm focus:border-input-focus focus:outline-none focus:ring-1 focus:ring-input-focus"
        placeholder={t("ملاحظات للطالب (اختياري)…", "Feedback for student (optional)...")}
      />

      <button
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
