"use client";

import Link from "next/link";
import Image from "next/image";
import { usePathname } from "next/navigation";
import { useState } from "react";
import {
  Menu, X, LayoutDashboard, GraduationCap, Calendar, TrendingUp,
  MessageSquare, Clock, Users, ClipboardCheck, BookOpen, StickyNote,
  Star, DollarSign, Briefcase, FileText, Mail, Bell, Settings, ScrollText, Video,
  ChevronsUpDown, MoreVertical,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { LogoutButton } from "./logout-button";
import { useLang } from "@/lib/i18n/context";

type Role = "student" | "teacher" | "admin" | "moderator";

interface NavLink {
  href: string;
  ar: string;
  en: string;
  icon: LucideIcon;
  group?: { ar: string; en: string };
}

const LINKS: Record<Role, NavLink[]> = {
  student: [
    { href: "/student/dashboard", ar: "لوحتي", en: "Dashboard", icon: LayoutDashboard, group: { ar: "الرئيسية", en: "MAIN" } },
    { href: "/student/teachers", ar: "المعلمون", en: "Teachers", icon: GraduationCap },
    { href: "/student/sessions", ar: "جلساتي", en: "Sessions", icon: Calendar },
    { href: "/student/progress", ar: "تقدمي", en: "Progress", icon: TrendingUp },
    { href: "/student/messages", ar: "الرسائل", en: "Messages", icon: MessageSquare },
  ],
  teacher: [
    { href: "/teacher/dashboard", ar: "لوحتي", en: "Dashboard", icon: LayoutDashboard, group: { ar: "الرئيسية", en: "MAIN" } },
    { href: "/teacher/availability", ar: "المواعيد", en: "Availability", icon: Clock },
    { href: "/teacher/sessions", ar: "جلساتي", en: "Sessions", icon: Calendar },
    { href: "/teacher/students", ar: "طلابي", en: "Students", icon: Users, group: { ar: "الطلاب", en: "STUDENTS" } },
    { href: "/teacher/evaluations", ar: "التقييمات", en: "Evaluations", icon: ClipboardCheck },
    { href: "/teacher/messages", ar: "الرسائل", en: "Messages", icon: MessageSquare },
  ],
  admin: [
    { href: "/admin/dashboard", ar: "لوحة الإدارة", en: "Dashboard", icon: LayoutDashboard, group: { ar: "الرئيسية", en: "MAIN" } },
    { href: "/admin/users", ar: "المستخدمون", en: "Users", icon: Users, group: { ar: "المستخدمون", en: "USERS" } },
    { href: "/admin/teachers", ar: "المعلمون", en: "Teachers", icon: GraduationCap },
    { href: "/admin/bookings", ar: "الحجوزات", en: "Bookings", icon: BookOpen, group: { ar: "الجلسات", en: "SESSIONS" } },
    { href: "/admin/sessions", ar: "الجلسات", en: "Sessions", icon: Calendar },
    { href: "/admin/notes", ar: "ملاحظات الجلسات", en: "Notes", icon: StickyNote },
    { href: "/admin/evaluations", ar: "التقييمات", en: "Evaluations", icon: ClipboardCheck, group: { ar: "الجودة", en: "QUALITY" } },
    { href: "/admin/reviews", ar: "المراجعات", en: "Reviews", icon: Star },
    { href: "/admin/payments", ar: "المالية", en: "Payments", icon: DollarSign, group: { ar: "المالية", en: "FINANCE" } },
    { href: "/admin/services", ar: "الخدمات", en: "Services", icon: Briefcase, group: { ar: "المحتوى", en: "CONTENT" } },
    { href: "/admin/blog", ar: "المدونة", en: "Blog", icon: FileText },
    { href: "/admin/contacts", ar: "رسائل التواصل", en: "Contacts", icon: Mail },
    { href: "/admin/notifications", ar: "الإشعارات", en: "Notifications", icon: Bell },
    { href: "/admin/settings", ar: "الإعدادات", en: "Settings", icon: Settings, group: { ar: "الإعدادات", en: "SETTINGS" } },
  ],
  moderator: [
    { href: "/moderator/dashboard", ar: "لوحة المشرف", en: "Dashboard", icon: LayoutDashboard, group: { ar: "الرئيسية", en: "MAIN" } },
    { href: "/moderator/users", ar: "المستخدمون", en: "Users", icon: Users, group: { ar: "الإدارة", en: "MANAGEMENT" } },
    { href: "/moderator/cv-review", ar: "مراجعة السير", en: "CV Review", icon: FileText },
    { href: "/moderator/sessions", ar: "الجلسات", en: "Sessions", icon: Video, group: { ar: "الجلسات", en: "SESSIONS" } },
    { href: "/moderator/evaluations", ar: "التقييمات", en: "Evaluations", icon: ClipboardCheck },
    { href: "/moderator/audit", ar: "سجل المراجعة", en: "Audit Log", icon: ScrollText, group: { ar: "التدقيق", en: "AUDIT" } },
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
  const { lang, dir } = useLang();
  const [menuOpen, setMenuOpen] = useState(false);
  const [lastPath, setLastPath] = useState(pathname);
  if (pathname !== lastPath) {
    setLastPath(pathname);
    setMenuOpen(false);
  }

  const t = (ar: string, en: string) => (lang === "ar" ? ar : en);
  const links = LINKS[role];

  // Group links by their group field
  const groups: { label: { ar: string; en: string } | null; links: NavLink[] }[] = [];
  let currentGroup: (typeof groups)[number] | null = null;
  for (const link of links) {
    if (link.group) {
      currentGroup = { label: link.group, links: [link] };
      groups.push(currentGroup);
    } else if (currentGroup) {
      currentGroup.links.push(link);
    } else {
      currentGroup = { label: null, links: [link] };
      groups.push(currentGroup);
    }
  }

  const sidebarContent = (
    <div dir={dir} className="flex h-full flex-col glass-sidebar">
      {/* Top: Logo + User */}
      <div className="border-b border-[var(--surface-border)] px-5 py-5">
        <Link href={`/${role}/dashboard`} className="flex items-center gap-3">
          <Image src="/logo-192.png" alt="فرقان" width={36} height={36} sizes="36px" className="rounded-full" />
          <div className="min-w-0 flex-1">
            {userName && <p className="truncate text-sm font-medium">{userName}</p>}
            <p className="text-xs text-[var(--muted-light,var(--muted))]">{lang === "ar" ? ROLE_LABEL[role].ar : ROLE_LABEL[role].en}</p>
          </div>
          <ChevronsUpDown size={14} className="shrink-0 text-[var(--muted)]" />
        </Link>
      </div>

      {/* Middle: Nav links */}
      <nav className="flex-1 overflow-y-auto px-3 py-4" aria-label="Main navigation">
        {groups.map((group, gi) => (
          <div key={gi} className={gi > 0 ? "mt-5" : ""}>
            {group.label && (
              <div className="mb-2 flex items-center justify-between px-3">
                <p className="text-[11px] font-medium uppercase tracking-[0.08em] text-[var(--muted-light,var(--muted))]">
                  {lang === "ar" ? group.label.ar : group.label.en}
                </p>
                <MoreVertical size={14} className="text-[var(--muted-light,var(--muted))]" />
              </div>
            )}
            <div className="space-y-0.5">
              {group.links.map((link) => {
                const active = pathname === link.href || pathname.startsWith(`${link.href}/`);
                const Icon = link.icon;
                return (
                  <Link
                    key={link.href}
                    href={link.href}
                    className={`flex min-h-[40px] items-center gap-3 rounded-xl px-3 py-2.5 text-sm transition-all focus-ring ${
                      active
                        ? "glass-nav-item active font-medium text-[var(--foreground)] shadow-sm"
                        : "text-[var(--muted)] hover:text-[var(--foreground)]"
                    }`}
                    data-active={active ? "true" : undefined}
                  >
                    <Icon size={18} className={active ? "text-[var(--foreground)]" : ""} />
                    <span>{lang === "ar" ? link.ar : link.en}</span>
                  </Link>
                );
              })}
            </div>
          </div>
        ))}
      </nav>

      {/* Bottom: Utility controls */}
      <div className="border-t border-[var(--surface-border)] px-3 py-4 space-y-1">
        <a
          href="https://wa.me/96598759229"
          target="_blank"
          rel="noopener noreferrer"
          className="flex min-h-[40px] items-center gap-3 rounded-xl px-3 py-2.5 text-sm text-[var(--muted)] transition-colors hover:text-[var(--foreground)]"
        >
          <svg viewBox="0 0 24 24" fill="currentColor" className="h-[18px] w-[18px] text-green-400"><path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z"/></svg>
          <span>{t("الدعم", "Support")}</span>
        </a>
        <div className="flex items-center gap-2 px-3 py-2">
          <LogoutButton />
        </div>
      </div>
    </div>
  );

  return (
    <>
      {/* Mobile top bar */}
      <div dir={dir} className="fixed inset-x-0 top-0 z-40 flex items-center justify-between border-b border-[var(--surface-border)] glass-card px-4 py-2 md:hidden" style={{ borderRadius: 0 }}>
        <Link href={`/${role}/dashboard`} className="flex items-center gap-2">
          <Image src="/logo-192.png" alt="فرقان" width={28} height={28} sizes="28px" className="rounded-full" />
          <span className="text-lg font-bold text-gold">فُرقان</span>
        </Link>
        <button
          type="button"
          onClick={() => setMenuOpen((v) => !v)}
          className="glass rounded-xl p-2 text-muted transition-colors hover:text-foreground focus-ring"
          aria-label="القائمة"
          aria-expanded={menuOpen}
          aria-controls="sidebar-nav"
        >
          {menuOpen ? <X size={20} /> : <Menu size={20} />}
        </button>
      </div>

      {/* Mobile backdrop */}
      {menuOpen && (
        <div
          className="fixed inset-0 z-40 bg-black/50 md:hidden"
          onClick={() => setMenuOpen(false)}
        />
      )}

      {/* Sidebar */}
      <aside
        id="sidebar-nav"
        className={`fixed inset-y-0 z-50 w-64 transition-transform duration-300 ease-in-out ${
          dir === "rtl" ? "right-0" : "left-0"
        } ${
          menuOpen ? "translate-x-0" : dir === "rtl" ? "translate-x-full" : "-translate-x-full"
        } md:translate-x-0`}
      >
        {sidebarContent}
      </aside>
    </>
  );
}
