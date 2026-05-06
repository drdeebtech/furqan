"use client";

import { useActionState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { useLang } from "@/lib/i18n/context";
import { useToast } from "@/components/shared/toast";
import { createHalaqa, type CreateHalaqaState } from "../actions";

interface TeacherOption {
  id: string;
  full_name: string | null;
}

interface Props {
  teachers: TeacherOption[];
}

const initialState: CreateHalaqaState = {};
const inputClass =
  "glass-input w-full rounded-xl px-4 py-2.5 text-sm text-foreground placeholder:text-muted/50 focus:border-gold focus:outline-none focus:ring-1 focus:ring-gold";

export function HalaqaForm({ teachers }: Props) {
  const { t, dir, lang } = useLang();
  const router = useRouter();
  const toast = useToast();
  const [state, action, pending] = useActionState(createHalaqa, initialState);

  useEffect(() => {
    if (state.ok && state.id) {
      toast.success(t("تم إنشاء الحلقة", "Halaqa created"));
      router.push(`/admin/sessions/${state.id}`);
    } else if (state.error) {
      toast.error(state.error);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state]);

  if (teachers.length === 0) {
    return (
      <div className="glass-card rounded-xl p-8 text-center">
        <p className="text-muted">
          {t(
            "لا يوجد معلمون معتمدون يقبلون التدريس. اعتمد معلماً أولاً قبل إنشاء حلقة.",
            "No approved + accepting teachers. Approve a teacher first before creating a halaqa.",
          )}
        </p>
      </div>
    );
  }

  return (
    <form action={action} className="glass-card mt-6 space-y-5 rounded-xl p-6">
      {state.error ? (
        <div className="rounded-lg border border-error/30 bg-error/10 p-3 text-sm text-error">
          {state.error}
        </div>
      ) : null}

      <div>
        <label htmlFor="teacher_id" className="mb-1 block text-sm font-medium">
          {t("المعلم", "Teacher")}
        </label>
        <select id="teacher_id" name="teacher_id" required className={inputClass}>
          <option value="">{t("اختر معلماً", "Select a teacher")}</option>
          {teachers.map((teacher) => (
            <option key={teacher.id} value={teacher.id}>
              {teacher.full_name ?? t("معلم", "Teacher")}
            </option>
          ))}
        </select>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <div>
          <label htmlFor="title_ar" className="mb-1 block text-sm font-medium">
            {t("العنوان (عربي)", "Title (Arabic)")}
          </label>
          <input
            id="title_ar"
            name="title_ar"
            type="text"
            required
            className={inputClass}
            placeholder={t("حلقة حفص للمبتدئين", "Hafs Halaqa for Beginners")}
          />
        </div>
        <div>
          <label htmlFor="title_en" className="mb-1 block text-sm font-medium">
            {t("العنوان (إنجليزي)", "Title (English)")}
          </label>
          <input
            id="title_en"
            name="title_en"
            type="text"
            required
            className={inputClass}
            placeholder="Hafs Halaqa for Beginners"
          />
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <div>
          <label htmlFor="surah_reference" className="mb-1 block text-sm font-medium">
            {t("السورة", "Surah")}
            <span className="ms-1 text-xs text-muted">({t("اختياري", "optional")})</span>
          </label>
          <input
            id="surah_reference"
            name="surah_reference"
            type="text"
            className={inputClass}
            placeholder={t("البقرة", "Al-Baqarah")}
          />
        </div>
        <div>
          <label htmlFor="ayah_range" className="mb-1 block text-sm font-medium">
            {t("نطاق الآيات", "Ayah Range")}
            <span className="ms-1 text-xs text-muted">({t("اختياري", "optional")})</span>
          </label>
          <input
            id="ayah_range"
            name="ayah_range"
            type="text"
            className={inputClass}
            placeholder="1-50"
            dir="ltr"
          />
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <div>
          <label htmlFor="scheduled_at" className="mb-1 block text-sm font-medium">
            {t("الموعد", "Scheduled Time")}
          </label>
          <input
            id="scheduled_at"
            name="scheduled_at"
            type="datetime-local"
            required
            className={`${inputClass} ${lang === "ar" ? "" : "ltr-input"}`}
            dir="ltr"
          />
        </div>
        <div>
          <label htmlFor="duration_min" className="mb-1 block text-sm font-medium">
            {t("المدة (دقيقة)", "Duration (minutes)")}
          </label>
          <input
            id="duration_min"
            name="duration_min"
            type="number"
            min={15}
            max={240}
            defaultValue={60}
            required
            className={inputClass}
          />
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <div>
          <label htmlFor="capacity" className="mb-1 block text-sm font-medium">
            {t("السعة (الحد الأقصى)", "Capacity (max students)")}
          </label>
          <input
            id="capacity"
            name="capacity"
            type="number"
            min={2}
            max={15}
            defaultValue={10}
            required
            className={inputClass}
          />
        </div>
        <div>
          <label htmlFor="min_participants" className="mb-1 block text-sm font-medium">
            {t("الحد الأدنى", "Minimum students")}
          </label>
          <input
            id="min_participants"
            name="min_participants"
            type="number"
            min={1}
            max={15}
            defaultValue={3}
            required
            className={inputClass}
          />
        </div>
      </div>

      <div>
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            name="allow_recording"
            className="h-4 w-4 rounded border-card-border bg-transparent text-gold focus:ring-gold"
          />
          {t("السماح بتسجيل الحلقة", "Allow recording")}
        </label>
        <p className="ms-6 mt-1 text-xs text-muted">
          {t(
            "يحفظ التسجيل في Daily.co cloud (تكلفة إضافية).",
            "Recording stored in Daily.co cloud (additional cost applies).",
          )}
        </p>
      </div>

      <div className="flex items-center justify-end gap-3 border-t border-card-border pt-4">
        <button
          type="submit"
          disabled={pending}
          className="glass-gold glass-pill px-6 py-2.5 text-sm font-semibold transition-colors disabled:opacity-50"
        >
          {pending ? t("جاري الحفظ...", "Saving…") : t("إنشاء الحلقة", "Create Halaqa")}
        </button>
      </div>
    </form>
  );
}
