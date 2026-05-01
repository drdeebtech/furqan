"use client";

import { useState } from "react";
import { Plus, BookOpen, CheckCircle } from "lucide-react";
import { useLang } from "@/lib/i18n/context";
import { createHomework } from "@/lib/actions/homework";
import { HOMEWORK_TYPE_AR, HOMEWORK_STATUS_STYLE } from "@/lib/constants";
import type { HomeworkType, HomeworkAssignment } from "@/types/database";

const QURAN_TYPES: HomeworkType[] = ["hifz", "muraja", "recitation", "tajweed"];

interface Props {
  bookingId: string;
  studentId: string;
  /** Optional: scope this homework to a specific session for back-references */
  sessionId?: string | null;
  /** Optional: render existing homework rows above the create form */
  existingAssignments?: HomeworkAssignment[];
  /** Optional: hide the section header (caller already shows context) */
  hideHeader?: boolean;
  /** Optional: start with the form open (skips the "+ Add" toggle) */
  defaultOpen?: boolean;
}

export function HomeworkAssignmentForm({
  bookingId,
  studentId,
  sessionId = null,
  existingAssignments = [],
  hideHeader = false,
  defaultOpen = false,
}: Props) {
  const { t } = useLang();
  const [showHwForm, setShowHwForm] = useState(defaultOpen);
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

  async function handleCreateHomework() {
    if (!hwTitle.trim()) {
      setHwError(t("عنوان الواجب مطلوب", "Homework title is required"));
      return;
    }
    setHwSaving(true);
    setHwError(null);

    const fd = new FormData();
    fd.set("booking_id", bookingId);
    fd.set("student_id", studentId);
    if (sessionId) fd.set("session_id", sessionId);
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
      setHwTitle("");
      setHwDesc("");
      setSurahNum("");
      setAyahStart("");
      setAyahEnd("");
      setPagesCount("");
      setDueDate("");
      setTimeout(() => {
        setHwSuccess(false);
        if (!defaultOpen) setShowHwForm(false);
      }, 2000);
    }
    setHwSaving(false);
  }

  const showQuranFields = QURAN_TYPES.includes(hwType);

  return (
    <div className="space-y-4">
      {!hideHeader && (
        <div className="mb-2 flex items-center justify-between">
          <h3 className="text-base font-semibold">
            <BookOpen size={18} className="ms-2 inline text-gold" />
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
      )}

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
                  <span className="me-2 text-sm font-medium">{a.title}</span>
                  <span className="text-xs text-muted">
                    {HOMEWORK_TYPE_AR[a.homework_type]}
                  </span>
                  {a.surah_number && (
                    <span className="me-1 text-xs text-muted">
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

      {showHwForm && (
        <div className="glass-card space-y-4 p-5">
          {hwError && (
            <div className="rounded-xl border border-error/30 bg-error/10 p-2 text-sm text-error">
              {hwError}
            </div>
          )}
          {hwSuccess && (
            <div className="rounded-xl border border-success/30 bg-success/10 p-2 text-sm text-success">
              <CheckCircle size={14} className="ms-1 inline" />
              {t("تم إنشاء الواجب بنجاح", "Homework created successfully")}
            </div>
          )}

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
            {!defaultOpen && (
              <button
                onClick={() => { setShowHwForm(false); setHwError(null); }}
                className="glass-pill px-4 py-2 text-sm text-muted transition-colors hover:text-foreground"
              >
                {t("إلغاء", "Cancel")}
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
