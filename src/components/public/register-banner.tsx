"use client";

import Link from "next/link";
import { BookOpen } from "lucide-react";
import { useLang } from "@/lib/i18n/context";

export function RegisterBanner() {
  const { t } = useLang();

  return (
    <section className="px-4 py-16">
      <div className="mx-auto max-w-4xl glass-card p-12 text-center md:p-16">
        <BookOpen size={40} className="mx-auto mb-4 text-gold" />
        <h2 className="font-display text-3xl font-bold">{t("ابدأ رحلتك مع القرآن اليوم", "Start Your Quran Journey Today")}</h2>
        <p className="font-display mt-4 text-lg text-gold/50">﴿ وَرَتِّلِ الْقُرْآنَ تَرْتِيلًا ﴾</p>
        <div className="mt-8 flex flex-wrap justify-center gap-4">
          <Link href="/register" className="focus-ring glass-gold glass-pill px-8 py-3 font-semibold transition-colors duration-200 hover:bg-gold-hover">
            {t("سجّل الآن", "Register Now")}
          </Link>
          <Link href="/packages" className="focus-ring inline-flex items-center gap-1.5 px-4 py-3 text-muted transition-colors hover:text-gold">
            {t("تعرف على باقاتنا", "View our packages")}
            <span aria-hidden>→</span>
          </Link>
        </div>
        <p className="mt-4 text-xs text-muted">{t("✓ التسجيل مجاني · ✓ ابدأ خلال ٢٤ ساعة", "✓ Free registration · ✓ Start within 24 hours")}</p>
      </div>
    </section>
  );
}
