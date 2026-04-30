"use client";

import Link from "next/link";
import { BookOpen, Check } from "lucide-react";
import { useLang } from "@/lib/i18n/context";

export function RegisterBanner() {
  const { t } = useLang();

  return (
    <section className="px-4 py-20" aria-labelledby="register-banner-heading">
      <div className="relative mx-auto max-w-4xl overflow-hidden rounded-3xl border border-gold/20 bg-surface/40 p-10 text-center md:p-14">
        {/* Soft gold halo behind the icon. */}
        <div className="pointer-events-none absolute -top-20 left-1/2 h-64 w-64 -translate-x-1/2 rounded-full bg-gold/10 blur-3xl" aria-hidden="true" />
        <div className="relative">
          <div className="mx-auto inline-flex h-14 w-14 items-center justify-center rounded-2xl bg-gold/10 text-gold">
            <BookOpen size={26} aria-hidden="true" />
          </div>
          <h2 id="register-banner-heading" className="font-display mt-5 text-3xl font-bold sm:text-4xl">
            {t("ابدأ رحلتك مع القرآن اليوم", "Start Your Quran Journey Today")}
          </h2>
          <p className="font-display mt-4 text-lg text-gold/70 sm:text-xl">
            ﴿ وَرَتِّلِ الْقُرْآنَ تَرْتِيلًا ﴾
          </p>

          <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
            <Link
              href="/register"
              className="glass-gold glass-pill inline-flex items-center gap-2 px-8 py-3 font-semibold text-background transition-colors duration-200 hover:bg-gold-hover focus-ring"
            >
              {t("سجّل الآن", "Register Now")}
            </Link>
            <Link
              href="/packages"
              className="glass glass-pill inline-flex items-center gap-2 px-6 py-3 text-sm font-medium text-gold transition-colors hover:bg-gold/10 focus-ring"
            >
              {t("تعرف على باقاتنا", "View our packages")}
              <span aria-hidden="true">→</span>
            </Link>
          </div>

          <ul className="mx-auto mt-6 flex max-w-xl flex-wrap items-center justify-center gap-x-5 gap-y-2 text-xs text-muted">
            <li className="inline-flex items-center gap-1.5">
              <Check size={12} className="text-success" aria-hidden="true" />
              <span>{t("التسجيل مجاني", "Free registration")}</span>
            </li>
            <li className="inline-flex items-center gap-1.5">
              <Check size={12} className="text-success" aria-hidden="true" />
              <span>{t("ابدأ خلال ٢٤ ساعة", "Start within 24 hours")}</span>
            </li>
            <li className="inline-flex items-center gap-1.5">
              <Check size={12} className="text-success" aria-hidden="true" />
              <span>{t("جلسة تجريبية متاحة", "Trial session available")}</span>
            </li>
          </ul>
        </div>
      </div>
    </section>
  );
}
