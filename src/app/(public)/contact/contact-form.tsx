"use client";

import { useState } from "react";

const COUNTRIES = ["المملكة المتحدة", "الولايات المتحدة", "كندا", "أستراليا", "السعودية", "الإمارات", "الكويت", "مصر", "أخرى"];
const PACKAGES = ["جلسة تجريبية مجانية", "الباقة الأساسية", "الباقة المتوسطة", "الباقة المتقدمة", "باقة نهاية الأسبوع", "أريد أن أكون معلماً"];
const AGES = ["٣-٥ سنوات", "٦-١٠ سنوات", "١١-١٥ سنة", "١٦-٢٠ سنة", "٢١+ بالغ"];

const inputClass = "w-full rounded-xl border border-input-border bg-input neu-inset px-4 py-2.5 text-sm text-foreground placeholder:text-muted/50 focus:border-gold focus:outline-none focus:ring-1 focus:ring-gold";

export function ContactForm() {
  const [sent, setSent] = useState(false);

  if (sent) {
    return (
      <div className="rounded-2xl border border-gold/20 bg-card p-12 text-center">
        <p className="font-display text-2xl font-bold text-gold">شكراً لتواصلك!</p>
        <p className="mt-3 text-sm text-muted">سنتواصل معك خلال ٢٤ ساعة إن شاء الله</p>
        <p className="mt-1 text-xs text-muted">Thank you! We will contact you within 24 hours.</p>
      </div>
    );
  }

  return (
    <div className="rounded-2xl border border-card-border bg-card p-8">
      <h3 className="text-lg font-bold">أرسل لنا رسالة</h3>
      <p className="mt-1 text-sm text-muted">Send us a message</p>

      <form
        onSubmit={(e) => { e.preventDefault(); setSent(true); }}
        className="mt-6 space-y-4"
      >
        <div>
          <label className="mb-1 block text-sm font-medium">الاسم الكامل <span className="text-xs text-muted">Full name</span></label>
          <input type="text" required className={inputClass} placeholder="محمد أحمد" />
        </div>

        <div className="grid gap-4 md:grid-cols-2">
          <div>
            <label className="mb-1 block text-sm font-medium">البريد الإلكتروني</label>
            <input type="email" required dir="ltr" className={`${inputClass} text-left`} placeholder="you@example.com" />
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium">رقم واتساب</label>
            <input type="tel" dir="ltr" className={`${inputClass} text-left`} placeholder="+44 7400 000000" />
          </div>
        </div>

        <div className="grid gap-4 md:grid-cols-2">
          <div>
            <label className="mb-1 block text-sm font-medium">الدولة</label>
            <select required className={inputClass}>
              <option value="">اختر الدولة</option>
              {COUNTRIES.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium">عمر الطالب</label>
            <select className={inputClass}>
              <option value="">اختر الفئة العمرية</option>
              {AGES.map((a) => <option key={a} value={a}>{a}</option>)}
            </select>
          </div>
        </div>

        <div>
          <label className="mb-1 block text-sm font-medium">الباقة المهتم بها</label>
          <select className={inputClass}>
            <option value="">اختر الباقة</option>
            {PACKAGES.map((p) => <option key={p} value={p}>{p}</option>)}
          </select>
        </div>

        <div>
          <label className="mb-1 block text-sm font-medium">رسالتك <span className="text-xs text-muted">(اختياري)</span></label>
          <textarea rows={4} className={`${inputClass} resize-none`} placeholder="أخبرنا عن أهدافك..." />
        </div>

        <button
          type="submit"
          className="w-full rounded bg-gold py-3 font-semibold text-background transition-colors hover:bg-gold-hover"
        >
          أرسل طلبك
        </button>
      </form>

      <p className="mt-4 text-center text-xs text-muted">أو تواصل معنا مباشرة عبر واتساب للرد الفوري</p>
    </div>
  );
}
