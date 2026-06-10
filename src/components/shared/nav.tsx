"use client";

import Link from "next/link";
import Image from "next/image";
import { usePathname } from "next/navigation";
import { startTransition, useEffect, useRef, useState, useMemo } from "react";
import {
  Menu, X, LayoutDashboard, GraduationCap, Calendar, TrendingUp, TrendingDown,
  MessageSquare, Clock, Users, ClipboardCheck, BookOpen, StickyNote, Mic, Award,
  Star, DollarSign, Briefcase, FileText, Mail, Bell, Settings, ScrollText,
  ChevronsUpDown, HelpCircle, ChevronRight, ChevronDown, CalendarDays, LogOut,
  Network, Map, Activity,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { LogoutButton } from "./logout-button";
import { useLang } from "@/lib/i18n/context";

type Role = "student" | "teacher" | "admin";

interface NavLink {
  href: string;
  ar: string;
  en: string;
  icon: LucideIcon;
  group?: { ar: string; en: string };
}

const LINKS: Record<Role, NavLink[]> = {
  student: [
    // GENERAL — primary learning surfaces
    { href: "/student/dashboard", ar: "لوحتي", en: "Dashboard", icon: LayoutDashboard, group: { ar: "عام", en: "GENERAL" } },
    { href: "/student/courses", ar: "دوراتي المسجلة", en: "Courses", icon: GraduationCap },
    { href: "/student/sessions", ar: "جلساتي", en: "Sessions", icon: Calendar },
    { href: "/student/calendar", ar: "التقويم", en: "Calendar", icon: CalendarDays },
    { href: "/student/time-tracker", ar: "تتبع الوقت", en: "Time Tracker", icon: Clock },
    { href: "/student/progress", ar: "تقدمي", en: "Progress", icon: TrendingUp },
    { href: "/student/recitations", ar: "تسميعاتي", en: "Recitations", icon: Mic },
    { href: "/student/group-sessions", ar: "حلقات جماعية", en: "Group Halaqas", icon: Users },
    { href: "/student/timeline", ar: "خط زمني", en: "Timeline", icon: ScrollText },
    { href: "/student/ijazah", ar: "مسارات الإجازة", en: "Ijazah", icon: Award },
    // COLLABORATION — communication
    { href: "/student/messages", ar: "الرسائل", en: "Messages", icon: MessageSquare, group: { ar: "التواصل", en: "COLLABORATION" } },
    { href: "/community", ar: "المجتمع", en: "Community", icon: Users },
    { href: "/student/notifications", ar: "الإشعارات", en: "Notifications", icon: Bell },
    // LEARNING — study tools
    { href: "/student/teachers", ar: "المعلمون", en: "Teachers", icon: Users, group: { ar: "التعلم", en: "LEARNING" } },
    { href: "/student/follow-up", ar: "المتابعة", en: "Follow-up", icon: BookOpen },
    { href: "/student/quizzes", ar: "الاختبارات", en: "Quizzes", icon: ClipboardCheck },
    { href: "/student/resources", ar: "المصادر", en: "Resources", icon: FileText },
    { href: "/student/packages", ar: "باقاتي", en: "Packages", icon: Briefcase },
    // SUPPORT — bottom-anchored utility links (no group label)
    { href: "/student/settings", ar: "الإعدادات", en: "Settings", icon: Settings },
    { href: "/help", ar: "المساعدة", en: "Help Center", icon: HelpCircle },
  ],
  teacher: [
    { href: "/teacher/dashboard", ar: "لوحتي", en: "Dashboard", icon: LayoutDashboard, group: { ar: "الرئيسية", en: "MAIN" } },
    { href: "/teacher/availability", ar: "المواعيد", en: "Availability", icon: Clock },
    { href: "/teacher/sessions", ar: "جلساتي", en: "Sessions", icon: Calendar },
    { href: "/teacher/calendar", ar: "التقويم", en: "Calendar", icon: CalendarDays },
    { href: "/teacher/time-tracker", ar: "ساعاتي", en: "Teaching Hours", icon: Clock },
    { href: "/teacher/students", ar: "طلابي", en: "Students", icon: Users, group: { ar: "الطلاب", en: "STUDENTS" } },
    { href: "/teacher/halaqas", ar: "حلقاتي", en: "My Halaqas", icon: Users },
    { href: "/teacher/recitations", ar: "تسميعات الطلاب", en: "Recitations", icon: Mic },
    { href: "/teacher/progress", ar: "تقدم الطلاب", en: "Progress", icon: TrendingUp },
    { href: "/teacher/talqeen", ar: "صندوق التلقين", en: "Talqeen Inbox", icon: Mic },
    { href: "/teacher/follow-up", ar: "المتابعة", en: "Follow-up", icon: BookOpen },
    { href: "/teacher/courses", ar: "دوراتي المسجلة", en: "Recorded Courses", icon: GraduationCap },
    { href: "/teacher/resources", ar: "مصادري", en: "My Resources", icon: FileText },
    { href: "/teacher/cv", ar: "السيرة الذاتية", en: "My CV", icon: FileText },
    { href: "/teacher/evaluations", ar: "التقييمات", en: "Evaluations", icon: ClipboardCheck },
    { href: "/teacher/notifications", ar: "الإشعارات", en: "Notifications", icon: Bell },
    { href: "/teacher/messages", ar: "الرسائل", en: "Messages", icon: MessageSquare },
  ],
  admin: [
    { href: "/admin/dashboard", ar: "لوحة الإدارة", en: "Dashboard", icon: LayoutDashboard, group: { ar: "الرئيسية", en: "MAIN" } },
    { href: "/admin/control-tower", ar: "مركز التحكم", en: "Control Tower", icon: ClipboardCheck },
    { href: "/admin/retention", ar: "إشارات البقاء", en: "Retention", icon: TrendingDown },
    { href: "/admin/users", ar: "المستخدمون", en: "Users", icon: Users, group: { ar: "المستخدمون", en: "USERS" } },
    { href: "/admin/teachers", ar: "المعلمون", en: "Teachers", icon: GraduationCap },
    { href: "/admin/bookings", ar: "الحجوزات", en: "Bookings", icon: BookOpen, group: { ar: "الجلسات", en: "SESSIONS" } },
    { href: "/admin/sessions", ar: "الجلسات", en: "Sessions", icon: Calendar },
    { href: "/admin/halaqas", ar: "الحلقات", en: "Halaqas", icon: Users },
    { href: "/admin/notes", ar: "ملاحظات الجلسات", en: "Notes", icon: StickyNote },
    { href: "/admin/evaluations", ar: "التقييمات", en: "Evaluations", icon: ClipboardCheck, group: { ar: "الجودة", en: "QUALITY" } },
    { href: "/admin/reviews", ar: "المراجعات", en: "Reviews", icon: Star },
    { href: "/admin/moderation", ar: "المراجعة", en: "Moderation", icon: ClipboardCheck },
    { href: "/admin/follow-up/grade", ar: "تقييم المتابعات", en: "Follow-up Grader", icon: BookOpen },
    { href: "/admin/credits", ar: "منح رصيد", en: "Manual Credits", icon: DollarSign, group: { ar: "المالية", en: "FINANCE" } },
    { href: "/admin/payments", ar: "المالية", en: "Payments", icon: DollarSign },
    { href: "/admin/refund-policies", ar: "سياسات الاسترداد", en: "Refund Policies", icon: FileText },
    { href: "/admin/packages", ar: "الباقات", en: "Packages", icon: BookOpen, group: { ar: "المحتوى", en: "CONTENT" } },
    { href: "/admin/services", ar: "الخدمات", en: "Services", icon: Briefcase },
    { href: "/admin/courses", ar: "الدورات المسجلة", en: "Recorded Courses", icon: GraduationCap },
    { href: "/admin/content", ar: "محتوى الموقع", en: "Site Content", icon: FileText },
    { href: "/admin/legal", ar: "الوثائق القانونية", en: "Legal Docs", icon: FileText },
    { href: "/admin/picklists", ar: "قوائم المعلمين", en: "Teacher Picklists", icon: FileText },
    { href: "/admin/blog", ar: "المدونة", en: "Blog", icon: FileText },
    { href: "/admin/help", ar: "مركز المساعدة", en: "Help Center", icon: HelpCircle },
    { href: "/admin/resources", ar: "المصادر", en: "Resources", icon: FileText },
    { href: "/admin/community", ar: "المجتمع", en: "Community", icon: Users },
    { href: "/admin/announcements", ar: "الإعلانات", en: "Announcements", icon: Bell },
    { href: "/admin/contacts", ar: "رسائل التواصل", en: "Contacts", icon: Mail },
    { href: "/admin/notifications", ar: "الإشعارات", en: "Notifications", icon: Bell },
    { href: "/admin/n8n", ar: "تحكم n8n", en: "n8n Control", icon: Settings, group: { ar: "الإعدادات", en: "SETTINGS" } },
    { href: "/admin/automation", ar: "سجل الأتمتة", en: "Automation Logs", icon: ScrollText },
    { href: "/admin/automation/replay", ar: "إعادة تشغيل", en: "Webhook Replay", icon: ScrollText },
    { href: "/admin/audit", ar: "سجل التدقيق", en: "Audit Log", icon: ScrollText },
    { href: "/admin/architecture", ar: "بنية قاعدة الكود", en: "Codebase Architecture", icon: Network },
    { href: "/admin/health", ar: "صحة الكود", en: "Code Health", icon: Activity },
    { href: "/admin/tour", ar: "جولة في الكود", en: "Codebase Tour", icon: Map },
    { href: "/admin/account", ar: "حسابي", en: "My Account", icon: Settings },
    { href: "/admin/settings", ar: "الإعدادات", en: "Settings", icon: Settings },
  ],
};

const ROLE_LABEL: Record<Role, { ar: string; en: string }> = {
  admin: { ar: "الإدارة", en: "Admin" },
  teacher: { ar: "المعلم", en: "Teacher" },
  student: { ar: "طالب القرآن", en: "Quran Student" },
};

const COLLAPSE_STORAGE_KEY = "furqan-nav-collapsed-groups";

// Settings path varies by role; admin's account page lives at /admin/account.
const SETTINGS_PATH: Record<Role, string> = {
  admin: "/admin/account",
  teacher: "/teacher/settings",
  student: "/student/settings",
};

export function Nav({ role, userName }: { role: Role; userName?: string }) {
  const pathname = usePathname();
  const { lang, dir } = useLang();
  const [menuOpen, setMenuOpen] = useState(false);
  const [lastPath, setLastPath] = useState(pathname);
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(new Set());
  const [accountOpen, setAccountOpen] = useState(false);
  const accountRef = useRef<HTMLDivElement>(null);
  // Close the mobile menu on route change. This is React's recommended
  // pattern for adjusting state when a prop changes
  // (see react.dev/learn/you-might-not-need-an-effect).
  if (pathname !== lastPath) {
    setLastPath(pathname);
    setMenuOpen(false);
  }

  // Outside-click + Escape close the account dropdown.
  useEffect(() => {
    if (!accountOpen) return;
    const handleClick = (e: MouseEvent) => {
      if (accountRef.current && !accountRef.current.contains(e.target as Node)) {
        setAccountOpen(false);
      }
    };
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setAccountOpen(false);
    };
    document.addEventListener("mousedown", handleClick);
    document.addEventListener("keydown", handleKey);
    return () => {
      document.removeEventListener("mousedown", handleClick);
      document.removeEventListener("keydown", handleKey);
    };
  }, [accountOpen]);

  // Persist collapsed group state per-role across reloads.
  useEffect(() => {
    try {
      const raw = localStorage.getItem(`${COLLAPSE_STORAGE_KEY}:${role}`);
      if (raw) startTransition(() => setCollapsedGroups(new Set(JSON.parse(raw))));
    } catch { /* localStorage unavailable */ }
  }, [role]);

  const toggleGroup = (key: string) => {
    setCollapsedGroups((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      try {
        localStorage.setItem(`${COLLAPSE_STORAGE_KEY}:${role}`, JSON.stringify([...next]));
      } catch { /* ignore */ }
      return next;
    });
  };

  const navLang = lang;
  const t = (ar: string, en: string) => (lang === "ar" ? ar : en);
  const links = LINKS[role];

  // ⚡ Bolt: Group links by their group field
  // What: Wrap the link grouping loop in a useMemo hook.
  // Why: The Nav component previously recalculated the groups array on every render, including mobile menu toggles and route changes.
  // Impact: O(N) array allocation avoided. Reduces work done during frequent state changes.
  const groups = useMemo(() => {
    const result: { label: { ar: string; en: string } | null; links: NavLink[] }[] = [];
    let currentGroup: (typeof result)[number] | null = null;
    for (const link of links) {
      if (link.group) {
        currentGroup = { label: link.group, links: [link] };
        result.push(currentGroup);
      } else if (currentGroup) {
        currentGroup.links.push(link);
      } else {
        currentGroup = { label: null, links: [link] };
        result.push(currentGroup);
      }
    }
    return result;
  }, [links]);

  const sidebarContent = (
    <div dir={dir} className="flex h-full flex-col glass-sidebar">
      {/* Top: Logo + User + account dropdown */}
      <div ref={accountRef} className="relative border-b border-[var(--surface-border)] px-5 py-5">
        <button
          type="button"
          onClick={() => setAccountOpen((v) => !v)}
          aria-label={t("قائمة الحساب", "Account menu")}
          aria-expanded={accountOpen}
          aria-haspopup="menu"
          className="flex w-full items-center gap-3 rounded-lg transition-colors hover:bg-[var(--surface-hover,rgba(0,0,0,0.03))]"
        >
          <Image src="/logo-192.png" alt="فرقان" width={36} height={36} sizes="36px" className="rounded-full" />
          <div className="min-w-0 flex-1 text-start">
            {userName && <p className="truncate text-sm font-medium">{userName}</p>}
            <p className="text-xs text-muted-light">{navLang === "ar" ? ROLE_LABEL[role].ar : ROLE_LABEL[role].en}</p>
          </div>
          <ChevronsUpDown size={14} className="shrink-0 text-muted" aria-hidden="true" />
        </button>
        {accountOpen && (
          <div
            role="menu"
            aria-label={t("قائمة الحساب", "Account menu")}
            className="absolute end-3 start-3 top-full z-50 mt-1 overflow-hidden rounded-xl border border-[var(--surface-border)] bg-[var(--surface)] shadow-lg"
          >
            <Link
              href={`/${role}/dashboard`}
              role="menuitem"
              onClick={() => setAccountOpen(false)}
              className="flex items-center gap-2.5 px-4 py-2.5 text-sm text-foreground transition-colors hover:bg-foreground/5"
            >
              <LayoutDashboard size={14} className="text-muted" aria-hidden="true" />
              {t("لوحتي", "My Dashboard")}
            </Link>
            <Link
              href={SETTINGS_PATH[role]}
              role="menuitem"
              onClick={() => setAccountOpen(false)}
              className="flex items-center gap-2.5 px-4 py-2.5 text-sm text-foreground transition-colors hover:bg-foreground/5"
            >
              <Settings size={14} className="text-muted" aria-hidden="true" />
              {t("الإعدادات", "Settings")}
            </Link>
            <form action="/api/auth/logout" method="POST">
              <button
                type="submit"
                role="menuitem"
                className="flex w-full items-center gap-2.5 border-t border-[var(--surface-divider,#F0F0F2)] px-4 py-2.5 text-sm text-error transition-colors hover:bg-error/10"
              >
                <LogOut size={14} aria-hidden="true" />
                {t("تسجيل الخروج", "Log out")}
              </button>
            </form>
          </div>
        )}
      </div>

      {/* Middle: Nav links */}
      <nav className="flex-1 overflow-y-auto px-3 py-4" aria-label={t("التنقل الرئيسي", "Main navigation")}>
        {groups.map((group, gi) => {
          const groupKey = group.label ? group.label.en : `__ungrouped_${gi}`;
          const isCollapsed = collapsedGroups.has(groupKey);
          return (
            <div key={gi} className={gi > 0 ? "mt-5" : ""}>
              {group.label && (
                <div className="mb-2 flex items-center justify-between px-3">
                  <p className="text-[11px] font-medium uppercase tracking-[0.08em] text-muted-light">
                    {navLang === "ar" ? group.label.ar : group.label.en}
                  </p>
                  <button
                    type="button"
                    onClick={() => toggleGroup(groupKey)}
                    aria-label={isCollapsed
                      ? t("توسيع القسم", "Expand section")
                      : t("طي القسم", "Collapse section")}
                    aria-expanded={!isCollapsed}
                    className="rounded p-1 text-muted-light transition-colors hover:text-foreground focus-ring"
                  >
                    {isCollapsed
                      ? <ChevronRight size={14} aria-hidden="true" />
                      : <ChevronDown size={14} aria-hidden="true" />}
                  </button>
                </div>
              )}
              {!isCollapsed && (
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
                            ? "glass-nav-item active font-medium text-foreground shadow-[0_2px_8px_rgba(0,0,0,0.08)]"
                            : "text-muted hover:text-foreground"
                        }`}
                        data-active={active ? "true" : undefined}
                      >
                        <Icon size={18} className={active ? "text-foreground" : ""} aria-hidden="true" />
                        <span>{navLang === "ar" ? link.ar : link.en}</span>
                      </Link>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}
      </nav>

      {/* Bottom: Utility controls */}
      <div className="border-t border-[var(--surface-border)] px-3 py-4 space-y-1">
        <a
          href="https://wa.me/96597795626"
          target="_blank"
          rel="noopener noreferrer"
          className="flex min-h-[40px] items-center gap-3 rounded-xl px-3 py-2.5 text-sm text-muted transition-colors hover:text-foreground"
        >
          <svg viewBox="0 0 24 24" fill="currentColor" className="h-[18px] w-[18px] text-green-400"><path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z"/></svg>
          <span>{t("الدعم", "Support")}</span>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-3 w-3 opacity-40"><path d="M18 13v6a2 2 0 01-2 2H5a2 2 0 01-2-2V8a2 2 0 012-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>
        </a>
        <div className="flex items-center gap-2 px-3 py-2">
          <LogoutButton />
        </div>
      </div>
    </div>
  );

  return (
    <>
      {/* Mobile top bar — z-50 so it stays above the z-40 backdrop when menu is open */}
      <div dir={dir} className="fixed inset-x-0 top-0 z-50 flex items-center justify-between border-b border-[var(--surface-border)] glass-card px-4 py-2 md:hidden" style={{ borderRadius: 0 }}>
        <Link href={`/${role}/dashboard`} className="flex items-center gap-2">
          <Image src="/logo-192.png" alt="فرقان" width={28} height={28} sizes="28px" className="rounded-full" />
          <span className="text-lg font-bold text-gold">فُرقان</span>
        </Link>
        <button
          type="button"
          onClick={() => setMenuOpen((v) => !v)}
          className="glass rounded-xl p-2 text-muted transition-colors hover:text-foreground focus-ring"
          aria-label={t("القائمة", "Menu")}
          aria-expanded={menuOpen}
          aria-controls="sidebar-nav"
        >
          {menuOpen ? <X size={20} /> : <Menu size={20} />}
        </button>
      </div>

      {/* Mobile backdrop — button ensures iOS Safari fires tap events */}
      {menuOpen && (
        <button
          type="button"
          aria-label={t("إغلاق القائمة", "Close menu")}
          className="fixed inset-0 z-40 w-full cursor-default bg-black/50 md:hidden"
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
