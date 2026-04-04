import type { Metadata } from "next";
import Link from "next/link";
import { FreeTrialBanner } from "@/components/public/free-trial-banner";

export const metadata: Metadata = { title: "المدونة" };

const ARTICLES = [
  { cat: "حفظ القرآن", catColor: "text-emerald-400 border-emerald-500/30 bg-emerald-500/10", title: "كيف تبدأ رحلة حفظ القرآن الكريم؟", en: "How to Start Your Quran Memorization Journey", excerpt: "يبدأ كثير من المسلمين رحلتهم مع الحفظ بدون خطة واضحة. في هذا المقال نشاركك خطوات عملية لبدء رحلة الحفظ بالطريقة الصحيحة.", date: "١ يناير ٢٠٢٥", time: "٥ دقائق" },
  { cat: "تجويد", catColor: "text-sky-400 border-sky-500/30 bg-sky-500/10", title: "أحكام النون الساكنة والتنوين بطريقة مبسطة", en: "Noon Saakin Rules Made Simple", excerpt: "شرح مبسط لأحكام الإظهار والإدغام والإقلاب والإخفاء مع أمثلة عملية من القرآن الكريم.", date: "١٥ يناير ٢٠٢٥", time: "٧ دقائق" },
  { cat: "نصائح", catColor: "text-amber-400 border-amber-500/30 bg-amber-500/10", title: "٧ نصائح لتثبيت الحفظ وعدم النسيان", en: "7 Tips to Maintain Your Quran Memorization", excerpt: "نصائح مجربة من معلمين ذوي خبرة لتثبيت ما حفظته من القرآن ومنع النسيان.", date: "١ فبراير ٢٠٢٥", time: "٤ دقائق" },
  { cat: "للأطفال", catColor: "text-pink-400 border-pink-500/30 bg-pink-500/10", title: "كيف تساعد طفلك على حفظ القرآن؟", en: "How to Help Your Child Memorize Quran", excerpt: "نصائح لأولياء الأمور لتشجيع أطفالهم على حفظ القرآن بأسلوب ممتع ومحبب.", date: "١٥ فبراير ٢٠٢٥", time: "٦ دقائق" },
  { cat: "القراءات", catColor: "text-purple-400 border-purple-500/30 bg-purple-500/10", title: "ما الفرق بين رواية حفص ورواية ورش؟", en: "Hafs vs Warsh: Understanding the Difference", excerpt: "دليل شامل للفرق بين أشهر الروايات القرآنية وأين تُقرأ كل منها.", date: "١ مارس ٢٠٢٥", time: "٨ دقائق" },
  { cat: "تجويد", catColor: "text-sky-400 border-sky-500/30 bg-sky-500/10", title: "مخارج الحروف: دليل شامل للمبتدئين", en: "Arabic Letter Articulation Points: A Beginner's Guide", excerpt: "تعرف على مخارج الحروف العربية بالتفصيل لتحسين تلاوتك للقرآن الكريم.", date: "١٥ مارس ٢٠٢٥", time: "١٠ دقائق" },
];

/**
 * Renders the Arabic (RTL) blog landing page with a breadcrumb header, a featured article, an articles grid, a newsletter signup, and a free-trial banner.
 *
 * @returns A JSX element containing the complete blog page layout.
 */
export default function BlogPage() {
  return (
    <div dir="rtl">
      <section className="border-b border-card-border bg-card py-20 text-center">
        <p className="text-sm text-muted">
          <Link href="/" className="text-gold hover:text-gold-light">الرئيسية</Link> / المدونة
        </p>
        <h1 className="font-display mt-4 text-5xl font-bold">المدونة</h1>
        <p className="mt-2 text-muted">Blog & Resources</p>
      </section>

      {/* Featured article */}
      <section className="py-24">
        <div className="mx-auto max-w-7xl px-6">
          <div className="rounded-2xl border border-gold/30 bg-card p-8 md:p-12">
            <span className={`inline-block rounded-full border px-3 py-1 text-xs ${ARTICLES[0].catColor}`}>{ARTICLES[0].cat}</span>
            <h2 className="font-display mt-4 text-3xl font-bold">{ARTICLES[0].title}</h2>
            <p className="mt-2 text-sm text-muted">{ARTICLES[0].en}</p>
            <p className="mt-4 text-sm leading-relaxed text-muted">{ARTICLES[0].excerpt}</p>
            <div className="mt-4 flex items-center gap-4 text-xs text-muted">
              <span>{ARTICLES[0].date}</span>
              <span>{ARTICLES[0].time} للقراءة</span>
            </div>
            <span className="mt-4 inline-block text-sm font-medium text-gold">اقرأ المزيد ←</span>
          </div>

          {/* Articles grid */}
          <div className="mt-12 grid gap-6 md:grid-cols-2 lg:grid-cols-3">
            {ARTICLES.slice(1).map((a) => (
              <div key={a.en} className="rounded-xl border border-card-border bg-card p-5 transition-colors hover:border-gold/30">
                <span className={`inline-block rounded-full border px-2.5 py-0.5 text-xs ${a.catColor}`}>{a.cat}</span>
                <h3 className="mt-3 font-bold">{a.title}</h3>
                <p className="mt-1 text-xs text-muted">{a.en}</p>
                <p className="mt-2 line-clamp-2 text-sm text-muted">{a.excerpt}</p>
                <div className="mt-3 flex items-center justify-between text-xs text-muted">
                  <span>{a.date} · {a.time}</span>
                  <span className="text-gold">اقرأ المزيد →</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Newsletter */}
      <section className="border-t border-card-border bg-card/30 py-16">
        <div className="mx-auto max-w-lg px-6 text-center">
          <h2 className="font-display text-2xl font-bold">اشترك في نشرتنا البريدية</h2>
          <p className="mt-2 text-sm text-muted">Get Quran learning tips in your inbox</p>
          <div className="mt-6 flex gap-2">
            <input
              type="email"
              placeholder="بريدك الإلكتروني"
              dir="ltr"
              className="flex-1 rounded border border-input-border bg-input px-4 py-2.5 text-left text-sm text-foreground placeholder:text-muted/50 focus:border-gold focus:outline-none"
            />
            <button className="rounded bg-gold px-5 py-2.5 text-sm font-medium text-background transition-colors hover:bg-gold-hover">
              اشترك
            </button>
          </div>
          <p className="mt-3 text-xs text-muted">لن نشارك بريدك مع أحد · We never share your email</p>
        </div>
      </section>

      <FreeTrialBanner />
    </div>
  );
}
