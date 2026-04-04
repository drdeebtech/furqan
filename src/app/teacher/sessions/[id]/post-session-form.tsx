"use client";

import { useState } from "react";
import { CheckCircle, Save } from "lucide-react";
import { savePostSessionNotes } from "./actions";

export function PostSessionForm({
  sessionId,
  existingNotes,
  existingHomework,
}: {
  sessionId: string;
  existingNotes: string | null;
  existingHomework: string | null;
}) {
  const [notes, setNotes] = useState(existingNotes ?? "");
  const [homework, setHomework] = useState(existingHomework ?? "");
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSave() {
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
      <div className="rounded-2xl border border-card-border bg-card elevation-2 p-6 text-center">
        <CheckCircle size={32} className="mx-auto mb-2 text-success" />
        <p className="text-lg font-semibold">تمت الجلسة بنجاح</p>
        <p className="mt-1 text-sm text-muted">أضف ملاحظاتك والواجب للطالب</p>
      </div>

      {error && (
        <div className="rounded-lg border border-error/30 bg-error/10 p-3 text-sm text-error">
          {error}
        </div>
      )}

      <div>
        <label htmlFor="notes" className="mb-1 block text-sm font-medium">
          ملاحظات الجلسة
          <span className="mr-2 text-xs text-muted">Session notes</span>
        </label>
        <textarea
          id="notes"
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          rows={4}
          className="w-full resize-none rounded-xl border border-input-border bg-input neu-inset px-4 py-2.5 text-foreground placeholder:text-muted/50 focus:border-input-focus focus:outline-none focus:ring-1 focus:ring-input-focus"
          placeholder="ملاحظات عن أداء الطالب في هذه الجلسة…"
        />
      </div>

      <div>
        <label htmlFor="homework" className="mb-1 block text-sm font-medium">
          الواجب
          <span className="mr-2 text-xs text-muted">Homework</span>
        </label>
        <textarea
          id="homework"
          value={homework}
          onChange={(e) => setHomework(e.target.value)}
          rows={3}
          className="w-full resize-none rounded-xl border border-input-border bg-input neu-inset px-4 py-2.5 text-foreground placeholder:text-muted/50 focus:border-input-focus focus:outline-none focus:ring-1 focus:ring-input-focus"
          placeholder="حفظ سورة الفاتحة، مراجعة أحكام النون الساكنة…"
        />
      </div>

      <button
        onClick={handleSave}
        disabled={saving}
        className="flex items-center gap-2 rounded-full bg-primary px-6 py-2.5 font-semibold text-white neu-btn transition-colors hover:bg-primary-hover disabled:opacity-50 focus-ring"
      >
        {saving ? (
          <span className="h-5 w-5 animate-spin rounded-full border-2 border-white/30 border-t-white" />
        ) : saved ? (
          <>
            <CheckCircle size={18} />
            تم الحفظ
          </>
        ) : (
          <>
            <Save size={18} />
            حفظ الملاحظات
          </>
        )}
      </button>
    </div>
  );
}
