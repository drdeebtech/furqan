"use client";

import { useActionState, useRef, useState } from "react";
import { Upload, FileUp, AlertCircle, X } from "lucide-react";
import { useLang } from "@/lib/i18n/context";
import {
  uploadTeacherResourceAction,
  type TeacherResourceFormState,
} from "./actions";

const initialState: TeacherResourceFormState = {};

const MAX_BYTES = 50 * 1024 * 1024;

const CATEGORIES: { value: string; ar: string; en: string }[] = [
  { value: "general", ar: "عام", en: "General" },
  { value: "tajweed", ar: "تجويد", en: "Tajweed" },
  { value: "hifz", ar: "حفظ", en: "Hifz" },
  { value: "tilawa", ar: "تلاوة", en: "Recitation" },
  { value: "ijazah", ar: "تحضير الإجازة", en: "Ijazah prep" },
  { value: "tafsir", ar: "تفسير", en: "Tafsir" },
  { value: "worksheet", ar: "أوراق عمل", en: "Worksheet" },
];

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

export function UploadResourceForm() {
  const { t } = useLang();
  const [state, formAction, isPending] = useActionState(
    uploadTeacherResourceAction,
    initialState,
  );

  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [pickedFile, setPickedFile] = useState<File | null>(null);
  const [clientError, setClientError] = useState<string | null>(null);

  function onPick(file: File | null) {
    setClientError(null);
    if (!file) {
      setPickedFile(null);
      return;
    }
    if (file.size > MAX_BYTES) {
      setClientError(
        t(
          `الملف أكبر من الحد المسموح (50 ميغابايت). الحجم الحالي: ${formatBytes(file.size)}`,
          `File exceeds the 50 MB cap. Current size: ${formatBytes(file.size)}`,
        ),
      );
      // Clear the input so the form action receives no file.
      if (fileInputRef.current) fileInputRef.current.value = "";
      setPickedFile(null);
      return;
    }
    setPickedFile(file);
  }

  function clearFile() {
    setPickedFile(null);
    setClientError(null);
    if (fileInputRef.current) fileInputRef.current.value = "";
  }

  return (
    <form
      action={formAction}
      encType="multipart/form-data"
      className="glass-card space-y-4 p-4 sm:p-5"
    >
      <h2 className="font-display text-base font-semibold">
        {t("رفع مصدر جديد", "Upload a new resource")}
      </h2>

      {(state.error || clientError) && (
        <div
          role="alert"
          className="flex items-start gap-2 rounded-xl border border-error/30 bg-error/10 p-2 text-sm text-error"
        >
          <AlertCircle size={14} className="mt-0.5 shrink-0" aria-hidden="true" />
          <span>{state.error ?? clientError}</span>
        </div>
      )}
      {state.ok && (
        <div
          role="status"
          className="rounded-xl border border-success/30 bg-success/10 p-2 text-sm text-success"
        >
          {t("تم الرفع — أسنده لطالب من القائمة أدناه.", "Uploaded — assign it to a student from the list below.")}
        </div>
      )}

      <div className="grid gap-3 sm:grid-cols-2">
        <label className="flex flex-col gap-1 text-sm">
          <span className="text-muted">{t("العنوان", "Title")}</span>
          <input
            name="title_ar"
            required
            className="glass-input px-3 py-2 text-sm"
            placeholder={t("مثال: دليل أحكام التجويد", "e.g. Tajweed rules guide")}
          />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          <span className="text-muted">{t("النوع", "Type")}</span>
          <select
            name="resource_type"
            required
            className="glass-input px-3 py-2 text-sm"
            defaultValue="pdf"
          >
            <option value="pdf">PDF</option>
            <option value="audio">{t("صوت", "Audio")}</option>
            <option value="video">{t("فيديو", "Video")}</option>
            <option value="image">{t("صورة", "Image")}</option>
            <option value="link">{t("رابط خارجي", "External link")}</option>
          </select>
        </label>
      </div>

      <label className="flex flex-col gap-1 text-sm">
        <span className="text-muted">{t("التصنيف", "Category")}</span>
        <select
          name="category"
          className="glass-input px-3 py-2 text-sm"
          defaultValue="general"
        >
          {CATEGORIES.map((c) => (
            <option key={c.value} value={c.value}>
              {t(c.ar, c.en)}
            </option>
          ))}
        </select>
      </label>

      <label className="flex flex-col gap-1 text-sm">
        <span className="text-muted">
          {t("وصف موجز (اختياري)", "Short description (optional)")}
        </span>
        <textarea
          name="description_ar"
          rows={4}
          className="glass-input px-3 py-2 text-sm"
        />
      </label>

      <div className="grid gap-3 sm:grid-cols-2">
        <div className="flex flex-col gap-1 text-sm">
          <span className="text-muted">
            {t("ملف (حد أقصى 50 ميغا)", "File (max 50 MB)")}
          </span>
          {/* Styled drop-zone replaces the bare native input. The native
              input stays in the DOM (hidden) so form-submit picks up the
              File. Size is checked client-side before the form submits. */}
          <label
            className={`group relative flex min-h-[100px] cursor-pointer flex-col items-center justify-center gap-1 rounded-xl border border-dashed px-4 py-3 text-center transition-colors ${
              pickedFile
                ? "border-gold/50 bg-gold/5"
                : "border-card-border bg-card/30 hover:border-gold/40 hover:bg-card/50"
            }`}
          >
            <input
              ref={fileInputRef}
              name="file"
              type="file"
              accept=".pdf,audio/*,video/*,image/*"
              onChange={(e) => onPick(e.target.files?.[0] ?? null)}
              className="sr-only"
            />
            {pickedFile ? (
              <>
                <span className="inline-flex items-center gap-1 text-sm font-medium text-gold">
                  <FileUp size={14} aria-hidden="true" />
                  {pickedFile.name}
                </span>
                <span className="text-xs text-muted-light">
                  {formatBytes(pickedFile.size)}
                </span>
                <button
                  type="button"
                  onClick={(e) => {
                    e.preventDefault();
                    clearFile();
                  }}
                  className="absolute end-2 top-2 rounded-full p-1 text-muted-light hover:bg-card hover:text-foreground focus-ring"
                  aria-label={t("إزالة الملف", "Remove file")}
                >
                  <X size={12} aria-hidden="true" />
                </button>
              </>
            ) : (
              <>
                <FileUp
                  size={20}
                  className="text-muted-light group-hover:text-gold"
                  aria-hidden="true"
                />
                <span className="text-sm text-muted">
                  {t("اضغط لاختيار ملف", "Click to select a file")}
                </span>
                <span className="text-xs text-muted-light">
                  {t("PDF · صوت · فيديو · صورة", "PDF · audio · video · image")}
                </span>
              </>
            )}
          </label>
        </div>
        <label className="flex flex-col gap-1 text-sm">
          <span className="text-muted">
            {t("أو رابط خارجي", "Or external URL")}
          </span>
          <input
            name="external_url"
            type="url"
            className="glass-input px-3 py-2 text-sm"
            placeholder="https://..."
          />
        </label>
      </div>

      <button
        type="submit"
        disabled={isPending}
        className="glass-gold glass-pill inline-flex min-h-[40px] items-center gap-2 px-4 py-2 text-sm font-semibold disabled:opacity-50 focus-ring"
      >
        <Upload size={14} aria-hidden="true" />
        {isPending ? t("جارٍ الرفع…", "Uploading…") : t("رفع", "Upload")}
      </button>
    </form>
  );
}
