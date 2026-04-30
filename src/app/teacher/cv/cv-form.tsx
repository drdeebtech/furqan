"use client";

import { useActionState, useState, useTransition } from "react";
import { Camera, Save, Send } from "lucide-react";
import { saveCvDraft, saveProfilePhoto, submitCvForReview, type CvResult } from "./actions";
import { CheckboxGroup } from "@/components/shared/checkbox-group";
import { Avatar } from "@/components/shared/avatar";
import type { TeacherLanguage } from "@/lib/site-content/types";

interface CvFormProps {
  bio: string;
  bioEn: string;
  specialties: string[];
  languages: string[];
  recitationStandards: string[];
  introVideoUrl: string;
  cvStatus: string;
  avatarUrl: string | null;
  fullName: string | null;
  picklists: { languages: TeacherLanguage[]; specialties: TeacherLanguage[]; recitations: TeacherLanguage[] };
}

export function CvForm({
  bio,
  bioEn,
  specialties,
  languages,
  recitationStandards,
  introVideoUrl,
  cvStatus,
  avatarUrl,
  fullName,
  picklists,
}: CvFormProps) {
  const [state, formAction, pending] = useActionState<CvResult, FormData>(
    saveCvDraft,
    {},
  );
  const [photoState, photoAction, photoPending] = useActionState<CvResult, FormData>(
    saveProfilePhoto,
    {},
  );
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [chosenName, setChosenName] = useState<string | null>(null);

  const onPhotoChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (!f) {
      setPreviewUrl(null);
      setChosenName(null);
      return;
    }
    setChosenName(f.name);
    const reader = new FileReader();
    reader.onload = () => setPreviewUrl(typeof reader.result === "string" ? reader.result : null);
    reader.readAsDataURL(f);
  };

  const [submitPending, startTransition] = useTransition();

  const handleSubmitForReview = () => {
    startTransition(async () => {
      await submitCvForReview();
    });
  };

  const isPendingReview = cvStatus === "pending_review";

  return (
    <>
      <div className="glass-card mb-6 p-6">
        <h2 className="mb-4 text-lg font-semibold">
          الصورة الشخصية
          <span className="me-2 text-sm font-normal text-muted">Profile Photo</span>
        </h2>

        {photoState.error && (
          <div className="mb-4 rounded-xl border border-error/30 bg-error/10 p-3 text-sm text-error">
            {photoState.error}
          </div>
        )}
        {photoState.success && (
          <div className="mb-4 rounded-xl border border-success/30 bg-success/10 p-3 text-sm text-success">
            تم تحديث الصورة بنجاح
          </div>
        )}

        <form action={photoAction} className="flex flex-wrap items-center gap-4">
          <Avatar src={previewUrl ?? avatarUrl} name={fullName} size={80} />

          <div className="flex-1 space-y-2">
            <label
              htmlFor="photo"
              className="glass-pill inline-flex cursor-pointer items-center gap-2 border border-white/10 bg-white/5 px-4 py-2 text-sm font-medium hover:bg-white/10"
            >
              <Camera size={14} />
              {chosenName ? "تغيير الصورة" : "اختر صورة من الجهاز أو الكاميرا"}
            </label>
            <input
              id="photo"
              name="photo"
              type="file"
              accept="image/jpeg,image/png,image/webp"
              capture="user"
              onChange={onPhotoChange}
              className="sr-only"
            />
            {chosenName && (
              <p className="text-xs text-muted" dir="ltr">{chosenName}</p>
            )}
            <p className="text-xs text-muted">
              JPG / PNG / WebP — الحد الأقصى 2 ميغابايت
            </p>
          </div>

          <button
            type="submit"
            disabled={photoPending || !chosenName}
            className="glass-gold glass-pill flex items-center gap-2 px-4 py-2 text-sm font-medium transition-colors hover:bg-gold-hover disabled:opacity-50"
          >
            {photoPending ? (
              <span className="h-4 w-4 animate-spin rounded-full border-2 border-white/30 border-t-white" />
            ) : (
              <Save size={16} />
            )}
            حفظ الصورة
          </button>
        </form>
      </div>

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
        <div className="mb-4 rounded-xl border border-success/30 bg-success/10 p-3 text-sm text-success">
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
          options={picklists.specialties.map((s) => ({ value: s.key, label: `${s.label_ar} — ${s.label_en}` }))}
          defaultValues={specialties}
        />

        <CheckboxGroup
          label="اللغات — Languages"
          name="languages"
          options={picklists.languages.map((l) => ({ value: l.key, label: `${l.label_ar} — ${l.label_en}` }))}
          defaultValues={languages}
        />

        <CheckboxGroup
          label="معايير القراءة — Recitation Standards"
          name="recitation_standards"
          options={picklists.recitations.map((r) => ({ value: r.key, label: `${r.label_ar} — ${r.label_en}` }))}
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
            className="glass-success glass-pill flex items-center gap-2 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-success/90 disabled:opacity-50"
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
          <p className="text-xs text-warning">
            سيرتك الذاتية قيد المراجعة حاليًا — لا يمكن إرسالها مرة أخرى حتى
            تتم المراجعة.
          </p>
        )}
        </form>
      </div>
    </>
  );
}
