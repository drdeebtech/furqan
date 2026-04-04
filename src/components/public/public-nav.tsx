"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Menu, X } from "lucide-react";

const NAV_LINKS = [
  { href: "/", ar: "الرئيسية", en: "Home" },
  { href: "/about", ar: "من نحن", en: "About" },
  { href: "/services", ar: "خدماتنا", en: "Services" },
  { href: "/packages", ar: "باقاتنا", en: "Packages" },
  { href: "/teachers-page", ar: "المعلمون", en: "Teachers" },
  { href: "/blog", ar: "المدونة", en: "Blog" },
  { href: "/contact", ar: "اتصل بنا", en: "Contact" },
];

export function PublicNav() {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);

  return (
    <>
      {/* Top bar */}
      <div className="border-b border-gold/20 bg-gold/5 px-4 py-2">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-2 text-xs text-muted">
          <div className="flex items-center gap-4">
            <a href="https://wa.me/966500000000" className="transition-colors hover:text-gold">🇸🇦 +966 50 000 0000</a>
            <a href="https://wa.me/447400000000" className="transition-colors hover:text-gold">🇬🇧 +44 74 0000 0000</a>
          </div>
          <span className="hidden sm:inline">info@furqan.academy</span>
          <div className="flex gap-3">
            <span className="cursor-pointer transition-colors hover:text-gold">FB</span>
            <span className="cursor-pointer transition-colors hover:text-gold">IG</span>
            <span className="cursor-pointer transition-colors hover:text-gold">YT</span>
          </div>
        </div>
      </div>

      {/* Main nav */}
      <nav className="sticky top-0 z-50 border-b border-card-border bg-background/95 backdrop-blur">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-4 py-3">
          <Link href="/" className="font-display text-2xl font-bold text-gold">فُرقان</Link>

          {/* Desktop links */}
          <div className="hidden items-center gap-1 lg:flex">
            {NAV_LINKS.map((link) => {
              const active = pathname === link.href;
              return (
                <Link
                  key={link.href}
                  href={link.href}
                  className={`px-3 py-2 text-sm transition-colors ${active ? "font-medium text-gold" : "text-muted hover:text-foreground"}`}
                >
                  {link.ar}
                </Link>
              );
            })}
          </div>

          {/* Desktop CTAs */}
          <div className="hidden items-center gap-3 lg:flex">
            <Link href="/login" className="text-sm text-muted transition-colors hover:text-gold">تسجيل الدخول</Link>
            <Link
              href="/contact"
              className="rounded border border-gold bg-gold/10 px-4 py-2 text-sm font-medium text-gold transition-colors hover:bg-gold hover:text-background"
            >
              جلسة تجريبية مجانية
            </Link>
          </div>

          {/* Mobile hamburger */}
          <button
            onClick={() => setOpen(!open)}
            className="lg:hidden text-foreground focus-ring"
            aria-label={open ? "إغلاق القائمة" : "فتح القائمة"}
          >
            {open ? <X size={24} /> : <Menu size={24} />}
          </button>
        </div>

        {/* Mobile dropdown */}
        {open && (
          <div className="border-t border-card-border bg-surface px-4 py-4 lg:hidden">
            {NAV_LINKS.map((link) => (
              <Link
                key={link.href}
                href={link.href}
                onClick={() => setOpen(false)}
                className={`block py-2.5 text-sm ${pathname === link.href ? "font-medium text-gold" : "text-muted"}`}
              >
                {link.ar} <span className="text-xs opacity-50">{link.en}</span>
              </Link>
            ))}
            <div className="mt-4 flex flex-col gap-2 border-t border-card-border pt-4">
              <Link href="/login" className="text-sm text-muted">تسجيل الدخول</Link>
              <Link href="/contact" className="rounded bg-gold px-4 py-2.5 text-center text-sm font-medium text-background">
                جلسة تجريبية مجانية
              </Link>
            </div>
          </div>
        )}
      </nav>
    </>
  );
}
