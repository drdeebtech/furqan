"use client";

import Link from "next/link";
import Image from "next/image";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { Menu, X } from "lucide-react";
import { LogoutButton } from "./logout-button";
import { LangToggle } from "@/lib/i18n/lang-toggle";
import { useLang } from "@/lib/i18n/context";

type Role = "student" | "teacher" | "admin" | "moderator";

interface NavLink {
  href: string;
  ar: string;
  en: string;
  separator?: boolean;
}

const LINKS: Record<Role, NavLink[]> = {
  student: [
    { href: "/student/dashboard", ar: "لوحتي", en: "Dashboard" },
    { href: "/student/teachers", ar: "المعلمون", en: "Teachers" },
    { href: "/student/sessions", ar: "جلساتي", en: "Sessions" },
    { href: "/student/progress", ar: "تقدمي", en: "Progress" },
    { href: "/student/messages", ar: "الرسائل", en: "Messages" },
  ],
  teacher: [
    { href: "/teacher/dashboard", ar: "لوحتي", en: "Dashboard" },
    { href: "/teacher/availability", ar: "المواعيد", en: "Availability" },
    { href: "/teacher/sessions", ar: "جلساتي", en: "Sessions" },
    { href: "/teacher/students", ar: "طلابي", en: "Students" },
    { href: "/teacher/evaluations", ar: "التقييمات", en: "Evaluations" },
    { href: "/teacher/messages", ar: "الرسائل", en: "Messages" },
  ],
  admin: [
    { href: "/admin/dashboard", ar: "لوحة الإدارة", en: "Dashboard" },
    { href: "/admin/users", ar: "المستخدمون", en: "Users", separator: true },
    { href: "/admin/teachers", ar: "المعلمون", en: "Teachers" },
    { href: "/admin/bookings", ar: "الحجوزات", en: "Bookings", separator: true },
    { href: "/admin/sessions", ar: "الجلسات", en: "Sessions" },
    { href: "/admin/notes", ar: "ملاحظات الجلسات", en: "Notes" },
    { href: "/admin/evaluations", ar: "التقييمات", en: "Evaluations", separator: true },
    { href: "/admin/reviews", ar: "المراجعات", en: "Reviews" },
    { href: "/admin/payments", ar: "المالية", en: "Payments", separator: true },
    { href: "/admin/services", ar: "الخدمات", en: "Services" },
    { href: "/admin/blog", ar: "المدونة", en: "Blog" },
    { href: "/admin/contacts", ar: "رسائل التواصل", en: "Contacts" },
    { href: "/admin/notifications", ar: "الإشعارات", en: "Notifications" },
    { href: "/admin/settings", ar: "الإعدادات", en: "Settings", separator: true },
  ],
  moderator: [
    { href: "/moderator/dashboard", ar: "لوحة المشرف", en: "Dashboard" },
    { href: "/moderator/users", ar: "المستخدمون", en: "Users", separator: true },
    { href: "/moderator/cv-review", ar: "مراجعة السير", en: "CV Review" },
    { href: "/moderator/sessions", ar: "الجلسات", en: "Sessions", separator: true },
    { href: "/moderator/evaluations", ar: "التقييمات", en: "Evaluations" },
    { href: "/moderator/audit", ar: "سجل المراجعة", en: "Audit Log", separator: true },
  ],
};

const ROLE_LABEL: Record<Role, { ar: string; en: string }> = {
  admin: { ar: "الإدارة", en: "Admin" },
  teacher: { ar: "المعلم", en: "Teacher" },
  moderator: { ar: "المشرف", en: "Moderator" },
  student: { ar: "الطالب", en: "Student" },
};

export function Nav({ role, userName }: { role: Role; userName?: string }) {
  const pathname = usePathname();
  const { lang } = useLang();
  const [menuOpen, setMenuOpen] = useState(false);
  const [lastPath, setLastPath] = useState(pathname);
  if (pathname !== lastPath) {
    setLastPath(pathname);
    setMenuOpen(false);
  }

  return (
    <nav
      dir="rtl"
      className="border-b border-white/10 glass-card"
      aria-label="Main navigation"
    >
      {/* Row 1: Logo + Role label + Hamburger + Logout */}
      <div className="mx-auto flex max-w-5xl items-center justify-between px-4 py-2">
        <Link
          href={`/${role}/dashboard`}
          className="flex shrink-0 items-center gap-2"
        >
          <Image src="/logo-192.png" alt="فرقان" width={28} height={28} sizes="28px" className="rounded-full" />
          <span className="text-lg font-bold text-gold">فُرقان</span>
          <span className="text-xs text-muted">({lang === "ar" ? ROLE_LABEL[role].ar : ROLE_LABEL[role].en})</span>
          {userName && <span className="hidden text-sm font-medium sm:inline">{userName}</span>}
        </Link>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setMenuOpen((v) => !v)}
            className="glass glass-pill p-2 text-muted transition-colors hover:text-foreground md:hidden focus-ring"
            aria-label="القائمة"
            aria-expanded={menuOpen}
            aria-controls="nav-links"
          >
            {menuOpen ? <X size={20} /> : <Menu size={20} />}
          </button>
          <a
            href="https://wa.me/96598759229"
            target="_blank"
            rel="noopener noreferrer"
            className="flex h-8 w-8 items-center justify-center glass glass-pill glass-success text-green-400 transition-colors hover:bg-green-500/20"
            title="WhatsApp"
          >
            <svg viewBox="0 0 24 24" fill="currentColor" className="h-4 w-4"><path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z"/></svg>
          </a>
          <LangToggle />
          <LogoutButton />
        </div>
      </div>

      {/* Row 2: Nav links — wrapping on desktop, toggled on mobile */}
      <div
        id="nav-links"
        className={`mx-auto max-w-5xl border-t border-white/10 px-4 pb-2 pt-1 ${
          menuOpen ? "block" : "hidden"
        } md:block`}
      >
        <div className="flex flex-wrap items-center gap-1">
          {LINKS[role].map((link) => {
            const active = pathname === link.href || pathname.startsWith(`${link.href}/`);
            return (
              <span key={link.href} className="flex items-center">
                {link.separator && (
                  <div className="h-4 w-px bg-white/10 mx-1" />
                )}
                <Link
                  href={link.href}
                  className={`glass-nav-item rounded-full px-4 py-1.5 text-sm transition-colors focus-ring ${
                    active
                      ? "glass glass-gold font-medium text-foreground"
                      : "text-muted hover:text-foreground"
                  }`}
                >
                  {lang === "ar" ? link.ar : link.en}
                </Link>
              </span>
            );
          })}
        </div>
      </div>
    </nav>
  );
}
