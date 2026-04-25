"use client";

import { useActionState } from "react";
import { Save } from "lucide-react";
import { saveCvAsAdmin, type AdminCvSaveResult } from "./actions";

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

      {state.error && (
        <div role="alert" className="mb-4 rounded-xl border border-error/30 bg-error/10 p-3 text-sm text-error">
          {state.error}
        </div>
      )}

      {state.success && (
        <div className="mb-4 rounded-xl border border-emerald-500/30 bg-emerald-500/10 p-3 text-sm text-emerald-400">
          تم حفظ التعديلات بنجاح
        </div>
      )}

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

        <div>
          <label htmlFor="specialties" className="mb-1 block text-sm font-medium">
            التخصصات
            <span className="me-2 text-xs text-muted">Specialties (comma-separated)</span>
          </label>
          <input
            id="specialties"
            name="specialties"
            type="text"
            defaultValue={specialties.join(", ")}
            placeholder="تجويد, حفظ, تفسير"
            className="glass-input w-full px-4 py-2.5 text-foreground focus:border-input-focus focus:outline-none focus:ring-1 focus:ring-input-focus"
          />
        </div>

        <div>
          <label htmlFor="languages" className="mb-1 block text-sm font-medium">
            اللغات
            <span className="me-2 text-xs text-muted">Languages (comma-separated)</span>
          </label>
          <input
            id="languages"
            name="languages"
            type="text"
            defaultValue={languages.join(", ")}
            placeholder="العربية, الإنجليزية"
            className="glass-input w-full px-4 py-2.5 text-foreground focus:border-input-focus focus:outline-none focus:ring-1 focus:ring-input-focus"
          />
        </div>

        <div>
          <label htmlFor="recitation_standards" className="mb-1 block text-sm font-medium">
            معايير القراءة
            <span className="me-2 text-xs text-muted">Recitation Standards (comma-separated)</span>
          </label>
          <input
            id="recitation_standards"
            name="recitation_standards"
            type="text"
            defaultValue={recitationStandards.join(", ")}
            placeholder="حفص عن عاصم, ورش عن نافع"
            className="glass-input w-full px-4 py-2.5 text-foreground focus:border-input-focus focus:outline-none focus:ring-1 focus:ring-input-focus"
          />
        </div>

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
