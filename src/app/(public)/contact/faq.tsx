"use client";

import { useState } from "react";
import { ChevronDown } from "lucide-react";

const FAQS = [
  { q: "هل الجلسة التجريبية مجانية تماماً؟", a: "نعم، الجلسة التجريبية مجانية بالكامل بدون أي التزامات أو بطاقة ائتمان. ستدوم الجلسة ٣٠ دقيقة مع معلم متخصص." },
  { q: "كيف تتم الجلسات؟", a: "تتم الجلسات عبر نظام الفيديو المدمج في منصة فرقان. بعد تأكيد الحجز ستحصل على رابط الجلسة مباشرة." },
  { q: "هل يتوفر معلمات للأخوات؟", a: "نعم، لدينا معلمات متخصصات ومعتمدات للأخوات والأطفال في بيئة آمنة تماماً." },
  { q: "ما هي مؤهلات المعلمين؟", a: "جميع معلمينا حاصلون على إجازة في رواية حفص عن عاصم من علماء معتمدين، وخريجو جامعات إسلامية مرموقة." },
  { q: "هل يمكنني تغيير موعد جلستي؟", a: "نعم، يمكنك إعادة الجدولة قبل ٢٤ ساعة من الجلسة بدون أي رسوم إضافية." },
  { q: "ما مدة العقد الأدنى؟", a: "لا يوجد عقد. يمكنك الاشتراك شهراً بشهر وإلغاء الاشتراك في أي وقت بدون رسوم." },
  { q: "هل يتوفر برنامج للأطفال؟", a: "نعم، لدينا برنامج خاص بالأطفال من سن ٥ سنوات بأسلوب تعليمي ممتع ومناسب لأعمارهم." },
  { q: "كيف أتابع تقدم طفلي؟", a: "يحصل ولي الأمر على تقرير تقدم مفصل بعد كل جلسة، ويمكنه متابعة لوحة التقدم في حساب الطالب." },
];

export function FAQ() {
  const [openIndex, setOpenIndex] = useState<number | null>(null);

  return (
    <section className="py-24">
      <div className="mx-auto max-w-3xl px-6">
        <p className="text-sm font-medium tracking-widest text-gold">❖ أسئلة شائعة</p>
        <h2 className="font-display mt-3 text-3xl font-bold">الأسئلة الشائعة</h2>
        <p className="mt-2 text-sm text-muted">Frequently Asked Questions</p>

        <div className="mt-12 space-y-2">
          {FAQS.map((faq, i) => (
            <div key={i} className="rounded-xl border border-card-border bg-card">
              <button
                onClick={() => setOpenIndex(openIndex === i ? null : i)}
                className="flex w-full items-center justify-between px-6 py-4 text-right text-sm font-medium transition-colors hover:text-gold focus-ring"
              >
                {faq.q}
                <ChevronDown
                  size={18}
                  className={`shrink-0 text-muted transition-transform ${openIndex === i ? "rotate-180" : ""}`}
                />
              </button>
              {openIndex === i && (
                <div className="border-t border-card-border px-6 py-4">
                  <p className="text-sm leading-relaxed text-muted">{faq.a}</p>
                </div>
              )}
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
