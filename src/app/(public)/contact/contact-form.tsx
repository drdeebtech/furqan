"use client";

import { useActionState } from "react";
import { useLang } from "@/lib/i18n/context";
import { FormField } from "@/components/shared/form-field";
import { COUNTRIES } from "@/lib/countries";
import { submitContactForm } from "./actions";

const inputClass = "glass-input w-full rounded-xl px-4 py-2.5 text-sm text-foreground placeholder:text-muted/50 focus:border-gold focus:outline-none focus:ring-1 focus:ring-gold";

export function ContactForm() {
  const { t } = useLang();
  const [state, formAction, pending] = useActionState<{ success?: boolean; error?: string }, FormData>(submitContactForm, {});

  if (state.success) {
    return (
      <div className="glass-card p-12 text-center">
        <p className="font-display text-2xl font-bold text-gold">{t("شكراً لتواصلك!", "Thank you!")}</p>
        <p className="mt-3 text-sm text-muted">{t("سنتواصل معك خلال ٢٤ ساعة إن شاء الله", "We will contact you within 24 hours, InshaAllah")}</p>
      </div>
    );
  }

  return (
    <div className="glass-card p-8">
      <h3 className="text-lg font-bold">{t("أرسل لنا رسالة", "Send us a Message")}</h3>

      {state.error && (
        <div className="mt-4 rounded-lg border border-error/30 bg-error/10 p-3 text-sm text-error">
          {state.error}
        </div>
      )}

      <form action={formAction} className="mt-6 space-y-4">
        <FormField
          label={t("الاسم الكامل", "Full Name")}
          name="full_name"
          required
          placeholder={t("محمد أحمد", "Mohammed Ahmed")}
        />

        <div className="grid gap-4 md:grid-cols-2">
          <FormField
            label={t("البريد الإلكتروني", "Email")}
            name="email"
            type="email"
            required
            dir="ltr"
            placeholder="you@example.com"
            inputClassName={`${inputClass} text-left`}
          />
          <FormField
            label={t("رقم واتساب", "WhatsApp Number")}
            name="whatsapp"
            type="tel"
            dir="ltr"
            placeholder="+20 122 021 0300"
            inputClassName={`${inputClass} text-left`}
          />
        </div>

        <div className="grid gap-4 md:grid-cols-2">
          <FormField label={t("الدولة", "Country")} name="country">
            <select id="country" name="country" required className={inputClass}>
              <option value="">{t("اختر الدولة", "Select Country")}</option>
              {COUNTRIES.map((c) => <option key={c.code} value={c.en}>{t(c.ar, c.en)}</option>)}
              <option value="Other">{t("أخرى", "Other")}</option>
            </select>
          </FormField>
          <FormField label={t("عمر الطالب", "Student Age")} name="student_age">
            <select id="student_age" name="student_age" className={inputClass}>
              <option value="">{t("اختر الفئة العمرية", "Select Age Range")}</option>
              {["3-5", "6-10", "11-15", "16-20", "21+"].map((a) => (
                <option key={a} value={a}>{a} {t("سنوات", "years")}</option>
              ))}
            </select>
          </FormField>
        </div>

        <FormField label={t("الباقة المهتم بها", "Package Interest")} name="package">
          <select id="package" name="package" className={inputClass}>
            <option value="">{t("اختر الباقة", "Select Package")}</option>
            {[
              { ar: "استفسار عام", en: "General Inquiry" },
              { ar: "الباقة الأساسية", en: "Starter Package" },
              { ar: "الباقة المتوسطة", en: "Standard Package" },
              { ar: "الباقة المتقدمة", en: "Premium Package" },
              { ar: "باقة نهاية الأسبوع", en: "Weekend Package" },
              { ar: "أريد أن أكون معلماً", en: "I want to be a teacher" },
            ].map((p) => <option key={p.en} value={p.en}>{t(p.ar, p.en)}</option>)}
          </select>
        </FormField>

        <FormField
          label={t("رسالتك", "Your Message")}
          name="message"
          optional
        >
          <textarea
            id="message"
            name="message"
            rows={4}
            className={`${inputClass} resize-none`}
            placeholder={t("أخبرنا عن أهدافك...", "Tell us about your goals...")}
          />
        </FormField>

        <button type="submit" disabled={pending} className="glass-gold glass-pill w-full py-3 font-semibold transition-colors hover:bg-gold-hover disabled:opacity-50">
          {pending ? t("جاري الإرسال...", "Sending...") : t("أرسل طلبك", "Submit Request")}
        </button>
      </form>
    </div>
  );
}
