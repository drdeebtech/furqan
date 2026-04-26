"use client";

import { useActionState } from "react";
import Link from "next/link";
import { CheckCircle2, AlertCircle } from "lucide-react";
import { useLang } from "@/lib/i18n/context";
import { submitTeacherApplication, type ApplyResult } from "./actions";

const LANGS: Array<{ key: string; ar: string; en: string }> = [
  { key: "ar", ar: "العربية", en: "Arabic" },
  { key: "en", ar: "الإنجليزية", en: "English" },
  { key: "ur", ar: "الأوردية", en: "Urdu" },
  { key: "fr", ar: "الفرنسية", en: "French" },
  { key: "tr", ar: "التركية", en: "Turkish" },
  { key: "id", ar: "الإندونيسية", en: "Indonesian" },
  { key: "ms", ar: "الماليزية", en: "Malay" },
];

const RECITATIONS: Array<{ key: string; ar: string; en: string }> = [
  { key: "hafs", ar: "حفص عن عاصم", en: "Hafs `an Asim" },
  { key: "shu_ba", ar: "شعبة عن عاصم", en: "Shu'ba `an Asim" },
  { key: "warsh", ar: "ورش عن نافع", en: "Warsh `an Nafi'" },
  { key: "qalon", ar: "قالون عن نافع", en: "Qalon `an Nafi'" },
  { key: "al_duri_basri", ar: "الدوري عن أبي عمرو البصري", en: "Al-Duri `an Abi Amr" },
  { key: "al_susi", ar: "السوسي عن أبي عمرو البصري", en: "Al-Susi `an Abi Amr" },
  { key: "hisham", ar: "هشام عن ابن عامر", en: "Hisham `an Ibn Amir" },
  { key: "ibn_dhakwan", ar: "ابن ذكوان عن ابن عامر", en: "Ibn Dhakwan `an Ibn Amir" },
  { key: "al_bazzi", ar: "البزي عن ابن كثير", en: "Al-Bazzi `an Ibn Kathir" },
  { key: "qunbul", ar: "قنبل عن ابن كثير", en: "Qunbul `an Ibn Kathir" },
  { key: "khalaf_hamzah", ar: "خلف عن حمزة", en: "Khalaf `an Hamzah" },
  { key: "khallad", ar: "خلاد عن حمزة", en: "Khallad `an Hamzah" },
];

const SPECIALTIES: Array<{ key: string; ar: string; en: string }> = [
  // Core Quran skills
  { key: "tajweed", ar: "التجويد", en: "Tajweed" },
  { key: "memorization", ar: "الحفظ", en: "Memorization (Hifz)" },
  { key: "murajaa", ar: "مراجعة الحفظ", en: "Hifz revision (Muraja'a)" },
  { key: "qiraat", ar: "القراءات", en: "Qira'at" },
  { key: "ijazah", ar: "الإجازة بالسند", en: "Ijazah (chain of transmission)" },
  { key: "tafsir", ar: "التفسير", en: "Tafsir" },
  // Languages
  { key: "arabic", ar: "اللغة العربية", en: "Arabic language" },
  { key: "quranic_arabic", ar: "نحو وصرف القرآن", en: "Quranic Arabic (Nahw & Sarf)" },
  // Audience segments
  { key: "kids", ar: "تعليم الأطفال", en: "Kids" },
  { key: "adult_beginners", ar: "الكبار المبتدئون", en: "Adult beginners" },
  { key: "reverts", ar: "المسلمون الجدد وغير الناطقين بالعربية", en: "Reverts & non-Arabic speakers" },
  { key: "women_only", ar: "تعليم النساء فقط", en: "Women-only classes" },
  // Worship + Islamic studies
  { key: "salah_correction", ar: "تصحيح الصلاة وأحكامها", en: "Salah correction" },
  { key: "dua_adhkar", ar: "الأدعية والأذكار", en: "Du'a & Adhkar" },
  { key: "aqeedah", ar: "العقيدة", en: "Aqeedah" },
  { key: "fiqh", ar: "الفقه", en: "Fiqh" },
  { key: "hadith", ar: "الحديث الشريف", en: "Hadith" },
  { key: "sirah", ar: "السيرة النبوية", en: "Sirah" },
];

export function ApplyForm() {
  const { t, dir } = useLang();
  const [state, formAction, isPending] = useActionState<ApplyResult, FormData>(
    submitTeacherApplication,
    {},
  );

  if (state?.success) {
    return (
      <div dir={dir} className="glass-card rounded-2xl p-8 text-center">
        <CheckCircle2 size={48} className="mx-auto mb-4 text-emerald-400" />
        <h1 className="font-display text-2xl font-bold text-gold">
          {t("تم استلام طلبك", "Application received")}
        </h1>
        <p className="mt-3 text-sm text-muted">{state.success}</p>
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

interface CheckboxGroupProps {
  label: string;
  name: string;
  options: Array<{ value: string; label: string }>;
}

function CheckboxGroup({ label, name, options }: CheckboxGroupProps) {
  return (
    <fieldset>
      <legend className="mb-2 block text-sm font-medium">{label}</legend>
      <div className="flex flex-wrap gap-2">
        {options.map((o) => (
          <label
            key={o.value}
            className="glass-pill flex cursor-pointer items-center gap-2 px-3 py-1.5 text-xs transition-colors hover:text-gold has-[:checked]:bg-gold/15 has-[:checked]:text-gold has-[:checked]:border-gold/40"
          >
            <input type="checkbox" name={name} value={o.value} className="accent-gold" />
            {o.label}
          </label>
        ))}
      </div>
    </fieldset>
  );
}
