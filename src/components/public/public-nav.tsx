"use client";

import { useState } from "react";
import Link from "next/link";
import Image from "next/image";
import { usePathname } from "next/navigation";
import { Menu, X } from "lucide-react";
import { useLang } from "@/lib/i18n/context";
import { LangToggle } from "@/lib/i18n/lang-toggle";
import { ThemeToggle } from "@/lib/theme/theme-toggle";
import { useFeatureFlags } from "@/lib/feature-flags-context";
import { CONTACT } from "@/lib/contact";

const BASE_LINKS = [
  { href: "/", ar: "الرئيسية", en: "Home" },
  { href: "/about", ar: "من نحن", en: "About" },
  { href: "/services", ar: "خدماتنا", en: "Services" },
  { href: "/packages", ar: "باقاتنا", en: "Packages" },
  { href: "/courses", ar: "الدورات المسجلة", en: "Courses" },
];

const TEACHERS_LINK = { href: "/teachers", ar: "المعلمون", en: "Teachers" };

const TAIL_LINKS = [
  { href: "/blog", ar: "المدونة", en: "Blog" },
  { href: "/teach-with-us", ar: "درّس معنا", en: "Teach With Us" },
  { href: "/contact", ar: "اتصل بنا", en: "Contact" },
];

export function PublicNav({ dashboardHref }: { dashboardHref?: string }) {
  const pathname = usePathname();
  const { t } = useLang();
  const { hideTeachersPage } = useFeatureFlags();
  const NAV_LINKS = [...BASE_LINKS, ...(!hideTeachersPage ? [TEACHERS_LINK] : []), ...TAIL_LINKS];
  const [open, setOpen] = useState(false);

  return (
    <>
      {/* Top bar */}
      <div className="border-b border-gold/20 bg-gold/5 px-4 py-2">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-2 text-xs text-muted">
          <div className="flex items-center gap-4">
            <a href={CONTACT.whatsappUrl} target="_blank" rel="noopener noreferrer" className="flex items-center gap-1 transition-colors hover:text-gold">{CONTACT.flag} {CONTACT.whatsapp}</a>
          </div>
          <a href={CONTACT.emailUrl} className="hidden transition-colors hover:text-gold sm:inline">{CONTACT.email}</a>
          {/* Social links — add back when accounts are ready */}
        </div>
      </div>

      {/* Main nav */}
      <nav className="sticky top-0 z-50 glass">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-4 py-3">
          <Link href="/" className="flex items-center gap-2">
            <Image src="/logo-192.png" alt="فرقان" width={32} height={32} sizes="32px" className="rounded-full" priority />
            <span className="font-display text-2xl font-bold text-gold">فُرقان</span>
          </Link>

          {/* Desktop links */}
          <div className="hidden items-center gap-1 lg:flex">
            {NAV_LINKS.map((link) => {
              const active = pathname === link.href;
              return (
                <Link
                  key={link.href}
                  href={link.href}
                  className={`glass-nav-item px-3 py-2 text-sm transition-all duration-200 ${active ? "font-medium text-gold" : "text-muted hover:text-foreground"}`}
                >
                  {t(link.ar, link.en)}
                </Link>
              );
            })}
          </div>

          {/* Desktop CTAs */}
          <div className="hidden items-center gap-3 lg:flex">
            <ThemeToggle />
            <LangToggle />
            {dashboardHref ? (
              <Link
                href={dashboardHref}
                className="glass glass-pill px-4 py-2 text-sm font-medium text-gold transition-all duration-200 hover:bg-gold hover:text-background"
              >
                {t("لوحتي", "My Dashboard")}
              </Link>
            ) : (
              <>
                <Link href="/login" className="text-sm text-muted transition-colors hover:text-gold">
                  {t("تسجيل الدخول", "Sign In")}
                </Link>
                <Link
                  href="/register"
                  className="glass glass-pill px-4 py-2 text-sm font-medium text-gold transition-all duration-200 hover:bg-gold hover:text-background"
                >
                  {t("سجّل الآن", "Register Now")}
                </Link>
              </>
            )}
          </div>

          {/* Mobile: theme + lang + hamburger only.
              Register CTA lives in the dropdown to keep the brand visible
              on small screens (was overlapping at <380px viewports). */}
          <div className="flex items-center gap-2 lg:hidden">
            <ThemeToggle />
            <LangToggle />
            <button
              onClick={() => setOpen(!open)}
              className="inline-flex min-h-[44px] min-w-[44px] items-center justify-center text-foreground focus-ring"
              aria-label={open ? t("إغلاق القائمة", "Close menu") : t("فتح القائمة", "Open menu")}
              aria-expanded={open}
              aria-controls="mobile-nav"
            >
              {open ? <X size={24} /> : <Menu size={24} />}
            </button>
          </div>
        </div>

        {/* Mobile dropdown */}
        {open && (
          <div id="mobile-nav" className="glass-card px-4 py-4 lg:hidden">
            {NAV_LINKS.map((link) => (
              <Link
                key={link.href}
                href={link.href}
                onClick={() => setOpen(false)}
                className={`flex min-h-[44px] items-center py-2 text-sm transition-colors duration-200 ${pathname === link.href ? "font-medium text-gold" : "text-muted hover:text-foreground"}`}
              >
                {t(link.ar, link.en)}
              </Link>
            ))}
            <div className="mt-4 flex flex-col gap-2 border-t border-white/10 pt-4">
              {dashboardHref ? (
                <Link href={dashboardHref} className="inline-flex min-h-[44px] items-center justify-center glass-gold glass-pill px-4 text-sm font-medium transition-colors duration-200">
                  {t("لوحتي", "My Dashboard")}
                </Link>
              ) : (
                <>
                  <Link href="/login" className="flex min-h-[44px] items-center text-sm text-muted">
                    {t("تسجيل الدخول", "Sign In")}
                  </Link>
                  <Link href="/register" className="inline-flex min-h-[44px] items-center justify-center glass-gold glass-pill px-4 text-sm font-medium transition-colors duration-200">
                    {t("سجّل الآن", "Register Now")}
                  </Link>
                </>
              )}
            </div>
          </div>
        )}
      </nav>
    </>
  );
}
