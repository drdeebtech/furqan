"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { LogoutButton } from "./logout-button";

type Role = "student" | "teacher" | "admin";

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
    { href: "/student/bookings", ar: "حجوزاتي", en: "Bookings" },
    { href: "/student/sessions", ar: "جلساتي", en: "Sessions" },
    { href: "/student/progress", ar: "تقدمي", en: "Progress" },
    { href: "/student/notes", ar: "الملاحظات", en: "Notes" },
    { href: "/student/messages", ar: "الرسائل", en: "Messages" },
  ],
  teacher: [
    { href: "/teacher/dashboard", ar: "لوحتي", en: "Dashboard" },
    { href: "/teacher/sessions", ar: "جلساتي", en: "Sessions" },
    { href: "/teacher/availability", ar: "المواعيد", en: "Availability" },
    { href: "/teacher/students", ar: "طلابي", en: "Students" },
    { href: "/teacher/messages", ar: "الرسائل", en: "Messages" },
  ],
  admin: [
    { href: "/admin/dashboard", ar: "لوحة الإدارة", en: "Dashboard" },
    { href: "/admin/users", ar: "المستخدمون", en: "Users", separator: true },
    { href: "/admin/teachers", ar: "المعلمون", en: "Teachers" },
    { href: "/admin/bookings", ar: "الحجوزات", en: "Bookings", separator: true },
    { href: "/admin/sessions", ar: "الجلسات", en: "Sessions" },
    { href: "/admin/payments", ar: "المالية", en: "Payments", separator: true },
    { href: "/admin/reviews", ar: "التقييمات", en: "Reviews", separator: true },
    { href: "/admin/blog", ar: "المدونة", en: "Blog" },
    { href: "/admin/settings", ar: "الإعدادات", en: "Settings", separator: true },
  ],
};

export function Nav({ role }: { role: Role }) {
  const pathname = usePathname();

  return (
    <nav
      dir="rtl"
      className="border-b border-surface-border bg-surface elevation-1"
      aria-label="Main navigation"
    >
      <div className="mx-auto flex max-w-5xl items-center justify-between px-4 py-2">
        <div className="flex items-center gap-1 overflow-x-auto">
          <Link
            href={`/${role}/dashboard`}
            className="ml-4 shrink-0 text-lg font-bold text-gold"
          >
            فُرقان
          </Link>

          {LINKS[role].map((link) => {
            const active = pathname === link.href || pathname.startsWith(`${link.href}/`);
            return (
              <span key={link.href} className="flex items-center">
                {link.separator && (
                  <div className="h-4 w-px bg-card-border mx-1" />
                )}
                <Link
                  href={link.href}
                  className={`shrink-0 rounded-full px-4 py-1.5 text-sm transition-all focus-ring ${
                    active
                      ? "bg-primary/20 font-medium text-foreground"
                      : "text-muted hover:bg-background hover:text-foreground"
                  }`}
                >
                  {link.ar}
                  <span className="mr-1 hidden text-xs opacity-50 sm:inline">
                    {link.en}
                  </span>
                </Link>
              </span>
            );
          })}
        </div>

        <LogoutButton />
      </div>
    </nav>
  );
}
