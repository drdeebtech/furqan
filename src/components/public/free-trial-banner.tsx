"use client";

import Link from "next/link";
import { BookOpen } from "lucide-react";
import { useLang } from "@/lib/i18n/context";

export function FreeTrialBanner() {
  const { t } = useLang();

  return (
    <section className="px-4 py-16">
      <div className="mx-auto max-w-4xl rounded-3xl border border-gold/20 bg-gradient-to-l from-gold/5 via-gold/10 to-gold/5 p-12 text-center md:p-16">
        <BookOpen size={40} className="mx-auto mb-4 text-gold" />
        <h2 className="font-display text-3xl font-bold">{t("ابدأ رحلتك مع القرآن اليوم", "Start Your Quran Journey Today")}</h2>
        <p className="font-display mt-4 text-lg text-gold/50">﴿ وَرَتِّلِ الْقُرْآنَ تَرْتِيلًا ﴾</p>
        <div className="mt-8 flex flex-wrap justify-center gap-4">
          <Link href="/contact" className="rounded border border-gold bg-gold px-8 py-3 font-semibold text-background transition-colors hover:bg-gold-hover">
            {t("احجز جلسة تجريبية مجانية", "Book a Free Trial Session")}
          </Link>
          <Link href="/packages" className="rounded border border-card-border px-8 py-3 text-muted transition-colors hover:border-gold/40 hover:text-gold">
            {t("تعرف على باقاتنا", "View Our Packages")}
          </Link>
        </div>
        <p className="mt-4 text-xs text-muted">{t("✓ مجاني · ✓ بدون بطاقة ائتمان · ✓ خلال ٢٤ ساعة", "✓ Free · ✓ No credit card · ✓ Within 24 hours")}</p>
      </div>
    </section>
  );
}
