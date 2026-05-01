"use client";

import Link from "next/link";
import { useLang } from "@/lib/i18n/context";
import { Testimonials } from "@/components/public/testimonials";
import { RegisterBanner } from "@/components/public/register-banner";
import { CurrencyPackages } from "./currency-packages";
import type { Package } from "@/types/database";

interface PackagesContentProps {
  packages: Package[];
  paypalEnabled: boolean;
  isAuthenticated: boolean;
}

export function PackagesContent({ packages, paypalEnabled, isAuthenticated }: PackagesContentProps) {
  const { t } = useLang();

  return (
    <div>
      <section className="islamic-pattern relative overflow-hidden pt-24 pb-16 text-center">
        <div className="pointer-events-none absolute inset-0 bg-gradient-to-b from-background/40 via-transparent to-background" aria-hidden="true" />
        <div className="relative mx-auto max-w-3xl px-6">
          <nav aria-label={t("مسار الصفحة", "Breadcrumb")} className="text-xs text-muted-light">
            <Link href="/" className="text-gold transition-colors hover:text-gold-light focus-ring">{t("الرئيسية", "Home")}</Link>
            <span className="mx-2 text-muted-light" aria-hidden="true">/</span>
            <span className="text-muted">{t("باقاتنا", "Packages")}</span>
          </nav>
          <h1 className="font-display mt-4 text-4xl font-bold leading-tight sm:text-5xl">{t("باقاتنا", "Our Packages")}</h1>
          <p className="mx-auto mt-3 max-w-xl text-sm leading-relaxed text-muted sm:text-base">
            {t(
              "ابدأ بجلسة تجريبية مجانية، ثم اختر الباقة التي تناسب جدولك.",
              "Start with a free trial, then pick the plan that fits your schedule.",
            )}
          </p>
        </div>
      </section>

      {/* Launch phase note — calm, no FOMO. */}
      <section className="border-y border-gold/20 bg-gold/[0.04] py-10" aria-labelledby="launch-note-heading">
        <div className="mx-auto max-w-3xl px-6 text-center">
          <span className="inline-flex items-center gap-1.5 rounded-full border border-gold/30 bg-gold/10 px-3 py-1 text-[11px] font-medium uppercase tracking-wider text-gold">
            {t("مرحلة الإطلاق", "Launch phase")}
          </span>
          <h2 id="launch-note-heading" className="font-display mt-4 text-2xl font-bold md:text-3xl">
            {t("الوصول إلى المنصة", "Platform access is")}{" "}
            <span className="text-gold">{t("مجاني حالياً", "free during launch")}</span>
          </h2>
          <p className="mx-auto mt-3 max-w-xl text-sm leading-relaxed text-muted">
            {t(
              "نريد أن يبدأ كل من يرغب في تعلّم القرآن بدون عائق مالي خلال مرحلة الإطلاق. التسعير معروض هنا للمرجعية، وسنتواصل معك قبل أي تغيير.",
              "We want anyone who wishes to learn the Quran to begin without a financial barrier during our launch. Pricing is shown for reference; we'll reach out before anything changes.",
            )}
          </p>
          <Link
            href="/register"
            className="glass-gold glass-pill mt-6 inline-flex items-center gap-2 px-7 py-2.5 text-sm font-semibold text-background transition-colors hover:bg-gold-hover focus-ring"
          >
            {t("ابدأ الآن", "Start now")}
          </Link>
        </div>
      </section>

      <CurrencyPackages packages={packages} paypalEnabled={paypalEnabled} isAuthenticated={isAuthenticated} />

      {/* Discounts */}
      <section className="border-t border-white/10 py-24">
        <div className="mx-auto max-w-4xl px-6">
          <p className="text-sm font-medium tracking-widest text-gold">❖ {t("خصومات", "Discounts")}</p>
          <h2 className="font-display mt-3 text-3xl font-bold leading-tight">{t("سياسة الخصومات", "Discount Policy")}</h2>
          <div className="mt-12 grid gap-4 md:grid-cols-3">
            {[
              { ar: "دفع سنوي", en: "Annual Payment", save: t("وفّر ٢٠٪", "Save 20%") },
              { ar: "دفع نصف سنوي", en: "Semi-Annual", save: t("وفّر ١٠٪", "Save 10%") },
              { ar: "دفع ربع سنوي", en: "Quarterly", save: t("وفّر ٥٪", "Save 5%") },
            ].map((d) => (
              <div key={d.en} className="glass-card p-6 text-center">
                <p className="font-bold">{t(d.ar, d.en)}</p>
                <p className="font-display mt-2 text-2xl font-bold text-gold">{d.save}</p>
              </div>
            ))}
          </div>

          <div className="glass-card mt-12 p-8">
            <h3 className="text-lg font-bold">{t("برنامج الإحالة", "Referral Program")}</h3>
            <p className="mt-2 text-sm text-muted">{t("أحِل أصدقاءك واحصل على خصم:", "Refer friends and get a discount:")}</p>
            <div className="mt-4 flex flex-wrap gap-6 text-sm">
              <span>{t("إحالة طالب واحد →", "Refer 1 student →")} <strong className="text-gold">{t("خصم ١٥٪", "15% off")}</strong></span>
              <span>{t("إحالة طالبين →", "Refer 2 students →")} <strong className="text-gold">{t("خصم ٢٥٪", "25% off")}</strong></span>
            </div>
          </div>
        </div>
      </section>

      <div className="border-t border-white/10"><Testimonials /></div>
      <RegisterBanner />
    </div>
  );
}
