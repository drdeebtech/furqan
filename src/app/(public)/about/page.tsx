import type { Metadata } from "next";
import Link from "next/link";
import { Clock, Globe, Heart, Users } from "lucide-react";
import { Testimonials } from "@/components/public/testimonials";
import { FreeTrialBanner } from "@/components/public/free-trial-banner";

export const metadata: Metadata = { title: "من نحن" };

/**
 * Renders the Arabic "About FURQAN Academy" page UI in a right-to-left layout.
 *
 * Includes a breadcrumb header, about narrative, a grid of statistic cards, core values cards, a testimonials section, and a free-trial banner.
 *
 * @returns The page's JSX element.
 */
export default function AboutPage() {
  return (
    <div dir="rtl">
      {/* Header */}
      <section className="border-b border-card-border bg-card py-20 text-center">
        <p className="text-sm text-muted">
          <Link href="/" className="text-gold hover:text-gold-light">الرئيسية</Link> / من نحن
        </p>
        <h1 className="font-display mt-4 text-5xl font-bold">من نحن</h1>
        <p className="mt-2 text-muted">About FURQAN Academy</p>
      </section>

      {/* About content */}
      <section className="py-24">
        <div className="mx-auto max-w-7xl px-6 md:flex md:gap-16">
          <div className="flex-1">
            <p className="text-sm font-medium tracking-widest text-gold">❖ قصتنا</p>
            <h2 className="font-display mt-3 text-3xl font-bold">عن أكاديمية فرقان</h2>

            <div className="mt-8 space-y-6 text-sm leading-relaxed text-muted">
              <p>
                أكاديمية فرقان كيان مستقل يديره فريق من المتخصصين المتفانين.
                نرحب بالجميع لتعلم تعاليم القرآن الكريم بغض النظر عن جنسياتهم أو خلفياتهم.
                هدفنا أن يفهم كل مسلم أصول دينه ويطبق تعاليم القرآن في حياته اليومية.
              </p>
              <p>
                ندرك صعوبة حضور الدروس القرآنية في المساجد بالنسبة لمسلمي المهجر.
                لذلك أنشأنا منصة رقمية متكاملة تمكّنك من التعلم من راحة بيتك،
                في الوقت الذي يناسبك، مع معلم خاص حاصل على الإجازة.
              </p>
              <p>
                جميع معلمينا متمكنون من اللغة الإنجليزية، مما يجعل الجلسات فعّالة
                ومثمرة لطلاب المهجر الذين قد يحتاجون شرحاً بالعربية والإنجليزية معاً.
              </p>
            </div>
          </div>

          {/* Stats */}
          <div className="mt-12 grid grid-cols-2 gap-4 md:mt-0 md:w-80">
            {[
              { num: "١٥٠٠٠+", label: "طالب مسجل" },
              { num: "٥٠+", label: "معلم معتمد" },
              { num: "٥٠+", label: "دولة حول العالم" },
              { num: "٩٨٪", label: "نسبة رضا الطلاب" },
            ].map((s) => (
              <div key={s.label} className="rounded-xl border border-card-border bg-card p-5 text-center">
                <p className="font-display text-2xl font-bold text-gold">{s.num}</p>
                <p className="mt-1 text-xs text-muted">{s.label}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Values */}
      <section className="border-t border-card-border bg-card/30 py-24">
        <div className="mx-auto max-w-7xl px-6">
          <p className="text-sm font-medium tracking-widest text-gold">❖ قيمنا</p>
          <h2 className="font-display mt-3 text-3xl font-bold">ما نؤمن به</h2>

          <div className="mt-12 grid gap-6 md:grid-cols-4">
            {[
              { icon: Heart, title: "الإخلاص في الخدمة", desc: "نؤمن بأن تعليم القرآن أمانة عظيمة نسعى لأدائها بإتقان" },
              { icon: Users, title: "الاهتمام الفردي", desc: "كل طالب يحصل على اهتمام كامل ومنهج مخصص لأهدافه" },
              { icon: Clock, title: "المرونة والالتزام", desc: "نحترم وقتك ونلتزم بالمواعيد مع مرونة كاملة في الجدولة" },
              { icon: Globe, title: "خدمة الأمة", desc: "نسعى لخدمة المسلمين في كل مكان وتسهيل تعلم القرآن للجميع" },
            ].map((v) => (
              <div key={v.title} className="rounded-xl border border-card-border bg-surface p-6">
                <v.icon size={24} className="mb-3 text-gold" />
                <h3 className="font-bold">{v.title}</h3>
                <p className="mt-2 text-sm text-muted">{v.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <div className="border-t border-card-border"><Testimonials /></div>
      <FreeTrialBanner />
    </div>
  );
}
