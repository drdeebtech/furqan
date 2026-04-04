"use client";

import Link from "next/link";
import { useLang } from "@/lib/i18n/context";
import { FreeTrialBanner } from "@/components/public/free-trial-banner";

const ARTICLES = [
  { cat: { ar: "حفظ القرآن", en: "Hifz" }, color: "text-emerald-400 border-emerald-500/30 bg-emerald-500/10", ar: "كيف تبدأ رحلة حفظ القرآن الكريم؟", en: "How to Start Your Quran Memorization Journey", exAr: "يبدأ كثير من المسلمين رحلتهم مع الحفظ بدون خطة واضحة. في هذا المقال نشاركك خطوات عملية لبدء رحلة الحفظ بالطريقة الصحيحة.", exEn: "Many Muslims start their memorization journey without a clear plan. In this article, we share practical steps to begin your Hifz journey the right way.", date: { ar: "١ يناير ٢٠٢٥", en: "Jan 1, 2025" }, time: { ar: "٥ دقائق", en: "5 min" } },
  { cat: { ar: "تجويد", en: "Tajweed" }, color: "text-sky-400 border-sky-500/30 bg-sky-500/10", ar: "أحكام النون الساكنة والتنوين بطريقة مبسطة", en: "Noon Saakin & Tanween Rules Made Simple", exAr: "شرح مبسط لأحكام الإظهار والإدغام والإقلاب والإخفاء مع أمثلة عملية من القرآن الكريم.", exEn: "A simplified explanation of Idh-haar, Idghaam, Iqlaab and Ikhfaa rules with practical Quran examples.", date: { ar: "١٥ يناير ٢٠٢٥", en: "Jan 15, 2025" }, time: { ar: "٧ دقائق", en: "7 min" } },
  { cat: { ar: "نصائح", en: "Tips" }, color: "text-amber-400 border-amber-500/30 bg-amber-500/10", ar: "٧ نصائح لتثبيت الحفظ وعدم النسيان", en: "7 Tips to Maintain Your Quran Memorization", exAr: "نصائح مجربة من معلمين ذوي خبرة لتثبيت ما حفظته من القرآن ومنع النسيان.", exEn: "Proven tips from experienced teachers to retain your Quran memorization and prevent forgetting.", date: { ar: "١ فبراير ٢٠٢٥", en: "Feb 1, 2025" }, time: { ar: "٤ دقائق", en: "4 min" } },
  { cat: { ar: "للأطفال", en: "Children" }, color: "text-pink-400 border-pink-500/30 bg-pink-500/10", ar: "كيف تساعد طفلك على حفظ القرآن؟", en: "How to Help Your Child Memorize Quran", exAr: "نصائح لأولياء الأمور لتشجيع أطفالهم على حفظ القرآن بأسلوب ممتع ومحبب.", exEn: "Tips for parents to encourage children to memorize Quran in a fun and engaging way.", date: { ar: "١٥ فبراير ٢٠٢٥", en: "Feb 15, 2025" }, time: { ar: "٦ دقائق", en: "6 min" } },
  { cat: { ar: "القراءات", en: "Qira'at" }, color: "text-purple-400 border-purple-500/30 bg-purple-500/10", ar: "ما الفرق بين رواية حفص ورواية ورش؟", en: "Hafs vs Warsh: Understanding the Difference", exAr: "دليل شامل للفرق بين أشهر الروايات القرآنية وأين تُقرأ كل منها.", exEn: "A comprehensive guide to the differences between the most well-known Quran readings and where each is recited.", date: { ar: "١ مارس ٢٠٢٥", en: "Mar 1, 2025" }, time: { ar: "٨ دقائق", en: "8 min" } },
  { cat: { ar: "تجويد", en: "Tajweed" }, color: "text-sky-400 border-sky-500/30 bg-sky-500/10", ar: "مخارج الحروف: دليل شامل للمبتدئين", en: "Arabic Letter Articulation: A Beginner's Guide", exAr: "تعرف على مخارج الحروف العربية بالتفصيل لتحسين تلاوتك للقرآن الكريم.", exEn: "Learn about Arabic letter articulation points in detail to improve your Quran recitation.", date: { ar: "١٥ مارس ٢٠٢٥", en: "Mar 15, 2025" }, time: { ar: "١٠ دقائق", en: "10 min" } },
];

export function BlogContent() {
  const { t } = useLang();

  return (
    <div>
      <section className="border-b border-card-border bg-card py-20 text-center">
        <p className="text-sm text-muted"><Link href="/" className="text-gold hover:text-gold-light">{t("الرئيسية", "Home")}</Link> / {t("المدونة", "Blog")}</p>
        <h1 className="font-display mt-4 text-5xl font-bold">{t("المدونة", "Blog")}</h1>
      </section>

      <section className="py-24">
        <div className="mx-auto max-w-7xl px-6">
          {/* Featured */}
          <div className="rounded-2xl border border-gold/30 bg-card p-8 md:p-12">
            <span className={`inline-block rounded-full border px-3 py-1 text-xs ${ARTICLES[0].color}`}>{t(ARTICLES[0].cat.ar, ARTICLES[0].cat.en)}</span>
            <h2 className="font-display mt-4 text-3xl font-bold">{t(ARTICLES[0].ar, ARTICLES[0].en)}</h2>
            <p className="mt-4 text-sm leading-relaxed text-muted">{t(ARTICLES[0].exAr, ARTICLES[0].exEn)}</p>
            <div className="mt-4 flex items-center gap-4 text-xs text-muted">
              <span>{t(ARTICLES[0].date.ar, ARTICLES[0].date.en)}</span>
              <span>{t(ARTICLES[0].time.ar, ARTICLES[0].time.en)} {t("للقراءة", "read")}</span>
            </div>
            <span className="mt-4 inline-block text-sm font-medium text-gold">{t("اقرأ المزيد ←", "Read More →")}</span>
          </div>

          {/* Grid */}
          <div className="mt-12 grid gap-6 md:grid-cols-2 lg:grid-cols-3">
            {ARTICLES.slice(1).map((a) => (
              <div key={a.en} className="rounded-xl border border-card-border bg-card p-5 transition-colors hover:border-gold/30">
                <span className={`inline-block rounded-full border px-2.5 py-0.5 text-xs ${a.color}`}>{t(a.cat.ar, a.cat.en)}</span>
                <h3 className="mt-3 font-bold">{t(a.ar, a.en)}</h3>
                <p className="mt-2 line-clamp-2 text-sm text-muted">{t(a.exAr, a.exEn)}</p>
                <div className="mt-3 flex items-center justify-between text-xs text-muted">
                  <span>{t(a.date.ar, a.date.en)} · {t(a.time.ar, a.time.en)}</span>
                  <span className="text-gold">{t("اقرأ المزيد →", "Read More →")}</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Newsletter */}
      <section className="border-t border-card-border bg-card/30 py-16">
        <div className="mx-auto max-w-lg px-6 text-center">
          <h2 className="font-display text-2xl font-bold">{t("اشترك في نشرتنا البريدية", "Subscribe to Our Newsletter")}</h2>
          <p className="mt-2 text-sm text-muted">{t("نصائح أسبوعية لتعلم القرآن", "Weekly Quran learning tips in your inbox")}</p>
          <div className="mt-6 flex gap-2">
            <input type="email" placeholder={t("بريدك الإلكتروني", "Your email")} dir="ltr" className="flex-1 rounded border border-input-border bg-input px-4 py-2.5 text-left text-sm text-foreground placeholder:text-muted/50 focus:border-gold focus:outline-none" />
            <button className="rounded bg-gold px-5 py-2.5 text-sm font-medium text-background transition-colors hover:bg-gold-hover">{t("اشترك", "Subscribe")}</button>
          </div>
          <p className="mt-3 text-xs text-muted">{t("لن نشارك بريدك مع أحد", "We never share your email")}</p>
        </div>
      </section>

      <FreeTrialBanner />
    </div>
  );
}
