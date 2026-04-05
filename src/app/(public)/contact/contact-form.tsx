"use client";

import { useState } from "react";
import { useLang } from "@/lib/i18n/context";

const inputClass = "w-full rounded-xl border border-input-border bg-input neu-inset px-4 py-2.5 text-sm text-foreground placeholder:text-muted/50 focus:border-gold focus:outline-none focus:ring-1 focus:ring-gold";

export function ContactForm() {
  const [sent, setSent] = useState(false);
  const { t } = useLang();

  if (sent) {
    return (
      <div className="rounded-2xl border border-gold/20 bg-card p-12 text-center">
        <p className="font-display text-2xl font-bold text-gold">{t("شكراً لتواصلك!", "Thank you!")}</p>
        <p className="mt-3 text-sm text-muted">{t("سنتواصل معك خلال ٢٤ ساعة إن شاء الله", "We will contact you within 24 hours, InshaAllah")}</p>
      </div>
    );
  }

  return (
    <div className="rounded-2xl border border-card-border bg-card p-8">
      <h3 className="text-lg font-bold">{t("أرسل لنا رسالة", "Send us a Message")}</h3>

      <form onSubmit={(e) => { e.preventDefault(); setSent(true); }} className="mt-6 space-y-4">
        <div>
          <label htmlFor="full_name" className="mb-1 block text-sm font-medium">{t("الاسم الكامل", "Full Name")}</label>
          <input id="full_name" name="full_name" type="text" required className={inputClass} placeholder={t("محمد أحمد", "Mohammed Ahmed")} />
        </div>

        <div className="grid gap-4 md:grid-cols-2">
          <div>
            <label htmlFor="email" className="mb-1 block text-sm font-medium">{t("البريد الإلكتروني", "Email")}</label>
            <input id="email" name="email" type="email" required dir="ltr" className={`${inputClass} text-left`} placeholder="you@example.com" />
          </div>
          <div>
            <label htmlFor="whatsapp" className="mb-1 block text-sm font-medium">{t("رقم واتساب", "WhatsApp Number")}</label>
            <input id="whatsapp" name="whatsapp" type="tel" dir="ltr" className={`${inputClass} text-left`} placeholder="+44 7400 000000" />
          </div>
        </div>

        <div className="grid gap-4 md:grid-cols-2">
          <div>
            <label htmlFor="country" className="mb-1 block text-sm font-medium">{t("الدولة", "Country")}</label>
            <select id="country" name="country" required className={inputClass}>
              <option value="">{t("اختر الدولة", "Select Country")}</option>
              {[
                { ar: "المملكة المتحدة", en: "United Kingdom" },
                { ar: "الولايات المتحدة", en: "United States" },
                { ar: "كندا", en: "Canada" },
                { ar: "أستراليا", en: "Australia" },
                { ar: "السعودية", en: "Saudi Arabia" },
                { ar: "الإمارات", en: "UAE" },
                { ar: "الكويت", en: "Kuwait" },
                { ar: "مصر", en: "Egypt" },
                { ar: "أخرى", en: "Other" },
              ].map((c) => <option key={c.en} value={c.en}>{t(c.ar, c.en)}</option>)}
            </select>
          </div>
          <div>
            <label htmlFor="student_age" className="mb-1 block text-sm font-medium">{t("عمر الطالب", "Student Age")}</label>
            <select id="student_age" name="student_age" className={inputClass}>
              <option value="">{t("اختر الفئة العمرية", "Select Age Range")}</option>
              {["3-5", "6-10", "11-15", "16-20", "21+"].map((a) => (
                <option key={a} value={a}>{a} {t("سنوات", "years")}</option>
              ))}
            </select>
          </div>
        </div>

        <div>
          <label htmlFor="package" className="mb-1 block text-sm font-medium">{t("الباقة المهتم بها", "Package Interest")}</label>
          <select id="package" name="package" className={inputClass}>
            <option value="">{t("اختر الباقة", "Select Package")}</option>
            {[
              { ar: "جلسة تجريبية مجانية", en: "Free Trial Session" },
              { ar: "الباقة الأساسية", en: "Starter Package" },
              { ar: "الباقة المتوسطة", en: "Standard Package" },
              { ar: "الباقة المتقدمة", en: "Premium Package" },
              { ar: "باقة نهاية الأسبوع", en: "Weekend Package" },
              { ar: "أريد أن أكون معلماً", en: "I want to be a teacher" },
            ].map((p) => <option key={p.en} value={p.en}>{t(p.ar, p.en)}</option>)}
          </select>
        </div>

        <div>
          <label htmlFor="message" className="mb-1 block text-sm font-medium">{t("رسالتك", "Your Message")} <span className="text-xs text-muted">({t("اختياري", "optional")})</span></label>
          <textarea id="message" name="message" rows={4} className={`${inputClass} resize-none`} placeholder={t("أخبرنا عن أهدافك...", "Tell us about your goals...")} />
        </div>

        <button type="submit" className="w-full rounded bg-gold py-3 font-semibold text-background transition-colors hover:bg-gold-hover">
          {t("أرسل طلبك", "Submit Request")}
        </button>
      </form>
    </div>
  );
}
