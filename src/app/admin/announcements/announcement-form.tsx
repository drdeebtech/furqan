"use client";

import { useActionState } from "react";
import { CheckCircle, AlertCircle } from "lucide-react";
import { useLang } from "@/lib/i18n/context";
import type { SiteAnnouncement } from "@/types/database";
import {
  createAnnouncement,
  updateAnnouncement,
  type AnnouncementResult,
} from "./actions";

const initialState: AnnouncementResult = {};

function toLocalInputValue(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  const pad = (n: number) => n.toString().padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function AnnouncementForm({
  mode,
  announcement,
}: {
  mode: "create" | "edit";
  announcement?: SiteAnnouncement;
}) {
  const { t } = useLang();

  const action =
    mode === "edit" && announcement
      ? updateAnnouncement.bind(null, announcement.id)
      : createAnnouncement;

  const [state, formAction, pending] = useActionState(action, initialState);

  return (
    <form action={formAction} className="space-y-5 rounded-2xl border border-surface-border/60 bg-surface/40 p-6">
      <div className="grid gap-4 md:grid-cols-2">
        <div>
          <label htmlFor="message_ar" className="mb-1 block text-xs font-medium text-muted">
            {t("النص بالعربية", "Arabic message")} *
          </label>
          <textarea
            id="message_ar"
            name="message_ar"
            required
            rows={3}
            defaultValue={announcement?.message_ar ?? ""}
            className="glass-input w-full rounded-lg px-3 py-2 text-sm"
            dir="rtl"
          />
        </div>
        <div>
          <label htmlFor="message_en" className="mb-1 block text-xs font-medium text-muted">
            {t("النص بالإنجليزية", "English message")} *
          </label>
          <textarea
            id="message_en"
            name="message_en"
            required
            rows={3}
            defaultValue={announcement?.message_en ?? ""}
            className="glass-input w-full rounded-lg px-3 py-2 text-sm"
            dir="ltr"
          />
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        <div>
          <label htmlFor="severity" className="mb-1 block text-xs font-medium text-muted">
            {t("الدرجة", "Severity")} *
          </label>
          <select
            id="severity"
            name="severity"
            defaultValue={announcement?.severity ?? "info"}
            className="glass-input w-full rounded-lg px-3 py-2 text-sm"
          >
            <option value="info">{t("معلومات", "Info")}</option>
            <option value="warning">{t("تنبيه", "Warning")}</option>
            <option value="critical">{t("حرج", "Critical")}</option>
          </select>
        </div>
        <div>
          <label htmlFor="active_from" className="mb-1 block text-xs font-medium text-muted">
            {t("يبدأ", "Active from")} *
          </label>
          <input
            id="active_from"
            name="active_from"
            type="datetime-local"
            required
            defaultValue={toLocalInputValue(announcement?.active_from ?? new Date().toISOString())}
            className="glass-input w-full rounded-lg px-3 py-2 text-sm"
          />
        </div>
        <div>
          <label htmlFor="active_until" className="mb-1 block text-xs font-medium text-muted">
            {t("ينتهي (اختياري)", "Active until (optional)")}
          </label>
          <input
            id="active_until"
            name="active_until"
            type="datetime-local"
            defaultValue={toLocalInputValue(announcement?.active_until ?? null)}
            className="glass-input w-full rounded-lg px-3 py-2 text-sm"
          />
        </div>
      </div>

      <div className="flex items-center gap-2">
        <input
          type="checkbox"
          id="is_dismissible"
          name="is_dismissible"
          defaultChecked={announcement?.is_dismissible ?? true}
          className="h-4 w-4"
        />
        <label htmlFor="is_dismissible" className="text-sm text-foreground">
          {t("يمكن للزائر إخفاء الشريط", "User can dismiss the banner")}
        </label>
      </div>

      <fieldset className="rounded-lg border border-surface-border/60 p-4">
        <legend className="px-2 text-xs font-medium text-muted">
          {t("زر إجراء (اختياري — كل الحقول الثلاثة أو لا شيء)", "CTA button (optional — all 3 fields or none)")}
        </legend>
        <div className="grid gap-3 md:grid-cols-3">
          <div>
            <label htmlFor="cta_label_ar" className="mb-1 block text-xs text-muted">
              {t("نص الزر (عربي)", "Label (AR)")}
            </label>
            <input
              id="cta_label_ar"
              name="cta_label_ar"
              type="text"
              defaultValue={announcement?.cta_label_ar ?? ""}
              className="glass-input w-full rounded-lg px-3 py-1.5 text-sm"
            />
          </div>
          <div>
            <label htmlFor="cta_label_en" className="mb-1 block text-xs text-muted">
              {t("نص الزر (إنجليزي)", "Label (EN)")}
            </label>
            <input
              id="cta_label_en"
              name="cta_label_en"
              type="text"
              defaultValue={announcement?.cta_label_en ?? ""}
              className="glass-input w-full rounded-lg px-3 py-1.5 text-sm"
            />
          </div>
          <div>
            <label htmlFor="cta_href" className="mb-1 block text-xs text-muted">
              {t("الرابط", "Href")}
            </label>
            <input
              id="cta_href"
              name="cta_href"
              type="text"
              placeholder="/packages"
              defaultValue={announcement?.cta_href ?? ""}
              className="glass-input w-full rounded-lg px-3 py-1.5 text-sm"
            />
          </div>
        </div>
      </fieldset>

      <div className="flex items-center gap-3">
        <button
          type="submit"
          disabled={pending}
          className="glass-gold glass-pill px-6 py-2.5 text-sm font-semibold transition-colors hover:bg-gold-hover disabled:opacity-50"
        >
          {pending ? "…" : mode === "edit" ? t("حفظ", "Save") : t("إنشاء", "Create")}
        </button>
        {state.success && (
          <span className="flex items-center gap-1 text-sm text-emerald-400">
            <CheckCircle size={14} /> {state.success}
          </span>
        )}
        {state.error && (
          <span className="flex items-center gap-1 text-sm text-red-400">
            <AlertCircle size={14} /> {state.error}
          </span>
        )}
      </div>
    </form>
  );
}
