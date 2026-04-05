"use client";

import Link from "next/link";
import { Clock, Globe, Heart, Users } from "lucide-react";
import { useLang } from "@/lib/i18n/context";
import { Testimonials } from "@/components/public/testimonials";
import { FreeTrialBanner } from "@/components/public/free-trial-banner";

export function AboutContent() {
  const { t } = useLang();

  return (
    <div>
      <section className="border-b border-card-border bg-card py-20 text-center">
        <p className="text-sm text-muted"><Link href="/" className="text-gold hover:text-gold-light">{t("الرئيسية", "Home")}</Link> / {t("من نحن", "About")}</p>
        <h1 className="font-display mt-4 text-5xl font-bold">{t("من نحن", "About Us")}</h1>
      </section>

      <section className="py-24">
        <div className="mx-auto max-w-7xl px-6 md:flex md:gap-16">
          <div className="flex-1">
            <p className="text-sm font-medium tracking-widest text-gold">❖ {t("قصتنا", "Our Story")}</p>
            <h2 className="font-display mt-3 text-3xl font-bold">{t("عن أكاديمية فرقان", "About FURQAN Academy")}</h2>
            <div className="mt-8 space-y-6 text-sm leading-relaxed text-muted">
              <p>{t(
                "أكاديمية فرقان كيان مستقل يديره فريق من المتخصصين المتفانين. نرحب بالجميع لتعلم تعاليم القرآن الكريم بغض النظر عن جنسياتهم أو خلفياتهم. هدفنا أن يفهم كل مسلم أصول دينه ويطبق تعاليم القرآن في حياته اليومية.",
                "FURQAN Academy is an independent institution run by a team of dedicated specialists. We welcome everyone to learn the teachings of the Holy Quran regardless of nationality or background. Our goal is for every Muslim to understand the foundations of their faith and apply Quranic teachings in daily life.",
              )}</p>
              <p>{t(
                "ندرك صعوبة حضور الدروس القرآنية في المساجد بالنسبة لمسلمي المهجر. لذلك أنشأنا منصة رقمية متكاملة تمكّنك من التعلم من راحة بيتك، في الوقت الذي يناسبك، مع معلم خاص حاصل على الإجازة.",
                "We understand the difficulty of attending Quran lessons at mosques for Muslims living abroad. That's why we created a comprehensive digital platform that enables you to learn from the comfort of your home, at a time that suits you, with a certified private teacher.",
              )}</p>
              <p>{t(
                "جميع معلمينا متمكنون من اللغة الإنجليزية، مما يجعل الجلسات فعّالة ومثمرة لطلاب المهجر الذين قد يحتاجون شرحاً بالعربية والإنجليزية معاً.",
                "All our teachers are fluent in English, making sessions effective and productive for diaspora students who may need explanations in both Arabic and English.",
              )}</p>
            </div>
          </div>
          <div className="mt-12 grid grid-cols-2 gap-4 md:mt-0 md:w-80">
            {[
              { num: t("٢٤/٧", "24/7"), label: t("متاح على مدار الساعة", "Available Anytime") },
              { num: t("إجازة", "Ijazah"), label: t("معلمون معتمدون", "Certified Teachers") },
              { num: t("١:١", "1:1"), label: t("جلسات فردية مباشرة", "Live Private Sessions") },
              { num: t("مجاناً", "Free"), label: t("جلسة تجريبية", "Trial Session") },
            ].map((s) => (
              <div key={s.label} className="rounded-xl border border-card-border bg-card p-5 text-center">
                <p className="font-display text-2xl font-bold text-gold">{s.num}</p>
                <p className="mt-1 text-xs text-muted">{s.label}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="border-t border-card-border bg-card/30 py-24">
        <div className="mx-auto max-w-7xl px-6">
          <p className="text-sm font-medium tracking-widest text-gold">❖ {t("قيمنا", "Our Values")}</p>
          <h2 className="font-display mt-3 text-3xl font-bold">{t("ما نؤمن به", "What We Believe")}</h2>
          <div className="mt-12 grid gap-6 md:grid-cols-4">
            {[
              { icon: Heart, ar: "الإخلاص في الخدمة", en: "Sincere Service", dAr: "نؤمن بأن تعليم القرآن أمانة عظيمة نسعى لأدائها بإتقان", dEn: "We believe teaching Quran is a great trust we strive to fulfill with excellence" },
              { icon: Users, ar: "الاهتمام الفردي", en: "Individual Attention", dAr: "كل طالب يحصل على اهتمام كامل ومنهج مخصص لأهدافه", dEn: "Every student gets full attention and a customized plan for their goals" },
              { icon: Clock, ar: "المرونة والالتزام", en: "Flexibility & Commitment", dAr: "نحترم وقتك ونلتزم بالمواعيد مع مرونة كاملة في الجدولة", dEn: "We respect your time and commit to schedules with full scheduling flexibility" },
              { icon: Globe, ar: "خدمة الأمة", en: "Serving the Ummah", dAr: "نسعى لخدمة المسلمين في كل مكان وتسهيل تعلم القرآن للجميع", dEn: "We strive to serve Muslims everywhere and make Quran learning accessible to all" },
            ].map((v) => (
              <div key={v.en} className="rounded-xl border border-card-border bg-surface p-6">
                <v.icon size={24} className="mb-3 text-gold" />
                <h3 className="font-bold">{t(v.ar, v.en)}</h3>
                <p className="mt-2 text-sm text-muted">{t(v.dAr, v.dEn)}</p>
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
