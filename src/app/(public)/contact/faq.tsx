"use client";

import { useState } from "react";
import { ChevronDown } from "lucide-react";
import { useLang } from "@/lib/i18n/context";

const FAQS = [
  { ar: "هل الجلسة التجريبية مجانية تماماً؟", en: "Is the trial session completely free?", aAr: "نعم، الجلسة التجريبية مجانية بالكامل بدون أي التزامات أو بطاقة ائتمان. ستدوم الجلسة ٣٠ دقيقة مع معلم متخصص.", aEn: "Yes, the trial session is completely free with no obligations or credit card required. The session lasts 30 minutes with a specialized teacher." },
  { ar: "كيف تتم الجلسات؟", en: "How do sessions work?", aAr: "تتم الجلسات عبر نظام الفيديو المدمج في منصة فرقان. بعد تأكيد الحجز ستحصل على رابط الجلسة مباشرة.", aEn: "Sessions are conducted via the built-in video system in the FURQAN platform. After booking confirmation, you'll receive a session link directly." },
  { ar: "هل يتوفر معلمات للأخوات؟", en: "Are female teachers available?", aAr: "نعم، لدينا معلمات متخصصات ومعتمدات للأخوات والأطفال في بيئة آمنة تماماً.", aEn: "Yes, we have specialized and certified female teachers for sisters and children in a completely safe environment." },
  { ar: "ما هي مؤهلات المعلمين؟", en: "What are the teachers' qualifications?", aAr: "جميع معلمينا حاصلون على إجازة في رواية حفص عن عاصم من علماء معتمدين، وخريجو جامعات إسلامية مرموقة.", aEn: "All our teachers hold Ijazah in Hafs narration from certified scholars and are graduates of prestigious Islamic universities." },
  { ar: "هل يمكنني تغيير موعد جلستي؟", en: "Can I reschedule my session?", aAr: "نعم، يمكنك إعادة الجدولة قبل ٢٤ ساعة من الجلسة بدون أي رسوم إضافية.", aEn: "Yes, you can reschedule up to 24 hours before the session at no additional cost." },
  { ar: "ما مدة العقد الأدنى؟", en: "What is the minimum contract?", aAr: "لا يوجد عقد. يمكنك الاشتراك شهراً بشهر وإلغاء الاشتراك في أي وقت بدون رسوم.", aEn: "There is no contract. You can subscribe month-to-month and cancel anytime with no fees." },
  { ar: "هل يتوفر برنامج للأطفال؟", en: "Is there a children's program?", aAr: "نعم، لدينا برنامج خاص بالأطفال من سن ٥ سنوات بأسلوب تعليمي ممتع ومناسب لأعمارهم.", aEn: "Yes, we have a special program for children from age 5 with a fun and age-appropriate teaching style." },
  { ar: "كيف أتابع تقدم طفلي؟", en: "How do I track my child's progress?", aAr: "يحصل ولي الأمر على تقرير تقدم مفصل بعد كل جلسة، ويمكنه متابعة لوحة التقدم في حساب الطالب.", aEn: "Parents receive a detailed progress report after each session and can monitor the progress dashboard in the student account." },
];

export function FAQ() {
  const [openIndex, setOpenIndex] = useState<number | null>(null);
  const { t } = useLang();

  return (
    <section className="py-24">
      <div className="mx-auto max-w-3xl px-6">
        <p className="text-sm font-medium tracking-widest text-gold">❖ {t("أسئلة شائعة", "FAQ")}</p>
        <h2 className="font-display mt-3 text-3xl font-bold">{t("الأسئلة الشائعة", "Frequently Asked Questions")}</h2>

        <div className="mt-12 space-y-2">
          {FAQS.map((faq, i) => (
            <div key={i} className="rounded-xl border border-card-border bg-card">
              <button
                onClick={() => setOpenIndex(openIndex === i ? null : i)}
                className="flex w-full items-center justify-between px-6 py-4 text-right text-sm font-medium transition-colors hover:text-gold focus-ring"
              >
                {t(faq.ar, faq.en)}
                <ChevronDown size={18} className={`shrink-0 text-muted transition-transform ${openIndex === i ? "rotate-180" : ""}`} />
              </button>
              {openIndex === i && (
                <div className="border-t border-card-border px-6 py-4">
                  <p className="text-sm leading-relaxed text-muted">{t(faq.aAr, faq.aEn)}</p>
                </div>
              )}
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
