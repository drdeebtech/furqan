"use client";

import Link from "next/link";
import Image from "next/image";
import { Lock } from "lucide-react";
import { useLang } from "@/lib/i18n/context";
import { CONTACT } from "@/lib/contact";

export function PublicFooter() {
  const { t } = useLang();

  return (
    <footer className="glass-card">
      <div className="gold-line" />
      <div className="mx-auto grid max-w-7xl gap-8 px-6 py-12 md:grid-cols-4">
        <div>
          <Link href="/" className="inline-flex items-center gap-2 focus-ring rounded-lg" aria-label={t("الصفحة الرئيسية", "Home")}>
            <Image src="/logo-192.png" alt="فرقان" width={32} height={32} sizes="32px" className="rounded-full" loading="lazy" />
            <span className="font-display text-2xl font-bold text-gold">فُرقان</span>
          </Link>
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
              { href: "/blog", ar: "المدونة", en: "Blog" },
              { href: "/contact", ar: "اتصل بنا", en: "Contact" },
            ].map((l) => (
              <li key={l.href}><Link href={l.href} className="inline-flex py-1.5 transition-all duration-200 hover:text-gold focus-ring">{t(l.ar, l.en)}</Link></li>
            ))}
            <li>
              <Link href="/login" className="inline-flex items-center gap-1.5 py-1.5 transition-all duration-200 hover:text-gold focus-ring">
                <Lock size={12} aria-hidden="true" />
                {t("بوابة الطلاب", "Student Portal")}
              </Link>
            </li>
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
              <li key={s.en}><Link href="/services" className="inline-flex py-1.5 transition-all duration-200 hover:text-gold">{t(s.ar, s.en)}</Link></li>
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
        <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-3 text-xs text-muted">
          <p>© 2026 {t("فرقان · جميع الحقوق محفوظة", "FURQAN · All rights reserved")}</p>
          <nav aria-label={t("روابط قانونية", "Legal links")} className="flex flex-wrap items-center gap-x-4 gap-y-1">
            <Link href="/privacy" className="transition-colors hover:text-gold">{t("الخصوصية", "Privacy")}</Link>
            <Link href="/terms" className="transition-colors hover:text-gold">{t("الشروط", "Terms")}</Link>
            <Link href="/cookies" className="transition-colors hover:text-gold">{t("الكوكيز", "Cookies")}</Link>
          </nav>
        </div>
      </div>
    </footer>
  );
}
