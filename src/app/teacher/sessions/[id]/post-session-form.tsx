"use client";

import { useState } from "react";
import { CheckCircle, Save, Users } from "lucide-react";
import { savePostSessionNotes } from "./actions";
import { EvalForm } from "@/app/teacher/students/[studentId]/eval-form";
import { HomeworkAssignmentForm } from "@/components/shared/homework-assignment-form";
import type { HomeworkAssignment } from "@/types/database";
import { useLang } from "@/lib/i18n/context";

interface EnrolledStudent {
  bookingId: string;
  studentId: string;
  studentName: string;
  assignments: HomeworkAssignment[];
}

export function PostSessionForm({
  sessionId,
  bookingId,
  studentId,
  studentName,
  existingNotes,
  existingHomework,
  existingAssignments,
  enrolled,
}: {
  sessionId: string;
  bookingId: string;
  studentId: string;
  studentName: string;
  existingNotes: string | null;
  /** @deprecated Legacy free-text homework field; structured homework now lives below */
  existingHomework: string | null;
  existingAssignments: HomeworkAssignment[];
  /**
   * Full per-booking enrollment data. For 1:1 sessions this contains a
   * single entry (the primary student). For groups, one entry per enrolled
   * student so the teacher can assign homework + evaluate each individually.
   * If absent, falls back to the legacy single-student props above.
   */
  enrolled?: EnrolledStudent[];
}) {
  const { t } = useLang();
  const [notes, setNotes] = useState(existingNotes ?? "");
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Build the per-student card list. Falls back to single-student props for
  // any caller that hasn't migrated to the `enrolled` array yet.
  const cards: EnrolledStudent[] = (enrolled && enrolled.length > 0)
    ? enrolled
    : [{ bookingId, studentId, studentName, assignments: existingAssignments }];
  const isGroup = cards.length > 1;
  const [activeStudentId, setActiveStudentId] = useState(cards[0].studentId);
  const active = cards.find((c) => c.studentId === activeStudentId) ?? cards[0];
  // Note: existingHomework (legacy free-text field) is preserved unchanged
  // when saving notes — passing it through means existing rows aren't
  // wiped on first save. New homework should be assigned via the
  // structured HomeworkAssignmentForm below.

  async function handleSaveNotes() {
    setSaving(true);
    setError(null);
    const result = await savePostSessionNotes(sessionId, notes, existingHomework ?? "");
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
        <div role="alert" aria-atomic="true" className="rounded-xl border border-error/30 bg-error/10 p-3 text-sm text-error">
          {error}
        </div>
      )}

      {/* Session Notes — narrative summary of the session itself.
          Homework is assigned via the structured form below; the legacy
          "Quick homework notes" textarea was removed because having two
          input surfaces for homework was confusing teachers. */}
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

      {/* Per-student tabs (group sessions only). For 1:1 sessions the single
          student is the only option, so the tab strip collapses into a label. */}
      {isGroup && (
        <div className="border-t border-white/10 pt-6">
          <div className="mb-3 flex flex-wrap items-center gap-2">
            <Users size={14} className="text-gold" aria-hidden="true" />
            <span className="text-xs font-medium uppercase tracking-wider text-muted">
              {t("اختر الطالب لاعتماد واجب أو تقييم", "Pick a student to assign homework or evaluate")}
            </span>
          </div>
          <div role="tablist" aria-label={t("الطلاب المسجلون", "Enrolled students")} className="flex flex-wrap gap-2">
            {cards.map((c) => {
              const isActive = c.studentId === activeStudentId;
              return (
                <button
                  key={c.studentId}
                  role="tab"
                  aria-selected={isActive}
                  type="button"
                  onClick={() => setActiveStudentId(c.studentId)}
                  className={`rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors ${
                    isActive
                      ? "border-gold/50 bg-gold/15 text-gold"
                      : "border-[var(--surface-border)] text-muted hover:border-gold/30 hover:text-foreground"
                  }`}
                >
                  {c.studentName}
                  <span className="ms-1 text-[10px] text-muted-light">
                    ({c.assignments.length})
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      )}

      <div className="border-t border-white/10 pt-6">
        <HomeworkAssignmentForm
          key={active.bookingId}
          bookingId={active.bookingId}
          studentId={active.studentId}
          sessionId={sessionId}
          existingAssignments={active.assignments}
        />
      </div>

      {/* Quick Evaluation — bound to the active tab so the right student
          gets evaluated in group sessions. Singleton sessions show the
          original behaviour. */}
      <div className="border-t border-white/10 pt-6">
        <p className="mb-3 text-sm text-muted">
          {isGroup
            ? t(`هل تريد تقييم ${active.studentName}؟`, `Evaluate ${active.studentName}?`)
            : t("هل تريد تقييم الطالب بعد هذه الجلسة؟", "Evaluate student after session?")}
        </p>
        <EvalForm key={active.studentId} studentId={active.studentId} studentName={active.studentName} compact />
      </div>
    </div>
  );
}
