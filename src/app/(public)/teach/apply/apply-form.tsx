"use client";

import { useActionState, useState, useRef } from "react";
import Link from "next/link";
import { CheckCircle2, AlertCircle, ImagePlus, X } from "lucide-react";
import { useLang } from "@/lib/i18n/context";
import { submitTeacherApplication, type ApplyResult } from "./actions";
import { CheckboxGroup } from "@/components/shared/checkbox-group";
import {
  TEACHER_LANGUAGES as LANGS,
  TEACHER_RECITATIONS as RECITATIONS,
  TEACHER_SPECIALTIES as SPECIALTIES,
} from "@/lib/constants";

const MAX_PHOTO_BYTES = 2 * 1024 * 1024;
const ALLOWED_PHOTO_TYPES = ["image/jpeg", "image/png", "image/webp"];

export function ApplyForm() {
  const { t, dir } = useLang();
  const [state, formAction, isPending] = useActionState<ApplyResult, FormData>(
    submitTeacherApplication,
    {},
  );
  const [photoPreview, setPhotoPreview] = useState<string | null>(null);
  const [photoError, setPhotoError] = useState<string | null>(null);
  const photoInputRef = useRef<HTMLInputElement>(null);

  function handlePhotoChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    setPhotoError(null);
    if (!file) {
      setPhotoPreview(null);
      return;
    }
    if (!ALLOWED_PHOTO_TYPES.includes(file.type)) {
      setPhotoError(t("الصيغة غير مدعومة (JPG / PNG / WebP فقط)", "Unsupported format (JPG / PNG / WebP only)"));
      e.target.value = "";
      setPhotoPreview(null);
      return;
    }
    if (file.size > MAX_PHOTO_BYTES) {
      setPhotoError(t("حجم الصورة يجب أن يكون أقل من 2 ميجا", "Image must be under 2 MB"));
      e.target.value = "";
      setPhotoPreview(null);
      return;
    }
    setPhotoPreview(URL.createObjectURL(file));
  }

  function clearPhoto() {
    if (photoInputRef.current) photoInputRef.current.value = "";
    setPhotoPreview(null);
    setPhotoError(null);
  }

  if (state?.success) {
    return (
      <div dir={dir} className="glass-card rounded-2xl p-8 text-center">
        <CheckCircle2 size={56} className="mx-auto mb-4 text-emerald-400" />
        <h1 className="font-display text-2xl font-bold text-gold">
          {t("تم استلام طلبك بنجاح ✓", "Application received ✓")}
        </h1>
        <div className="mx-auto mt-5 max-w-md rounded-xl border border-amber-500/30 bg-amber-500/10 p-4 text-start">
          <p className="text-sm font-medium text-amber-300">
            {t("📋 طلبك الآن في انتظار موافقة الإدارة", "📋 Your application is awaiting admin approval")}
          </p>
          <p className="mt-1 text-xs text-amber-200/80">
            {t(
              "عادةً ما تكتمل المراجعة خلال 48 ساعة، وستصلك رسالة تأكيد عند قبول طلبك.",
              "Review usually completes within 48 hours; you'll receive a confirmation email once accepted.",
            )}
          </p>
        </div>
        <p className="mt-4 text-sm text-muted">
          {t(
            "أرسلنا لك بريداً بتفاصيل الطلب — تحقق من صندوق الوارد (وقد ينتهي في الـ Spam).",
            "We've sent you an email with the application details — check your inbox (and Spam folder).",
          )}
        </p>
        <Link
          href="/"
          className="glass-pill mt-6 inline-block px-6 py-2 text-sm text-gold hover:text-gold-light"
        >
          {t("العودة للصفحة الرئيسية", "Back to home")}
        </Link>
      </div>
    );
  }

  return (
    <form action={formAction} dir={dir} className="space-y-6">
      <header>
        <h1 className="font-display text-3xl font-bold text-gold">
          {t("تقديم طلب تدريس", "Apply to teach")}
        </h1>
        <p className="mt-2 text-sm text-muted">
          {t(
            "املأ الحقول التالية وسنرسل لك رابط دخول مباشر للوحة المعلم. سيراجع فريق الإشراف ملفك خلال 48 ساعة.",
            "Fill the form below — we'll email you a direct login link. Our team reviews your profile within 48 hours.",
          )}
        </p>
      </header>

      {state?.error && (
        <div
          role="alert"
          className="flex items-start gap-2 rounded-xl border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-400"
        >
          <AlertCircle size={16} className="mt-0.5 shrink-0" />
          <span>{state.error}</span>
        </div>
      )}

      <div className="grid gap-4 sm:grid-cols-2">
        <Field label={t("الاسم الكامل *", "Full name *")} name="full_name" required minLength={3} />
        <Field label={t("البريد الإلكتروني *", "Email *")} name="email" type="email" required />
        <Field label={t("رقم الواتساب *", "WhatsApp / phone *")} name="phone" required />
        <Field label={t("الدولة *", "Country *")} name="country" required />
        <SelectField
          label={t("الجنس", "Gender")}
          name="gender"
          options={[
            { value: "", label: t("— اختر —", "— select —") },
            { value: "male", label: t("ذكر", "Male") },
            { value: "female", label: t("أنثى", "Female") },
          ]}
        />
        <Field
          label={t("سنوات الخبرة", "Years of experience")}
          name="years_experience"
          type="number"
          min={0}
          max={60}
        />
      </div>

      <fieldset>
        <legend className="mb-2 block text-sm font-medium">
          {t("الصورة الشخصية (اختياري)", "Profile photo (optional)")}
        </legend>
        <div className="flex items-center gap-4">
          {photoPreview ? (
            <div className="relative">
              {/* Blob URL preview — next/image can't optimise client-only object URLs. */}
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={photoPreview}
                alt=""
                className="h-20 w-20 rounded-full border-2 border-gold/40 object-cover"
              />
              <button
                type="button"
                onClick={clearPhoto}
                aria-label={t("إزالة الصورة", "Remove photo")}
                className="absolute -top-1 -end-1 flex h-6 w-6 items-center justify-center rounded-full bg-red-500 text-white shadow hover:bg-red-600"
              >
                <X size={12} />
              </button>
            </div>
          ) : (
            <div className="flex h-20 w-20 items-center justify-center rounded-full border-2 border-dashed border-muted/40 text-muted">
              <ImagePlus size={24} />
            </div>
          )}
          <div className="flex-1">
            <label className="glass-pill inline-flex cursor-pointer items-center gap-2 px-4 py-2 text-sm hover:text-gold">
              <ImagePlus size={14} />
              {photoPreview
                ? t("تغيير الصورة", "Change photo")
                : t("اختر صورة", "Choose photo")}
              <input
                ref={photoInputRef}
                type="file"
                name="photo"
                accept="image/jpeg,image/png,image/webp"
                onChange={handlePhotoChange}
                className="hidden"
              />
            </label>
            <p className="mt-1.5 text-xs text-muted">
              {t("JPG / PNG / WebP — أقل من 2 ميجا — مربعة الشكل أفضل.", "JPG / PNG / WebP — under 2 MB — square works best.")}
            </p>
            {photoError && (
              <p role="alert" className="mt-1 text-xs text-red-400">{photoError}</p>
            )}
          </div>
        </div>
      </fieldset>

      <CheckboxGroup
        label={t("لغات التدريس * (اختر واحدة على الأقل)", "Teaching languages * (pick at least one)")}
        name="languages"
        options={LANGS.map((l) => ({ value: l.key, label: t(l.ar, l.en) }))}
      />

      <CheckboxGroup
        label={t("الروايات * (اختر واحدة على الأقل)", "Recitations * (pick at least one)")}
        name="recitation_standards"
        options={RECITATIONS.map((r) => ({ value: r.key, label: t(r.ar, r.en) }))}
      />

      <CheckboxGroup
        label={t("التخصصات * (اختر واحداً على الأقل)", "Specialties * (pick at least one)")}
        name="specialties"
        options={SPECIALTIES.map((s) => ({ value: s.key, label: t(s.ar, s.en) }))}
      />

      <div>
        <label className="mb-1.5 block text-sm font-medium" htmlFor="bio">
          {t("نبذة عنك * (40-2000 حرف)", "About you * (40-2000 characters)")}
        </label>
        <textarea
          id="bio"
          name="bio"
          required
          minLength={40}
          maxLength={2000}
          rows={5}
          className="glass-input w-full rounded-xl px-3 py-2 text-sm"
          placeholder={t(
            "حدّثنا عن مسيرتك العلمية، إجازاتك، وأسلوبك في التدريس...",
            "Tell us about your background, ijazat, and teaching style...",
          )}
        />
      </div>

      <Field
        label={t("رابط فيديو تعريفي (اختياري)", "Intro video URL (optional)")}
        name="intro_video_url"
        type="url"
        placeholder="https://..."
      />

      <button
        type="submit"
        disabled={isPending}
        className="glass-gold glass-pill w-full px-6 py-3 text-base font-bold transition-colors hover:bg-gold-hover disabled:opacity-50"
      >
        {isPending
          ? t("جارٍ الإرسال...", "Submitting...")
          : t("إرسال الطلب", "Submit application")}
      </button>

      <p className="text-center text-xs text-muted">
        {t(
          "بإرسال هذا النموذج توافق على معالجة بياناتك بحسب سياسة الخصوصية.",
          "By submitting you agree to our privacy policy.",
        )}
      </p>
    </form>
  );
}

interface FieldProps extends React.InputHTMLAttributes<HTMLInputElement> {
  label: string;
  name: string;
}

function Field({ label, name, ...props }: FieldProps) {
  return (
    <div>
      <label className="mb-1.5 block text-sm font-medium" htmlFor={name}>
        {label}
      </label>
      <input
        id={name}
        name={name}
        className="glass-input w-full rounded-xl px-3 py-2 text-sm"
        {...props}
      />
    </div>
  );
}

interface SelectProps {
  label: string;
  name: string;
  options: Array<{ value: string; label: string }>;
}

function SelectField({ label, name, options }: SelectProps) {
  return (
    <div>
      <label className="mb-1.5 block text-sm font-medium" htmlFor={name}>
        {label}
      </label>
      <select id={name} name={name} className="glass-input w-full rounded-xl px-3 py-2 text-sm">
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </div>
  );
}

// CheckboxGroup moved to src/components/shared/checkbox-group.tsx so the
// admin CV edit, teacher self-edit, and this public apply form all use the
// same component + the same option lists from src/lib/constants.ts.
