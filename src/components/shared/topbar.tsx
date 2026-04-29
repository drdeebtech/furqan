"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { CalendarDays, ChevronDown, MoreHorizontal, Settings, LogOut, Bug } from "lucide-react";
import * as Sentry from "@sentry/nextjs";
import { ThemeToggle } from "@/lib/theme/theme-toggle";
import { LangToggle } from "@/lib/i18n/lang-toggle";
import { NotificationBell } from "@/components/shared/notification-bell";
import { useLang } from "@/lib/i18n/context";

type Role = "student" | "teacher" | "admin" | "moderator";

// Roles that have a personal account / settings page. Admin's link points
// at /admin/account (personal info), distinct from /admin/settings (platform
// feature flags). All other roles use the canonical /[role]/settings path.
const SETTINGS_PATH_BY_ROLE: Partial<Record<Role, string>> = {
  teacher: "/teacher/settings",
  student: "/student/settings",
  moderator: "/moderator/settings",
  admin: "/admin/account",
};

export function Topbar({ role }: { role?: Role } = {}) {
  const { t } = useLang();
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [menuOpen, setMenuOpen] = useState(false);
  const [yearOpen, setYearOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const yearRef = useRef<HTMLDivElement>(null);

  const currentYear = new Date().getFullYear();
  const selectedYear = Number(searchParams.get("year")) || currentYear;
  const yearOptions = [currentYear + 1, currentYear, currentYear - 1, currentYear - 2, currentYear - 3];

  const handleYearSelect = (year: number) => {
    const params = new URLSearchParams(searchParams.toString());
    if (year === currentYear) {
      params.delete("year");
    } else {
      params.set("year", String(year));
    }
    const qs = params.toString();
    router.push(qs ? `${pathname}?${qs}` : pathname);
    setYearOpen(false);
  };

  // Close on outside click
  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpen(false);
      }
    }
    if (menuOpen) document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [menuOpen]);

  // Close on Escape
  useEffect(() => {
    function handleKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        setMenuOpen(false);
        setYearOpen(false);
      }
    }
    if (menuOpen || yearOpen) document.addEventListener("keydown", handleKey);
    return () => document.removeEventListener("keydown", handleKey);
  }, [menuOpen, yearOpen]);

  // Close year dropdown on outside click
  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (yearRef.current && !yearRef.current.contains(e.target as Node)) {
        setYearOpen(false);
      }
    }
    if (yearOpen) document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [yearOpen]);

  const settingsPath = role ? SETTINGS_PATH_BY_ROLE[role] : undefined;

  return (
    <div className="mb-5 flex h-[52px] items-center justify-end gap-3">
      {/* Year selector — writes ?year=YYYY to the URL so dashboard queries can scope */}
      <div ref={yearRef} className="relative">
        <button
          type="button"
          aria-label={t("السنة", "Year")}
          aria-expanded={yearOpen}
          aria-haspopup="listbox"
          onClick={() => setYearOpen((v) => !v)}
          className="glass flex h-11 items-center gap-2 rounded-xl px-3.5"
        >
          <CalendarDays size={16} className="text-muted" aria-hidden="true" />
          <span className="text-sm font-medium">{selectedYear}</span>
          <ChevronDown size={14} className="text-muted" aria-hidden="true" />
        </button>
        {yearOpen && (
          <div
            role="listbox"
            aria-label={t("اختر السنة", "Select year")}
            className="absolute end-0 top-full z-50 mt-2 w-32 overflow-hidden rounded-xl border border-[var(--surface-border)] bg-[var(--surface)] shadow-lg"
          >
            {yearOptions.map((y) => (
              <button
                key={y}
                type="button"
                role="option"
                aria-selected={y === selectedYear}
                onClick={() => handleYearSelect(y)}
                className={`flex w-full items-center justify-between px-4 py-2.5 text-sm transition-colors hover:bg-foreground/5 ${
                  y === selectedYear ? "font-semibold text-gold" : "text-foreground"
                }`}
              >
                <span>{y}</span>
                {y === currentYear && (
                  <span className="text-[10px] font-medium uppercase tracking-wider text-muted-light">
                    {t("الآن", "now")}
                  </span>
                )}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Notification bell */}
      <NotificationBell />

      {/* Theme toggle */}
      <div className="glass flex h-11 w-11 items-center justify-center rounded-xl">
        <ThemeToggle />
      </div>

      {/* Lang toggle */}
      <div className="glass flex h-11 items-center justify-center rounded-xl px-2">
        <LangToggle />
      </div>

      {/* Menu dots */}
      <div ref={menuRef} className="relative">
        <button
          type="button"
          aria-label={t("القائمة", "Menu")}
          aria-expanded={menuOpen}
          aria-haspopup="menu"
          onClick={() => setMenuOpen((v) => !v)}
          className="glass flex h-11 w-11 items-center justify-center rounded-xl transition-colors hover:bg-foreground/5"
        >
          <MoreHorizontal size={18} className="text-muted" aria-hidden="true" />
        </button>

        {menuOpen && (
          <div
            role="menu"
            aria-label={t("قائمة الحساب", "Account menu")}
            className="absolute end-0 top-full z-50 mt-2 w-56 overflow-hidden rounded-xl border border-[var(--surface-border)] bg-[var(--surface)] shadow-lg"
          >
            {settingsPath && (
              <Link
                href={settingsPath}
                role="menuitem"
                onClick={() => setMenuOpen(false)}
                className="flex min-h-[44px] items-center gap-3 px-4 py-2.5 text-sm transition-colors hover:bg-foreground/5"
              >
                <Settings size={14} className="text-gold" aria-hidden="true" />
                {t("الإعدادات", "Settings")}
              </Link>
            )}
            <button
              type="button"
              role="menuitem"
              onClick={async () => {
                setMenuOpen(false);
                const feedback = Sentry.getFeedback();
                if (!feedback) return;
                const form = await feedback.createForm();
                form.appendToDom();
                form.open();
              }}
              className="flex min-h-[44px] w-full items-center gap-3 px-4 py-2.5 text-sm transition-colors hover:bg-foreground/5"
            >
              <Bug size={14} className="text-gold" aria-hidden="true" />
              {t("أبلغ عن مشكلة", "Report a problem")}
            </button>
            <form action="/api/auth/logout" method="POST">
              <button
                type="submit"
                role="menuitem"
                className="flex min-h-[44px] w-full items-center gap-3 px-4 py-2.5 text-sm text-error transition-colors hover:bg-error/10"
              >
                <LogOut size={14} aria-hidden="true" />
                {t("تسجيل الخروج", "Log out")}
              </button>
            </form>
          </div>
        )}
      </div>
    </div>
  );
}
