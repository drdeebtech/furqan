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
    { href: "/student/sessions", ar: "جلساتي", en: "Sessions" },
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

/**
 * Render the responsive right-to-left main navigation bar for the given user role.
 *
 * @param role - The user's role which determines the set of navigation links to display
 * @returns The navigation `<nav>` element containing role-specific links and a logout control
 */
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
            const active = pathname.startsWith(link.href);
            return (
              <Link
                key={link.href}
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
            );
          })}
        </div>

        <LogoutButton />
      </div>
    </nav>
  );
}
