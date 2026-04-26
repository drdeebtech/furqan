"use client";

import { useActionState, useTransition } from "react";
import { Save, Send } from "lucide-react";
import { saveCvDraft, submitCvForReview, type CvResult } from "./actions";
import { CheckboxGroup } from "@/components/shared/checkbox-group";
import { TEACHER_LANGUAGES, TEACHER_RECITATIONS, TEACHER_SPECIALTIES } from "@/lib/constants";

interface CvFormProps {
  bio: string;
  bioEn: string;
  specialties: string[];
  languages: string[];
  recitationStandards: string[];
  introVideoUrl: string;
  cvStatus: string;
}

export function CvForm({
  bio,
  bioEn,
  specialties,
  languages,
  recitationStandards,
  introVideoUrl,
  cvStatus,
}: CvFormProps) {
  const [state, formAction, pending] = useActionState<CvResult, FormData>(
    saveCvDraft,
    {},
  );

  const [submitPending, startTransition] = useTransition();

  const handleSubmitForReview = () => {
    startTransition(async () => {
      await submitCvForReview();
    });
  };

  const isPendingReview = cvStatus === "pending_review";

  return (
    <div className="glass-card p-6">
      <h2 className="mb-4 text-lg font-semibold">
        بيانات السيرة الذاتية
        <span className="me-2 text-sm font-normal text-muted">CV Details</span>
      </h2>

      {state.error && (
        <div className="mb-4 rounded-xl border border-error/30 bg-error/10 p-3 text-sm text-error">
          {state.error}
        </div>
      )}

      {state.success && (
        <div className="mb-4 rounded-xl border border-emerald-500/30 bg-emerald-500/10 p-3 text-sm text-emerald-400">
          تم حفظ المسودة بنجاح
        </div>
      )}

      <form action={formAction} className="space-y-5">
        {/* Bio (Arabic) */}
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
            placeholder="اكتب نبذة عن نفسك وخبراتك في التعليم..."
            className="glass-input w-full px-4 py-2.5 text-foreground focus:border-input-focus focus:outline-none focus:ring-1 focus:ring-input-focus"
          />
        </div>

        {/* Bio (English) */}
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
            placeholder="Write a short bio about yourself and your teaching experience..."
            className="glass-input w-full px-4 py-2.5 text-left text-foreground focus:border-input-focus focus:outline-none focus:ring-1 focus:ring-input-focus"
          />
          <p className="mt-1 text-xs text-muted">
            Shown to students browsing in English mode. Falls back to the Arabic bio if left empty.
          </p>
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

        {/* Intro Video URL */}
        <div>
          <label
            htmlFor="intro_video_url"
            className="mb-1 block text-sm font-medium"
          >
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

        {/* Action buttons */}
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
            حفظ مسودة
          </button>

          <button
            type="button"
            disabled={isPendingReview || submitPending}
            onClick={handleSubmitForReview}
            className="glass-success glass-pill flex items-center gap-2 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-emerald-700 disabled:opacity-50"
          >
            {submitPending ? (
              <span className="h-4 w-4 animate-spin rounded-full border-2 border-white/30 border-t-white" />
            ) : (
              <Send size={16} />
            )}
            إرسال للمراجعة
          </button>
        </div>

        {isPendingReview && (
          <p className="text-xs text-amber-400">
            سيرتك الذاتية قيد المراجعة حاليًا — لا يمكن إرسالها مرة أخرى حتى
            تتم المراجعة.
          </p>
        )}
      </form>
    </div>
  );
}
