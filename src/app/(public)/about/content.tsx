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
      {/* Hero — restrained editorial treatment instead of the full-width
          glass-card slab. Uses the islamic-pattern background with a soft
          fade so the heading reads quiet and dignified, not banner-shouty. */}
      <section className="islamic-pattern relative overflow-hidden pt-24 pb-16 text-center">
        <div className="pointer-events-none absolute inset-0 bg-gradient-to-b from-background/40 via-transparent to-background" aria-hidden="true" />
        <div className="relative mx-auto max-w-3xl px-6">
          <nav aria-label={t("مسار الصفحة", "Breadcrumb")} className="text-xs text-muted-light">
            <Link href="/" className="text-gold transition-colors hover:text-gold-light focus-ring">
              {t("الرئيسية", "Home")}
            </Link>
            <span className="mx-2 text-muted-light" aria-hidden="true">/</span>
            <span className="text-muted">{t("من نحن", "About")}</span>
          </nav>
          <h1 className="font-display mt-4 text-4xl font-bold leading-tight sm:text-5xl">
            {t("من نحن", "About Us")}
          </h1>
          <p className="mx-auto mt-3 max-w-xl text-sm leading-relaxed text-muted sm:text-base">
            {t(
              "أكاديمية مستقلة تخدم القرآن الكريم — معلمون معتمدون، جلسات فردية، من أي مكان في العالم.",
              "An independent academy in service of the Quran — Ijazah-certified teachers, 1-on-1 sessions, anywhere in the world.",
            )}
          </p>
        </div>
      </section>

      <section className="py-24">
        <div className="mx-auto max-w-7xl px-6 md:flex md:gap-16">
          <div className="flex-1">
            <p className="text-sm font-medium tracking-widest text-muted">❖ {t("قصتنا", "Our Story")}</p>
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
                <p className="font-display text-2xl font-bold text-foreground">{s.num}</p>
                <p className="mt-1 text-xs text-muted">{s.label}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* spec 035 US6 T031: org identity — leadership names must come from the business.
          TODO(business): supply founder/director name(s) + brief bio for publication.
          Until then, this section presents verifiable institutional facts only. */}
      <section className="border-t border-white/10 bg-card/30 py-20">
        <div className="mx-auto max-w-7xl px-6">
          <p className="text-sm font-medium tracking-widest text-muted">❖ {t("هويتنا المؤسسية", "Our Organization")}</p>
          <h2 className="font-display mt-3 text-3xl font-bold leading-tight">{t("كيان مستقل وشفاف", "Independent & Accountable")}</h2>
          <div className="mt-8 max-w-2xl space-y-4 text-sm leading-relaxed text-muted">
            <p>{t(
              "أكاديمية فرقان كيان مستقل لا يتبع أي جهة دينية أو حكومية. تُدار من قِبل فريق من المختصين في تعليم القرآن الكريم والتكنولوجيا التعليمية.",
              "FURQAN Academy is an independent institution, unaffiliated with any religious or governmental body. It is operated by a specialist team of Quran educators and educational technologists.",
            )}</p>
            <p>{t(
              "نلتزم بمعايير حماية الأطفال — جميع الجلسات مع معلمين معتمدين تحت رقابة المنصة، ولا تتم بدون إذن ولي الأمر للقاصرين. اقرأ",
              "We are committed to child-safeguarding standards — all sessions are with certified teachers under platform oversight, and no session proceeds for minors without parental consent. Read our",
            )}{" "}
            <a href="/privacy#safeguarding" className="text-gold hover:text-gold-light focus-ring">
              {t("سياسة حماية الأطفال", "Child Safeguarding Policy")}
            </a>.</p>
            <p>{t(
              "للاستفسارات المؤسسية والشراكات:",
              "For institutional inquiries and partnerships:",
            )}{" "}
            <a href="mailto:partnerships@furqan.today" className="text-gold hover:text-gold-light focus-ring">partnerships@furqan.today</a>
            {" — "}{t("أو", "or")}{" "}
            <a href="/contact#partnerships" className="text-gold hover:text-gold-light focus-ring">
              {t("نموذج الشراكة", "partnership form")}
            </a>.</p>
          </div>
        </div>
      </section>

      <section className="border-t border-white/10 bg-card/30 py-24">
        <div className="mx-auto max-w-7xl px-6">
          <p className="text-sm font-medium tracking-widest text-muted">❖ {t("قيمنا", "Our Values")}</p>
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
