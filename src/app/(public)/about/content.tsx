"use client";

import Link from "next/link";
import { useLang } from "@/lib/i18n/context";
import { Testimonials } from "@/components/public/testimonials";
import { RegisterBanner } from "@/components/public/register-banner";
import { resolveIcon } from "@/lib/site-content/icon-map";
import type { SiteFeature } from "@/lib/site-content/types";

export function AboutContent({ values }: { values: SiteFeature[] }) {
  const { t } = useLang();

  return (
    <div>
      <section className="glass-card border-b border-white/10 py-20 text-center">
        <p className="text-sm text-muted"><Link href="/" className="text-gold hover:text-gold-light">{t("الرئيسية", "Home")}</Link> / {t("من نحن", "About")}</p>
        <h1 className="font-display mt-4 text-5xl font-bold leading-tight">{t("من نحن", "About Us")}</h1>
      </section>

      <section className="py-24">
        <div className="mx-auto max-w-7xl px-6 md:flex md:gap-16">
          <div className="flex-1">
            <p className="text-sm font-medium tracking-widest text-gold">❖ {t("قصتنا", "Our Story")}</p>
            <h2 className="font-display mt-3 text-3xl font-bold leading-tight">{t("عن أكاديمية فرقان", "About FURQAN Academy")}</h2>
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
              { num: t("مجاناً", "Free"), label: t("التسجيل", "Registration") },
            ].map((s) => (
              <div key={s.label} className="glass-card p-5 text-center">
                <p className="font-display text-2xl font-bold text-gold">{s.num}</p>
                <p className="mt-1 text-xs text-muted">{s.label}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="border-t border-white/10 bg-card/30 py-24">
        <div className="mx-auto max-w-7xl px-6">
          <p className="text-sm font-medium tracking-widest text-gold">❖ {t("قيمنا", "Our Values")}</p>
          <h2 className="font-display mt-3 text-3xl font-bold leading-tight">{t("ما نؤمن به", "What We Believe")}</h2>
          <div className="mt-12 grid gap-6 md:grid-cols-4">
            {values.map((v) => {
              const Icon = resolveIcon(v.icon_name);
              return (
                <div key={v.id} className="glass-card p-6">
                  <Icon size={24} className="mb-3 text-gold" aria-hidden="true" />
                  <h3 className="font-bold">{t(v.title_ar, v.title_en)}</h3>
                  <p className="mt-2 text-sm text-muted">{t(v.description_ar ?? "", v.description_en ?? "")}</p>
                </div>
              );
            })}
          </div>
        </div>
      </section>

      <div className="border-t border-white/10"><Testimonials /></div>
      <RegisterBanner />
    </div>
  );
}
