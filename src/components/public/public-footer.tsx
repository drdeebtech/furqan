"use client";

import Link from "next/link";
import Image from "next/image";
import { useLang } from "@/lib/i18n/context";
import { CONTACT } from "@/lib/contact";

export function PublicFooter() {
  const { t } = useLang();

  return (
    <footer className="glass-card">
      <div className="gold-line" />
      <div className="mx-auto grid max-w-7xl gap-8 px-6 py-12 md:grid-cols-4">
        <div>
          <div className="flex items-center gap-2">
            <Image src="/logo-192.png" alt="فرقان" width={32} height={32} sizes="32px" className="rounded-full" loading="lazy" />
            <span className="font-display text-2xl font-bold text-gold">فُرقان</span>
          </div>
          <p className="mt-3 text-sm text-foreground">{t("أكاديمية القرآن الكريم عبر الإنترنت", "Online Quran Learning Academy")}</p>
          <p className="mt-1 text-xs text-muted">{t("نربط الطلاب بأفضل معلمي القرآن المعتمدين حول العالم", "Connecting students with certified Quran teachers worldwide")}</p>
        </div>

        <div>
          <h3 className="mb-3 text-sm font-bold text-gold">{t("روابط سريعة", "Quick Links")}</h3>
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
              <li key={l.href}><Link href={l.href} className="inline-block transition-all duration-200 hover:text-gold">{t(l.ar, l.en)}</Link></li>
            ))}
          </ul>
        </div>

        <div>
          <h3 className="mb-3 text-sm font-bold text-gold">{t("خدماتنا", "Our Services")}</h3>
          <ul className="space-y-2 text-sm text-muted">
            {[
              { ar: "حفظ القرآن", en: "Quran Memorization" },
              { ar: "تجويد القرآن", en: "Tajweed Rules" },
              { ar: "مراجعة الحفظ", en: "Revision" },
              { ar: "التلاوة", en: "Recitation" },
              { ar: "القراءات", en: "Qira'at" },
              { ar: "تفسير القرآن", en: "Tafsir" },
            ].map((s) => (
              <li key={s.en}><Link href="/services" className="inline-block transition-all duration-200 hover:text-gold">{t(s.ar, s.en)}</Link></li>
            ))}
          </ul>
        </div>

        <div>
          <h3 className="mb-3 text-sm font-bold text-gold">{t("تواصل معنا", "Contact Us")}</h3>
          <ul className="space-y-2 text-sm text-muted">
            <li><a href={CONTACT.whatsappUrl} target="_blank" rel="noopener noreferrer" className="flex items-center gap-2 transition-all duration-200 hover:text-gold">{CONTACT.flag} {t("واتساب:", "WhatsApp:")} {CONTACT.whatsapp}</a></li>
            <li><a href={CONTACT.emailUrl} className="transition-all duration-200 hover:text-gold">{CONTACT.email}</a></li>
            <li className="text-xs">{t(CONTACT.availability.ar, CONTACT.availability.en)}</li>
          </ul>
        </div>
      </div>

      <div className="border-t border-white/10 px-6 py-6">
        <p className="text-center text-xs text-muted">© 2026 {t("فرقان · جميع الحقوق محفوظة", "FURQAN · All rights reserved")}</p>
      </div>
    </footer>
  );
}
