"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { LogoutButton } from "./logout-button";

type Role = "student" | "teacher" | "admin";

const LINKS: Record<Role, { href: string; ar: string; en: string }[]> = {
  student: [
    { href: "/student/dashboard", ar: "لوحتي", en: "Dashboard" },
    { href: "/student/teachers", ar: "المعلمون", en: "Teachers" },
    { href: "/student/bookings", ar: "حجوزاتي", en: "Bookings" },
  ],
  teacher: [
    { href: "/teacher/dashboard", ar: "لوحتي", en: "Dashboard" },
    { href: "/teacher/sessions", ar: "جلساتي", en: "Sessions" },
    { href: "/teacher/availability", ar: "المواعيد", en: "Availability" },
  ],
  admin: [
    { href: "/admin/dashboard", ar: "لوحة الإدارة", en: "Dashboard" },
  ],
};

export function Nav({ role }: { role: Role }) {
  const pathname = usePathname();

  return (
    <nav
      dir="rtl"
      className="border-b border-card-border bg-card"
    >
      <div className="mx-auto flex max-w-5xl items-center justify-between px-4">
        {/* Logo + Links */}
        <div className="flex items-center gap-1">
          <Link
            href={`/${role}/dashboard`}
            className="ml-4 text-lg font-bold text-gold"
          >
            فُرقان
          </Link>

          {LINKS[role].map((link) => {
            const active = pathname === link.href;
            return (
              <Link
                key={link.href}
                href={link.href}
                className={`border-b-2 px-3 py-3 text-sm transition-colors ${
                  active
                    ? "border-gold text-gold"
                    : "border-transparent text-muted hover:text-foreground"
                }`}
              >
                {link.ar}
                <span className="mr-1 text-xs opacity-60">{link.en}</span>
              </Link>
            );
          })}
        </div>

        {/* Logout */}
        <LogoutButton />
      </div>
    </nav>
  );
}
