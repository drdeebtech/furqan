"use client";

import { useLang } from "@/lib/i18n/context";
import { useFeatureFlags } from "@/lib/feature-flags-context";

const REVIEWS = [
  { name: { ar: "أم حبيبة", en: "Umm Habiba" }, loc: "London 🇬🇧", ar: "ابني عمره ٥ سنوات ويحب جلساته كثيراً. معلمته رائعة جداً، ماشاء الله!", en: "My 5-year-old son loves his sessions so much. His teacher is amazing, MashaAllah!" },
  { name: { ar: "علي عمران", en: "Ali Imran" }, loc: "Manchester 🇬🇧", ar: "الحمد لله راضٍ جداً عن مستوى التعليم والمعلمين. أنصح فرقان بشدة.", en: "Alhamdulillah, very satisfied with the quality of teaching. Highly recommend FURQAN." },
  { name: { ar: "إسراء هاشمي", en: "Isra Hashimi" }, loc: "Toronto 🇨🇦", ar: "طفلاي يتعلمان القراءة بالتجويد الصحيح. المعلمون محترفون ومتفانون.", en: "Both my children are learning to read with proper Tajweed. The teachers are professional and dedicated." },
  { name: { ar: "شغفتة كنول", en: "Shagufta Kanwal" }, loc: "Dubai 🇦🇪", ar: "لم أتخيل أن التعلم عبر الإنترنت سيكون بهذا المستوى. الإدارة منظمة جداً.", en: "I never imagined online learning could be this good. The management is very organized." },
  { name: { ar: "أحمد يوسف", en: "Ahmed Yusuf" }, loc: "Sydney 🇦🇺", ar: "معلمون ممتازون يجعلون طفلي منخرطاً في التعلم. خدمة العملاء على أعلى مستوى!", en: "Excellent teachers who keep my child engaged. Customer service is top-notch!" },
  { name: { ar: "آني شيخ", en: "Annie Sheikh" }, loc: "New York 🇺🇸", ar: "استطعت حجز ٤ جلسات أسبوعياً مع طفل رضيع! الجدول مرن جداً.", en: "I managed to book 4 sessions a week even with a baby! The schedule is very flexible." },
  { name: { ar: "ماهين مسعود", en: "Mahin Masood" }, loc: "Houston 🇺🇸", ar: "مضى شهران على تعلم ابنتي وهي سعيدة جداً. المعلمة حنونة وصبورة.", en: "It's been two months and my daughter is very happy. Her teacher is kind and patient." },
  { name: { ar: "فاطمة السيد", en: "Fatima Al-Sayed" }, loc: "Kuwait 🇰🇼", ar: "أتممت حفظ جزء عمّ في ثلاثة أشهر بفضل الله ثم بفضل معلمي المتميز.", en: "I completed memorizing Juz Amma in just three months, by the grace of Allah and my wonderful teacher." },
];

export function Testimonials() {
  const { t } = useLang();
  const { hideReviews } = useFeatureFlags();

  if (hideReviews) return null;

  return (
    <section className="py-24">
      <div className="mx-auto max-w-7xl px-6">
        <div className="ornament-divider mb-6">
          <span className="text-gold/40">❖</span>
        </div>
        <p className="text-sm font-medium tracking-widest text-gold">{t("آراء الطلاب", "Student Reviews")}</p>
        <h2 className="font-display mt-3 text-4xl font-bold">{t("ماذا يقول طلابنا؟", "What Our Students Say")}</h2>

        <div className="mt-12 grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {REVIEWS.map((r) => (
            <div key={r.en} className="glass-card p-6 transition-all duration-300 hover:border-gold/30">
              <span className="text-3xl leading-none text-gold/20">❝</span>
              <p className="mt-2 text-sm leading-relaxed text-muted">{t(r.ar, r.en)}</p>
              <div className="mt-4 border-t border-white/10 pt-3">
                <p className="text-sm font-bold">{t(r.name.ar, r.name.en)}</p>
                <p className="text-xs text-muted">{r.loc}</p>
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
