import type { Metadata } from "next";
import Link from "next/link";
import { CheckCircle } from "lucide-react";
import { Testimonials } from "@/components/public/testimonials";
import { FreeTrialBanner } from "@/components/public/free-trial-banner";

export const metadata: Metadata = { title: "خدماتنا" };

const SERVICES = [
  {
    title: "حفظ القرآن الكريم",
    en: "Quran Memorization (Hifz)",
    desc: "منهج تدريجي من سورة الناس إلى الفاتحة وصولاً للحزب الأول. مراجعة يومية مع المعلم لتثبيت المحفوظ. خطة حفظ مخصصة حسب قدرات الطالب.",
    features: ["جلسات يومية أو أسبوعية حسب اختيارك", "مراجعة منهجية للمحفوظ", "تقرير تقدم أسبوعي مفصّل", "شهادة إتمام الحفظ"],
  },
  {
    title: "أحكام التجويد",
    en: "Tajweed Rules",
    desc: "تعلم مخارج الحروف وصفاتها، أحكام النون الساكنة والتنوين، وأحكام المد والقصر. منهج علمي ممنهج من المبتدئ إلى المتقدم.",
    features: ["من المبتدئ إلى المتقدم", "تصحيح الأخطاء الشائعة", "تطبيق عملي في كل جلسة", "إجازة في التجويد"],
  },
  {
    title: "المراجعة",
    en: "Revision (Muraja'a)",
    desc: "برنامج مراجعة منهجي لتثبيت ما تم حفظه. يراجع المعلم معك يومياً ويتابع مستوى الحفظ ويحدد الأجزاء التي تحتاج تقوية.",
    features: ["جدول مراجعة يومي مخصص", "تقييم مستوى الحفظ أسبوعياً", "تقنيات لتثبيت الحفظ", "ربط السور ببعضها"],
  },
  {
    title: "التلاوة",
    en: "Recitation (Tilawa)",
    desc: "حسّن تلاوتك مع شيخ متخصص. تصحيح النطق وتحسين الأداء والتعرف على أساليب التلاوة الصحيحة.",
    features: ["تصحيح مخارج الحروف", "تحسين الأداء الصوتي", "التعرف على الوقف والابتداء", "تطبيق عملي مستمر"],
  },
  {
    title: "القراءات",
    en: "Qira'at (Multiple Readings)",
    desc: "تعلّم روايات حفص عن عاصم وورش عن نافع وقالون والدوري وشعبة مع معلمين حاصلين على الإجازة في كل رواية.",
    features: ["رواية حفص عن عاصم", "رواية ورش عن نافع", "رواية قالون عن نافع", "إجازة في القراءة"],
  },
  {
    title: "التفسير",
    en: "Tafsir (Interpretation)",
    desc: "افهم معاني القرآن وتدبّر آياته. دروس في التفسير تربط الآيات بالحياة اليومية وتعمّق فهمك لكتاب الله.",
    features: ["تفسير مبسط للمبتدئين", "ربط الآيات بالواقع", "أسباب النزول", "دروس في علوم القرآن"],
  },
];

export default function ServicesPage() {
  return (
    <div dir="rtl">
      {/* Header */}
      <section className="border-b border-card-border bg-card py-20 text-center">
        <p className="text-sm text-muted">
          <Link href="/" className="text-gold hover:text-gold-light">الرئيسية</Link> / خدماتنا
        </p>
        <h1 className="font-display mt-4 text-5xl font-bold">خدماتنا</h1>
        <p className="mt-2 text-muted">Our Services</p>
      </section>

      {/* Services */}
      <section className="py-24">
        <div className="mx-auto max-w-5xl space-y-16 px-6">
          {SERVICES.map((s, i) => (
            <div key={s.en} className={`gap-12 md:flex ${i % 2 === 1 ? "md:flex-row-reverse" : ""}`}>
              {/* Text */}
              <div className="flex-1">
                <p className="text-sm font-medium tracking-widest text-gold">❖ {s.en}</p>
                <h2 className="font-display mt-2 text-3xl font-bold">{s.title}</h2>
                <p className="mt-4 text-sm leading-relaxed text-muted">{s.desc}</p>
                <ul className="mt-6 space-y-2">
                  {s.features.map((f) => (
                    <li key={f} className="flex items-start gap-2 text-sm">
                      <CheckCircle size={16} className="mt-0.5 shrink-0 text-gold" />
                      <span className="text-muted">{f}</span>
                    </li>
                  ))}
                </ul>
                <Link
                  href="/contact"
                  className="mt-6 inline-block rounded border border-gold bg-gold/10 px-5 py-2 text-sm font-medium text-gold transition-colors hover:bg-gold hover:text-background"
                >
                  احجز جلسة تجريبية
                </Link>
              </div>

              {/* Visual placeholder */}
              <div className="mt-8 flex-1 md:mt-0">
                <div className="flex h-full items-center justify-center rounded-2xl border border-card-border bg-card p-12">
                  <span className="font-display text-6xl text-gold/10">{s.title.charAt(0)}</span>
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
