"use client";

import { useActionState } from "react";
import { Upload } from "lucide-react";
import { useLang } from "@/lib/i18n/context";
import {
  uploadTeacherResourceAction,
  type TeacherResourceFormState,
} from "./actions";

const initialState: TeacherResourceFormState = {};

export function UploadResourceForm() {
  const { t } = useLang();
  const [state, formAction, isPending] = useActionState(
    uploadTeacherResourceAction,
    initialState,
  );

  return (
    <form
      action={formAction}
      encType="multipart/form-data"
      className="glass-card space-y-3 p-4 sm:p-5"
    >
      <h2 className="font-display text-base font-semibold">
        {t("رفع مصدر جديد", "Upload a new resource")}
      </h2>

      {state.error && (
        <div
          role="alert"
          className="rounded-xl border border-error/30 bg-error/10 p-2 text-sm text-error"
        >
          {state.error}
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
        <span className="text-muted">
          {t("وصف موجز (اختياري)", "Short description (optional)")}
        </span>
        <textarea
          name="description_ar"
          rows={2}
          className="glass-input px-3 py-2 text-sm"
        />
      </label>

      <div className="grid gap-3 sm:grid-cols-2">
        <label className="flex flex-col gap-1 text-sm">
          <span className="text-muted">
            {t("ملف (حد أقصى 50 ميغا)", "File (max 50 MB)")}
          </span>
          <input
            name="file"
            type="file"
            accept=".pdf,audio/*,video/*,image/*"
            className="glass-input px-3 py-2 text-sm"
          />
        </label>
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

      <input
        name="category"
        type="hidden"
        defaultValue="general"
      />

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
