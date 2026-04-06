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
      className="border-b border-surface-border bg-surface elevation-1"
      aria-label="Main navigation"
    >
      {/* Row 1: Logo + Role label + Hamburger + Logout */}
      <div className="mx-auto flex max-w-5xl items-center justify-between px-4 py-2">
        <Link
          href={`/${role}/dashboard`}
          className="flex shrink-0 items-center gap-2"
        >
          <Image src="/logo-192.png" alt="فرقان" width={28} height={28} className="rounded-full" />
          <span className="text-lg font-bold text-gold">فُرقان</span>
          <span className="text-xs text-muted">({lang === "ar" ? ROLE_LABEL[role].ar : ROLE_LABEL[role].en})</span>
          {userName && <span className="hidden text-sm font-medium sm:inline">{userName}</span>}
        </Link>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setMenuOpen((v) => !v)}
            className="rounded-full border border-surface-border p-2 text-muted hover:text-foreground md:hidden focus-ring"
            aria-label="القائمة"
            aria-expanded={menuOpen}
            aria-controls="nav-links"
          >
            {menuOpen ? <X size={20} /> : <Menu size={20} />}
          </button>
          <LangToggle />
          <LogoutButton />
        </div>
      </div>

      {/* Row 2: Nav links — wrapping on desktop, toggled on mobile */}
      <div
        id="nav-links"
        className={`mx-auto max-w-5xl border-t border-surface-border px-4 pb-2 pt-1 ${
          menuOpen ? "block" : "hidden"
        } md:block`}
      >
        <div className="flex flex-wrap items-center gap-1">
          {LINKS[role].map((link) => {
            const active = pathname === link.href || pathname.startsWith(`${link.href}/`);
            return (
              <span key={link.href} className="flex items-center">
                {link.separator && (
                  <div className="h-4 w-px bg-card-border mx-1" />
                )}
                <Link
                  href={link.href}
                  className={`rounded-full px-4 py-1.5 text-sm transition-all focus-ring ${
                    active
                      ? "bg-primary/20 font-medium text-foreground"
                      : "text-muted hover:bg-background hover:text-foreground"
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
