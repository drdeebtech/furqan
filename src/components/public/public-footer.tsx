"use client";

import Link from "next/link";
import { useLang } from "@/lib/i18n/context";

export function PublicFooter() {
  const { t } = useLang();

  return (
    <footer className="border-t border-card-border bg-card">
      <div className="mx-auto grid max-w-7xl gap-8 px-6 py-12 md:grid-cols-4">
        <div>
          <span className="font-display text-2xl font-bold text-gold">فُرقان</span>
          <p className="mt-3 text-sm text-foreground">{t("أكاديمية القرآن الكريم عبر الإنترنت", "Online Quran Learning Academy")}</p>
          <p className="mt-1 text-xs text-muted">{t("نربط الطلاب بأفضل معلمي القرآن المعتمدين حول العالم", "Connecting students with certified Quran teachers worldwide")}</p>
        </div>

        <div>
          <h4 className="mb-3 text-sm font-bold text-gold">{t("روابط سريعة", "Quick Links")}</h4>
          <ul className="space-y-2 text-sm text-muted">
            {[
              { href: "/", ar: "الرئيسية", en: "Home" },
              { href: "/about", ar: "من نحن", en: "About" },
              { href: "/services", ar: "خدماتنا", en: "Services" },
              { href: "/packages", ar: "باقاتنا", en: "Packages" },
              { href: "/blog", ar: "المدونة", en: "Blog" },
              { href: "/contact", ar: "اتصل بنا", en: "Contact" },
              { href: "/login", ar: "🔒 بوابة الطلاب", en: "🔒 Student Portal" },
            ].map((l) => (
              <li key={l.href}><Link href={l.href} className="transition-colors hover:text-gold">{t(l.ar, l.en)}</Link></li>
            ))}
          </ul>
        </div>

        <div>
          <h4 className="mb-3 text-sm font-bold text-gold">{t("خدماتنا", "Our Services")}</h4>
          <ul className="space-y-2 text-sm text-muted">
            {[
              { ar: "حفظ القرآن", en: "Quran Memorization" },
              { ar: "تجويد القرآن", en: "Tajweed Rules" },
              { ar: "مراجعة الحفظ", en: "Revision" },
              { ar: "التلاوة", en: "Recitation" },
              { ar: "القراءات", en: "Qira'at" },
              { ar: "تفسير القرآن", en: "Tafsir" },
            ].map((s) => (
              <li key={s.en}><Link href="/services" className="transition-colors hover:text-gold">{t(s.ar, s.en)}</Link></li>
            ))}
          </ul>
        </div>

        <div>
          <h4 className="mb-3 text-sm font-bold text-gold">{t("تواصل معنا", "Contact Us")}</h4>
          <ul className="space-y-2 text-sm text-muted">
            <li><a href="https://wa.me/447400000000" className="transition-colors hover:text-gold">🇬🇧 +44 74 0000 0000</a></li>
            <li><a href="https://wa.me/12125550000" className="transition-colors hover:text-gold">🇺🇸 +1 212 555 0000</a></li>
            <li><a href="mailto:info@furqan.academy" className="transition-colors hover:text-gold">info@furqan.academy</a></li>
            <li className="text-xs">{t("متاح ٧ أيام في الأسبوع · ٢٤ ساعة", "Available 7 days a week · 24 hours")}</li>
          </ul>
        </div>
      </div>

      <div className="border-t border-card-border px-6 py-6">
        <p className="text-center text-xs text-muted">© {new Date().getFullYear()} {t("فرقان · جميع الحقوق محفوظة", "FURQAN · All rights reserved")}</p>
      </div>
    </footer>
  );
}
