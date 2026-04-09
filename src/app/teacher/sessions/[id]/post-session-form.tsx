"use client";

import { useState } from "react";
import { CheckCircle, Save, Plus, BookOpen } from "lucide-react";
import { savePostSessionNotes } from "./actions";
import { createHomework } from "@/lib/actions/homework";
import { EvalForm } from "@/app/teacher/students/[studentId]/eval-form";
import { HOMEWORK_TYPE_AR, HOMEWORK_STATUS_STYLE } from "@/lib/constants";
import type { HomeworkType, HomeworkAssignment } from "@/types/database";
import { useLang } from "@/lib/i18n/context";

const QURAN_TYPES: HomeworkType[] = ["hifz", "muraja", "recitation", "tajweed"];

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

  // Structured homework form state
  const [showHwForm, setShowHwForm] = useState(false);
  const [hwType, setHwType] = useState<HomeworkType>("hifz");
  const [hwTitle, setHwTitle] = useState("");
  const [hwDesc, setHwDesc] = useState("");
  const [surahNum, setSurahNum] = useState("");
  const [ayahStart, setAyahStart] = useState("");
  const [ayahEnd, setAyahEnd] = useState("");
  const [pagesCount, setPagesCount] = useState("");
  const [dueDate, setDueDate] = useState("");
  const [hwSaving, setHwSaving] = useState(false);
  const [hwSuccess, setHwSuccess] = useState(false);
  const [hwError, setHwError] = useState<string | null>(null);

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

  async function handleCreateHomework() {
    if (!hwTitle.trim()) {
      setHwError("عنوان الواجب مطلوب");
      return;
    }
    setHwSaving(true);
    setHwError(null);

    const fd = new FormData();
    fd.set("booking_id", bookingId);
    fd.set("student_id", studentId);
    fd.set("session_id", sessionId);
    fd.set("homework_type", hwType);
    fd.set("title", hwTitle.trim());
    if (hwDesc.trim()) fd.set("description", hwDesc.trim());
    if (surahNum) fd.set("surah_number", surahNum);
    if (ayahStart) fd.set("ayah_start", ayahStart);
    if (ayahEnd) fd.set("ayah_end", ayahEnd);
    if (pagesCount) fd.set("pages_count", pagesCount);
    if (dueDate) fd.set("due_date", dueDate);

    const result = await createHomework(fd);
    if ("error" in result && result.error) {
      setHwError(result.error);
    } else {
      setHwSuccess(true);
      // Reset form
      setHwTitle("");
      setHwDesc("");
      setSurahNum("");
      setAyahStart("");
      setAyahEnd("");
      setPagesCount("");
      setDueDate("");
      setTimeout(() => { setHwSuccess(false); setShowHwForm(false); }, 2000);
    }
    setHwSaving(false);
  }

  const showQuranFields = QURAN_TYPES.includes(hwType);

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
          <span className="mr-2 text-xs text-muted">Session notes</span>
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
          <span className="mr-2 text-xs text-muted">Quick notes</span>
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

      {/* ── Structured Homework Section ── */}
      <div className="border-t border-white/10 pt-6">
        <div className="mb-4 flex items-center justify-between">
          <h3 className="text-base font-semibold">
            <BookOpen size={18} className="ml-2 inline text-gold" />
            {t("الواجبات المهيكلة", "Structured Homework")}
          </h3>
          {!showHwForm && (
            <button
              onClick={() => setShowHwForm(true)}
              className="glass-pill flex items-center gap-1 bg-gold/10 px-3 py-1.5 text-sm text-gold transition-colors hover:bg-gold/20"
            >
              <Plus size={14} />
              {t("إضافة واجب", "Add homework")}
            </button>
          )}
        </div>

        {/* Existing structured assignments */}
        {existingAssignments.length > 0 && (
          <div className="mb-4 space-y-2">
            {existingAssignments.map((a) => {
              const style = HOMEWORK_STATUS_STYLE[a.status];
              return (
                <div key={a.id} className="glass-card flex items-center justify-between p-3">
                  <div>
                    <span className={`rounded-full border px-2 py-0.5 text-xs ${style.className}`}>
                      {style.label}
                    </span>
                    <span className="mr-2 text-sm font-medium">{a.title}</span>
                    <span className="text-xs text-muted">
                      {HOMEWORK_TYPE_AR[a.homework_type]}
                    </span>
                    {a.surah_number && (
                      <span className="mr-1 text-xs text-muted">
                        · {t("سورة", "Surah")} {a.surah_number}
                        {a.ayah_start && ` (${a.ayah_start}${a.ayah_end ? `-${a.ayah_end}` : ""})`}
                      </span>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {/* Create homework form */}
        {showHwForm && (
          <div className="glass-card space-y-4 p-5">
            {hwError && (
              <div className="rounded-xl border border-error/30 bg-error/10 p-2 text-sm text-error">
                {hwError}
              </div>
            )}
            {hwSuccess && (
              <div className="rounded-xl border border-success/30 bg-success/10 p-2 text-sm text-success">
                {t("تم إنشاء الواجب بنجاح", "Homework created successfully")}
              </div>
            )}

            {/* Homework type */}
            <div>
              <label className="mb-1 block text-sm font-medium">{t("نوع الواجب", "Type")}</label>
              <select
                value={hwType}
                onChange={(e) => setHwType(e.target.value as HomeworkType)}
                className="glass-input w-full px-4 py-2.5 focus:border-input-focus focus:outline-none focus:ring-1 focus:ring-input-focus"
              >
                {(Object.entries(HOMEWORK_TYPE_AR) as [HomeworkType, string][]).map(([k, v]) => (
                  <option key={k} value={k}>{v}</option>
                ))}
              </select>
            </div>

            {/* Title */}
            <div>
              <label className="mb-1 block text-sm font-medium">{t("العنوان", "Title")} *</label>
              <input
                type="text"
                value={hwTitle}
                onChange={(e) => setHwTitle(e.target.value)}
                className="glass-input w-full px-4 py-2.5 focus:border-input-focus focus:outline-none focus:ring-1 focus:ring-input-focus"
                placeholder={t("مثال: حفظ الآيات 1-5 من سورة البقرة", "e.g. Memorize ayahs 1-5 of Al-Baqarah")}
              />
            </div>

            {/* Description */}
            <div>
              <label className="mb-1 block text-sm font-medium">{t("الوصف", "Description")}</label>
              <textarea
                value={hwDesc}
                onChange={(e) => setHwDesc(e.target.value)}
                rows={2}
                className="glass-input w-full resize-none px-4 py-2.5 focus:border-input-focus focus:outline-none focus:ring-1 focus:ring-input-focus"
                placeholder={t("تفاصيل إضافية (اختياري)…", "Additional details (optional)...")}
              />
            </div>

            {/* Quran-specific fields */}
            {showQuranFields && (
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                <div>
                  <label className="mb-1 block text-xs text-muted">{t("رقم السورة", "Surah #")}</label>
                  <input
                    type="number"
                    min={1}
                    max={114}
                    value={surahNum}
                    onChange={(e) => setSurahNum(e.target.value)}
                    className="glass-input w-full px-3 py-2 text-sm focus:border-input-focus focus:outline-none focus:ring-1 focus:ring-input-focus"
                    placeholder="1-114"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-xs text-muted">{t("من آية", "From ayah")}</label>
                  <input
                    type="number"
                    min={1}
                    value={ayahStart}
                    onChange={(e) => setAyahStart(e.target.value)}
                    className="glass-input w-full px-3 py-2 text-sm focus:border-input-focus focus:outline-none focus:ring-1 focus:ring-input-focus"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-xs text-muted">{t("إلى آية", "To ayah")}</label>
                  <input
                    type="number"
                    min={1}
                    value={ayahEnd}
                    onChange={(e) => setAyahEnd(e.target.value)}
                    className="glass-input w-full px-3 py-2 text-sm focus:border-input-focus focus:outline-none focus:ring-1 focus:ring-input-focus"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-xs text-muted">{t("عدد الصفحات", "Pages")}</label>
                  <input
                    type="number"
                    min={1}
                    value={pagesCount}
                    onChange={(e) => setPagesCount(e.target.value)}
                    className="glass-input w-full px-3 py-2 text-sm focus:border-input-focus focus:outline-none focus:ring-1 focus:ring-input-focus"
                  />
                </div>
              </div>
            )}

            {/* Due date */}
            <div>
              <label className="mb-1 block text-sm font-medium">{t("تاريخ الاستحقاق", "Due date")}</label>
              <input
                type="date"
                value={dueDate}
                onChange={(e) => setDueDate(e.target.value)}
                className="glass-input w-full px-4 py-2.5 focus:border-input-focus focus:outline-none focus:ring-1 focus:ring-input-focus"
              />
            </div>

            <div className="flex gap-2">
              <button
                onClick={handleCreateHomework}
                disabled={hwSaving}
                className="glass-gold glass-pill flex items-center gap-2 px-5 py-2 text-sm font-semibold transition-colors hover:bg-primary-hover disabled:opacity-50 focus-ring"
              >
                {hwSaving ? (
                  <span className="h-4 w-4 animate-spin rounded-full border-2 border-white/30 border-t-white" />
                ) : (
                  <Plus size={16} />
                )}
                {t("إنشاء الواجب", "Create homework")}
              </button>
              <button
                onClick={() => { setShowHwForm(false); setHwError(null); }}
                className="glass-pill px-4 py-2 text-sm text-muted transition-colors hover:text-foreground"
              >
                {t("إلغاء", "Cancel")}
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Quick Evaluation */}
      <div className="border-t border-white/10 pt-6">
        <p className="mb-3 text-sm text-muted">{t("هل تريد تقييم الطالب بعد هذه الجلسة؟", "Evaluate student after session?")}</p>
        <EvalForm studentId={studentId} studentName={studentName} compact />
      </div>
    </div>
  );
}
