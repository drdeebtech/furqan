"use client";

import Link from "next/link";
import { CheckCircle } from "lucide-react";
import { useLang } from "@/lib/i18n/context";
import { Testimonials } from "@/components/public/testimonials";
import { FreeTrialBanner } from "@/components/public/free-trial-banner";

const SERVICES = [
  {
    ar: "حفظ القرآن الكريم", en: "Quran Memorization (Hifz)",
    dAr: "منهج تدريجي من سورة الناس إلى الفاتحة وصولاً للحزب الأول. مراجعة يومية مع المعلم لتثبيت المحفوظ. خطة حفظ مخصصة حسب قدرات الطالب.",
    dEn: "A gradual method from Surah An-Nas to Al-Fatihah. Daily review with the teacher to consolidate memorization. A personalized plan based on the student's abilities.",
    fAr: ["جلسات يومية أو أسبوعية حسب اختيارك", "مراجعة منهجية للمحفوظ", "تقرير تقدم أسبوعي مفصّل", "شهادة إتمام الحفظ"],
    fEn: ["Daily or weekly sessions as you choose", "Systematic review of memorized portions", "Detailed weekly progress report", "Completion certificate"],
  },
  {
    ar: "أحكام التجويد", en: "Tajweed Rules",
    dAr: "تعلم مخارج الحروف وصفاتها، أحكام النون الساكنة والتنوين، وأحكام المد والقصر. منهج علمي ممنهج من المبتدئ إلى المتقدم.",
    dEn: "Learn articulation points and letter characteristics, Noon Saakin and Tanween rules, and elongation rules. A structured scientific approach from beginner to advanced.",
    fAr: ["من المبتدئ إلى المتقدم", "تصحيح الأخطاء الشائعة", "تطبيق عملي في كل جلسة", "إجازة في التجويد"],
    fEn: ["Beginner to advanced levels", "Correction of common mistakes", "Practical application in every session", "Tajweed Ijazah certification"],
  },
  {
    ar: "المراجعة", en: "Revision (Muraja'a)",
    dAr: "برنامج مراجعة منهجي لتثبيت ما تم حفظه. يراجع المعلم معك يومياً ويتابع مستوى الحفظ ويحدد الأجزاء التي تحتاج تقوية.",
    dEn: "A systematic revision program to consolidate memorization. The teacher reviews with you daily, monitors your level, and identifies areas needing reinforcement.",
    fAr: ["جدول مراجعة يومي مخصص", "تقييم مستوى الحفظ أسبوعياً", "تقنيات لتثبيت الحفظ", "ربط السور ببعضها"],
    fEn: ["Customized daily revision schedule", "Weekly memorization assessment", "Retention techniques", "Connecting surahs together"],
  },
  {
    ar: "التلاوة", en: "Recitation (Tilawa)",
    dAr: "حسّن تلاوتك مع شيخ متخصص. تصحيح النطق وتحسين الأداء والتعرف على أساليب التلاوة الصحيحة.",
    dEn: "Improve your recitation with a specialized sheikh. Pronunciation correction, performance improvement, and learning proper recitation methods.",
    fAr: ["تصحيح مخارج الحروف", "تحسين الأداء الصوتي", "التعرف على الوقف والابتداء", "تطبيق عملي مستمر"],
    fEn: ["Letter articulation correction", "Voice performance improvement", "Stopping and starting rules", "Continuous practical application"],
  },
  {
    ar: "القراءات", en: "Qira'at (Multiple Readings)",
    dAr: "تعلّم روايات حفص عن عاصم وورش عن نافع وقالون والدوري وشعبة مع معلمين حاصلين على الإجازة في كل رواية.",
    dEn: "Learn the readings of Hafs from Asim, Warsh from Nafi, Qalun, Al-Duri and Shu'ba with teachers certified in each reading.",
    fAr: ["رواية حفص عن عاصم", "رواية ورش عن نافع", "رواية قالون عن نافع", "إجازة في القراءة"],
    fEn: ["Hafs from Asim", "Warsh from Nafi", "Qalun from Nafi", "Reading Ijazah certification"],
  },
  {
    ar: "التفسير", en: "Tafsir (Interpretation)",
    dAr: "افهم معاني القرآن وتدبّر آياته. دروس في التفسير تربط الآيات بالحياة اليومية وتعمّق فهمك لكتاب الله.",
    dEn: "Understand the meanings of the Quran and reflect on its verses. Tafsir lessons connecting verses to daily life and deepening your understanding of Allah's Book.",
    fAr: ["تفسير مبسط للمبتدئين", "ربط الآيات بالواقع", "أسباب النزول", "دروس في علوم القرآن"],
    fEn: ["Simplified tafsir for beginners", "Connecting verses to reality", "Reasons for revelation", "Quranic sciences lessons"],
  },
];

export function ServicesContent() {
  const { t } = useLang();

  return (
    <div>
      <section className="border-b border-card-border bg-card py-20 text-center">
        <p className="text-sm text-muted"><Link href="/" className="text-gold hover:text-gold-light">{t("الرئيسية", "Home")}</Link> / {t("خدماتنا", "Services")}</p>
        <h1 className="font-display mt-4 text-5xl font-bold">{t("خدماتنا", "Our Services")}</h1>
      </section>

      <section className="py-24">
        <div className="mx-auto max-w-5xl space-y-16 px-6">
          {SERVICES.map((s, i) => (
            <div key={s.en} className={`gap-12 md:flex ${i % 2 === 1 ? "md:flex-row-reverse" : ""}`}>
              <div className="flex-1">
                <p className="text-sm font-medium tracking-widest text-gold">❖ {s.en}</p>
                <h2 className="font-display mt-2 text-3xl font-bold">{t(s.ar, s.en)}</h2>
                <p className="mt-4 text-sm leading-relaxed text-muted">{t(s.dAr, s.dEn)}</p>
                <ul className="mt-6 space-y-2">
                  {(t(s.fAr.join("|||"), s.fEn.join("|||"))).split("|||").map((f) => (
                    <li key={f} className="flex items-start gap-2 text-sm">
                      <CheckCircle size={16} className="mt-0.5 shrink-0 text-gold" />
                      <span className="text-muted">{f}</span>
                    </li>
                  ))}
                </ul>
                <Link href="/contact" className="mt-6 inline-block rounded border border-gold bg-gold/10 px-5 py-2 text-sm font-medium text-gold transition-colors hover:bg-gold hover:text-background">
                  {t("احجز جلسة تجريبية", "Book a Trial Session")}
                </Link>
              </div>
              <div className="mt-8 flex-1 md:mt-0">
                <div className="flex h-full items-center justify-center rounded-2xl border border-card-border bg-card p-12">
                  <span className="font-display text-6xl text-gold/10">{s.ar.charAt(0)}</span>
                </div>
              </div>
            </div>
          ))}
        </div>
      </section>

      <div className="border-t border-card-border"><Testimonials /></div>
      <FreeTrialBanner />
    </div>
  );
}
