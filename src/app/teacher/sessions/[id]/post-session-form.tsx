"use client";

import { useState } from "react";
import { CheckCircle, Save } from "lucide-react";
import { savePostSessionNotes } from "./actions";
import { EvalForm } from "@/app/teacher/students/[studentId]/eval-form";
import { HomeworkAssignmentForm } from "@/components/shared/homework-assignment-form";
import type { HomeworkAssignment } from "@/types/database";
import { useLang } from "@/lib/i18n/context";

export function PostSessionForm({
  sessionId,
  bookingId,
  studentId,
  studentName,
  existingNotes,
  existingHomework,
  existingAssignments,
}: {
  sessionId: string;
  bookingId: string;
  studentId: string;
  studentName: string;
  existingNotes: string | null;
  existingHomework: string | null;
  existingAssignments: HomeworkAssignment[];
}) {
  const { t } = useLang();
  const [notes, setNotes] = useState(existingNotes ?? "");
  const [homework, setHomework] = useState(existingHomework ?? "");
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSaveNotes() {
    setSaving(true);
    setError(null);
    const result = await savePostSessionNotes(sessionId, notes, homework);
    if (result.error) {
      setError(result.error);
    } else {
      setSaved(true);
      setTimeout(() => setSaved(false), 3000);
    }
    setSaving(false);
  }

  return (
    <div className="space-y-6">
      <div className="glass-card p-6 text-center">
        <CheckCircle size={32} className="mx-auto mb-2 text-success" />
        <p className="text-lg font-semibold">{t("تمت الجلسة بنجاح", "Session completed")}</p>
        <p className="mt-1 text-sm text-muted">{t("أضف ملاحظاتك والواجب للطالب", "Add notes and homework for the student")}</p>
      </div>

      {error && (
        <div className="rounded-xl border border-error/30 bg-error/10 p-3 text-sm text-error">
          {error}
        </div>
      )}

      {/* Session Notes */}
      <div>
        <label htmlFor="notes" className="mb-1 block text-sm font-medium">
          {t("ملاحظات الجلسة", "Session notes")}
          <span className="me-2 text-xs text-muted">Session notes</span>
        </label>
        <textarea
          id="notes"
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          rows={4}
          className="glass-input w-full resize-none px-4 py-2.5 text-foreground placeholder:text-muted/50 focus:border-input-focus focus:outline-none focus:ring-1 focus:ring-input-focus"
          placeholder={t("ملاحظات عن أداء الطالب في هذه الجلسة…", "Notes about student performance...")}
        />
      </div>

      {/* Legacy homework text (for backward compatibility) */}
      <div>
        <label htmlFor="homework" className="mb-1 block text-sm font-medium">
          {t("ملاحظات سريعة عن الواجب", "Quick homework notes")}
          <span className="me-2 text-xs text-muted">Quick notes</span>
        </label>
        <textarea
          id="homework"
          value={homework}
          onChange={(e) => setHomework(e.target.value)}
          rows={2}
          className="glass-input w-full resize-none px-4 py-2.5 text-foreground placeholder:text-muted/50 focus:border-input-focus focus:outline-none focus:ring-1 focus:ring-input-focus"
          placeholder={t("ملاحظات سريعة (اختياري)…", "Quick notes (optional)...")}
        />
      </div>

      <button
        onClick={handleSaveNotes}
        disabled={saving}
        className="glass-gold glass-pill flex items-center gap-2 px-6 py-2.5 font-semibold transition-colors hover:bg-primary-hover disabled:opacity-50 focus-ring"
      >
        {saving ? (
          <span className="h-5 w-5 animate-spin rounded-full border-2 border-white/30 border-t-white" />
        ) : saved ? (
          <>
            <CheckCircle size={18} />
            {t("تم الحفظ", "Saved")}
          </>
        ) : (
          <>
            <Save size={18} />
            {t("حفظ الملاحظات", "Save notes")}
          </>
        )}
      </button>

      <div className="border-t border-white/10 pt-6">
        <HomeworkAssignmentForm
          bookingId={bookingId}
          studentId={studentId}
          sessionId={sessionId}
          existingAssignments={existingAssignments}
        />
      </div>

      {/* Quick Evaluation */}
      <div className="border-t border-white/10 pt-6">
        <p className="mb-3 text-sm text-muted">{t("هل تريد تقييم الطالب بعد هذه الجلسة؟", "Evaluate student after session?")}</p>
        <EvalForm studentId={studentId} studentName={studentName} compact />
      </div>
    </div>
  );
}
