"use client";

import { useActionState } from "react";
import { useLang } from "@/lib/i18n/context";
import { ActionFeedback } from "@/components/shared/action-feedback";
import type { Testimonial } from "@/types/database";
import { createTestimonial, updateTestimonial, type TestimonialResult } from "./actions";

const initialState: TestimonialResult = {};

export function TestimonialForm({
  mode,
  testimonial,
}: {
  mode: "create" | "edit";
  testimonial?: Testimonial;
}) {
  const { t } = useLang();

  const action =
    mode === "edit" && testimonial
      ? updateTestimonial.bind(null, testimonial.id)
      : createTestimonial;

  const [state, formAction, pending] = useActionState(action, initialState);

  return (
    <form action={formAction} className="space-y-5 rounded-2xl border border-surface-border/60 bg-surface/40 p-6">
      <div className="grid gap-4 md:grid-cols-2">
        <div>
          <label htmlFor="author_name" className="mb-1 block text-xs font-medium text-muted">
            {t("اسم صاحب الرأي", "Author name")} *
          </label>
          <input
            id="author_name"
            name="author_name"
            type="text"
            required
            maxLength={120}
            defaultValue={testimonial?.author_name ?? ""}
            className="glass-input w-full rounded-lg px-3 py-2 text-sm"
          />
        </div>
        <div>
          <label htmlFor="author_location" className="mb-1 block text-xs font-medium text-muted">
            {t("الموقع (اختياري)", "Location (optional)")}
          </label>
          <input
            id="author_location"
            name="author_location"
            type="text"
            maxLength={120}
            placeholder={t("لندن، المملكة المتحدة", "London, UK")}
            defaultValue={testimonial?.author_location ?? ""}
            className="glass-input w-full rounded-lg px-3 py-2 text-sm"
          />
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <div>
          <label htmlFor="quote_ar" className="mb-1 block text-xs font-medium text-muted">
            {t("النص بالعربية", "Quote (Arabic)")} *
          </label>
          <textarea
            id="quote_ar"
            name="quote_ar"
            required
            rows={4}
            maxLength={1000}
            defaultValue={testimonial?.quote_ar ?? ""}
            className="glass-input w-full rounded-lg px-3 py-2 text-sm"
            dir="rtl"
          />
        </div>
        <div>
          <label htmlFor="quote_en" className="mb-1 block text-xs font-medium text-muted">
            {t("النص بالإنجليزية (اختياري)", "Quote (English, optional)")}
          </label>
          <textarea
            id="quote_en"
            name="quote_en"
            rows={4}
            maxLength={1000}
            defaultValue={testimonial?.quote_en ?? ""}
            className="glass-input w-full rounded-lg px-3 py-2 text-sm"
            dir="ltr"
          />
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <div>
          <label htmlFor="display_order" className="mb-1 block text-xs font-medium text-muted">
            {t("ترتيب العرض", "Display order")}
          </label>
          <input
            id="display_order"
            name="display_order"
            type="number"
            min={0}
            max={9999}
            defaultValue={testimonial?.display_order ?? 0}
            className="glass-input w-32 rounded-lg px-3 py-2 text-sm"
          />
        </div>
        <div className="flex items-end gap-2 pb-2">
          <input
            type="checkbox"
            id="is_published"
            name="is_published"
            defaultChecked={testimonial?.is_published ?? false}
            className="h-4 w-4"
          />
          <label htmlFor="is_published" className="text-sm text-foreground">
            {t("منشور (يظهر للزوار)", "Published (visible to visitors)")}
          </label>
        </div>
      </div>

      <div className="flex items-center gap-3">
        <button
          type="submit"
          disabled={pending}
          className="glass-gold glass-pill px-6 py-2.5 text-sm font-semibold transition-colors hover:bg-gold-hover disabled:opacity-50"
        >
          {pending ? "…" : mode === "edit" ? t("حفظ", "Save") : t("إنشاء", "Create")}
        </button>
      </div>
      <ActionFeedback state={state} />
    </form>
  );
}
