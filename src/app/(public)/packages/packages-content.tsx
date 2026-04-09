"use client";

import Link from "next/link";
import { useLang } from "@/lib/i18n/context";
import { Testimonials } from "@/components/public/testimonials";
import { RegisterBanner } from "@/components/public/register-banner";
import { CurrencyPackages } from "./currency-packages";

export function PackagesContent() {
  const { t } = useLang();

  return (
    <div>
      <section className="glass-card border-b border-white/10 py-20 text-center">
        <p className="text-sm text-muted"><Link href="/" className="text-gold hover:text-gold-light">{t("الرئيسية", "Home")}</Link> / {t("باقاتنا", "Packages")}</p>
        <h1 className="font-display mt-4 text-5xl font-bold leading-tight">{t("باقاتنا", "Our Packages")}</h1>
      </section>

      {/* Free access banner */}
      <section className="border-b border-gold/30 bg-gold/5 py-8">
        <div className="mx-auto max-w-3xl px-6 text-center">
          <span className="glass-gold glass-pill mb-3 inline-block px-4 py-1 text-sm font-bold">
            {t("عرض لفترة محدودة", "Limited Time Offer")}
          </span>
          <h2 className="font-display mt-3 text-2xl font-bold md:text-3xl">
            {t("استخدام المنصة", "Platform access is")}{" "}
            <span className="text-gold">{t("مجاني بالكامل", "completely free")}</span>{" "}
            {t("حالياً", "right now")}
          </h2>
          <p className="mt-3 text-sm leading-relaxed text-muted">
            {t(
              "نحن في مرحلة الإطلاق، ونريد أن نتيح لأكبر عدد من المسلمين فرصة تعلّم القرآن بأفضل جودة وبدون أي تكلفة. جميع الباقات والخدمات متاحة مجاناً لفترة محدودة — سجّل الآن واستفد قبل انتهاء العرض.",
              "We're in our launch phase and want to give as many Muslims as possible the opportunity to learn Quran at the highest quality — completely free. All packages and services are available at no cost for a limited time. Register now before the offer ends.",
            )}
          </p>
          <Link href="/register" className="glass-gold glass-pill mt-6 inline-block px-8 py-3 font-semibold transition-colors hover:bg-gold-hover">
            {t("سجّل مجاناً الآن", "Register Free Now")}
          </Link>
        </div>
      </section>

      <CurrencyPackages />

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
