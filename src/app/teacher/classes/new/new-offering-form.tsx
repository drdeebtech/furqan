"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { createOffering } from "@/lib/actions/class-offerings";
import { useLang } from "@/lib/i18n/context";

const SESSION_TYPES = [
  { value: "hifz",     ar: "حفظ",       en: "Hifz" },
  { value: "muraja",   ar: "مراجعة",   en: "Review" },
  { value: "tajweed",  ar: "تجويد",    en: "Tajweed" },
  { value: "tilawa",   ar: "تلاوة",    en: "Tilawa" },
  { value: "qiraat",   ar: "قراءات",   en: "Qiraat" },
  { value: "tafsir",   ar: "تفسير",    en: "Tafsir" },
  { value: "combined", ar: "حفظ + مراجعة", en: "Hifz + Review" },
  { value: "other",    ar: "أخرى",     en: "Other" },
] as const;

export function NewOfferingForm() {
  const { t, lang } = useLang();
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function handleSubmit(formData: FormData) {
    setError(null);
    const title = (formData.get("title") as string)?.trim() ?? "";
    const description = (formData.get("description") as string)?.trim() || null;
    const scheduled_at = formData.get("scheduled_at") as string;
    const duration_min = Number(formData.get("duration_min"));
    const session_type = formData.get("session_type") as string;
    const capacity = Number(formData.get("capacity"));
    const price_usd = Number(formData.get("price_usd"));

    startTransition(async () => {
      const res = await createOffering({
        title, description,
        scheduled_at: new Date(scheduled_at).toISOString(),
        duration_min, session_type, capacity, price_usd,
      });
      if (!res || "error" in res) {
        setError(res?.error ?? t("حدث خطأ غير معروف", "Unknown error"));
        return;
      }
      router.push("/teacher/classes");
      router.refresh();
    });
  }

  return (
    <form action={handleSubmit} className="glass-card space-y-4 p-6">
      <div>
        <label htmlFor="title" className="mb-1 block text-xs font-medium text-muted">
          {t("العنوان", "Title")} *
        </label>
        <input
          id="title"
          name="title"
          required
          maxLength={200}
          className="glass-input w-full rounded-xl px-3 py-2 text-sm"
          placeholder={t("مثال: مجموعة تجويد للمبتدئين", "e.g. Tajweed beginners group")}
        />
      </div>

      <div>
        <label htmlFor="description" className="mb-1 block text-xs font-medium text-muted">
          {t("الوصف", "Description")}
        </label>
        <textarea
          id="description"
          name="description"
          rows={3}
          className="glass-input w-full rounded-xl px-3 py-2 text-sm"
          placeholder={t("ما الذي ستغطيه الجلسة؟", "What will the class cover?")}
        />
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div>
          <label htmlFor="scheduled_at" className="mb-1 block text-xs font-medium text-muted">
            {t("الوقت", "When")} *
          </label>
          <input
            id="scheduled_at"
            name="scheduled_at"
            type="datetime-local"
            required
            className="glass-input w-full rounded-xl px-3 py-2 text-sm"
          />
        </div>
        <div>
          <label htmlFor="duration_min" className="mb-1 block text-xs font-medium text-muted">
            {t("المدة (دقيقة)", "Duration (min)")} *
          </label>
          <input
            id="duration_min"
            name="duration_min"
            type="number"
            min={15}
            max={240}
            defaultValue={60}
            required
            className="glass-input w-full rounded-xl px-3 py-2 text-sm"
          />
        </div>
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <div>
          <label htmlFor="session_type" className="mb-1 block text-xs font-medium text-muted">
            {t("النوع", "Type")} *
          </label>
          <select
            id="session_type"
            name="session_type"
            required
            className="glass-input w-full rounded-xl px-3 py-2 text-sm"
            defaultValue="tajweed"
          >
            {SESSION_TYPES.map((s) => (
              <option key={s.value} value={s.value}>{lang === "ar" ? s.ar : s.en}</option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor="capacity" className="mb-1 block text-xs font-medium text-muted">
            {t("السعة", "Capacity")} *
          </label>
          <input
            id="capacity"
            name="capacity"
            type="number"
            min={2}
            max={20}
            defaultValue={5}
            required
            className="glass-input w-full rounded-xl px-3 py-2 text-sm"
          />
        </div>
        <div>
          <label htmlFor="price_usd" className="mb-1 block text-xs font-medium text-muted">
            {t("السعر (USD)", "Price (USD)")} *
          </label>
          <input
            id="price_usd"
            name="price_usd"
            type="number"
            min={0}
            step={0.5}
            defaultValue={20}
            required
            className="glass-input w-full rounded-xl px-3 py-2 text-sm"
          />
        </div>
      </div>

      {error && (
        <p role="alert" className="text-xs text-red-400">{error}</p>
      )}

      <div className="flex justify-end gap-3 pt-2">
        <button
          type="submit"
          disabled={isPending}
          className="glass-gold glass-pill px-6 py-2 text-sm font-medium text-white disabled:opacity-50"
        >
          {isPending ? t("جاري النشر…", "Publishing…") : t("نشر الجلسة", "Publish class")}
        </button>
      </div>
    </form>
  );
}
