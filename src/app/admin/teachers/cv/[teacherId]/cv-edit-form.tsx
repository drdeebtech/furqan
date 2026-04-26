"use client";

import { useActionState } from "react";
import { Save } from "lucide-react";
import { saveCvAsAdmin, type AdminCvSaveResult } from "./actions";
import { ActionFeedback } from "@/components/shared/action-feedback";
import { CheckboxGroup } from "@/components/shared/checkbox-group";
import { TEACHER_LANGUAGES, TEACHER_RECITATIONS, TEACHER_SPECIALTIES } from "@/lib/constants";

interface CvEditFormProps {
  teacherId: string;
  bio: string;
  bioEn: string;
  specialties: string[];
  languages: string[];
  recitationStandards: string[];
  introVideoUrl: string;
}

export function CvEditForm({
  teacherId,
  bio,
  bioEn,
  specialties,
  languages,
  recitationStandards,
  introVideoUrl,
}: CvEditFormProps) {
  const boundAction = saveCvAsAdmin.bind(null, teacherId);
  const [state, formAction, pending] = useActionState<AdminCvSaveResult, FormData>(
    boundAction,
    {},
  );

  return (
    <div className="glass-card p-6">
      <h2 className="mb-4 text-lg font-semibold">
        تعديل السيرة الذاتية
        <span className="me-2 text-sm font-normal text-muted">Edit CV</span>
      </h2>

      <ActionFeedback
        state={state.success ? { success: "تم حفظ التعديلات بنجاح" } : state}
      />


      <form action={formAction} className="space-y-5">
        <div>
          <label htmlFor="bio" className="mb-1 block text-sm font-medium">
            نبذة تعريفية (عربي)
            <span className="me-2 text-xs text-muted">Bio (Arabic)</span>
          </label>
          <textarea
            id="bio"
            name="bio"
            rows={5}
            dir="rtl"
            defaultValue={bio}
            className="glass-input w-full px-4 py-2.5 text-foreground focus:border-input-focus focus:outline-none focus:ring-1 focus:ring-input-focus"
          />
        </div>

        <div>
          <label htmlFor="bio_en" className="mb-1 block text-sm font-medium">
            نبذة تعريفية (إنجليزي)
            <span className="me-2 text-xs text-muted">Bio (English)</span>
          </label>
          <textarea
            id="bio_en"
            name="bio_en"
            rows={5}
            dir="ltr"
            defaultValue={bioEn}
            className="glass-input w-full px-4 py-2.5 text-left text-foreground focus:border-input-focus focus:outline-none focus:ring-1 focus:ring-input-focus"
          />
        </div>

        <CheckboxGroup
          label="التخصصات — Specialties"
          name="specialties"
          options={TEACHER_SPECIALTIES.map((s) => ({ value: s.key, label: `${s.ar} — ${s.en}` }))}
          defaultValues={specialties}
        />

        <CheckboxGroup
          label="اللغات — Languages"
          name="languages"
          options={TEACHER_LANGUAGES.map((l) => ({ value: l.key, label: `${l.ar} — ${l.en}` }))}
          defaultValues={languages}
        />

        <CheckboxGroup
          label="معايير القراءة — Recitation Standards"
          name="recitation_standards"
          options={TEACHER_RECITATIONS.map((r) => ({ value: r.key, label: `${r.ar} — ${r.en}` }))}
          defaultValues={recitationStandards}
        />

        <div>
          <label htmlFor="intro_video_url" className="mb-1 block text-sm font-medium">
            رابط فيديو تعريفي
            <span className="me-2 text-xs text-muted">Intro Video URL</span>
          </label>
          <input
            id="intro_video_url"
            name="intro_video_url"
            type="url"
            dir="ltr"
            defaultValue={introVideoUrl}
            placeholder="https://youtube.com/watch?v=..."
            className="glass-input w-full px-4 py-2.5 text-left text-foreground focus:border-input-focus focus:outline-none focus:ring-1 focus:ring-input-focus"
          />
        </div>

        <div className="flex flex-wrap gap-3">
          <button
            type="submit"
            disabled={pending}
            className="glass-gold glass-pill flex items-center gap-2 px-4 py-2 text-sm font-medium transition-colors hover:bg-gold-hover disabled:opacity-50"
          >
            {pending ? (
              <span className="h-4 w-4 animate-spin rounded-full border-2 border-white/30 border-t-white" />
            ) : (
              <Save size={16} />
            )}
            حفظ التعديلات
            <span className="me-1 text-xs text-muted">Save changes</span>
          </button>
        </div>

        <p className="text-xs text-muted">
          الحفظ لا يغير حالة المراجعة — استخدم أزرار القبول/الرفض بالأسفل لتغيير الحالة.
        </p>
      </form>
    </div>
  );
}
