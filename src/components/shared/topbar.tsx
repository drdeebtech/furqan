"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Search, CalendarDays, ChevronDown, MoreHorizontal, Settings, LogOut } from "lucide-react";
import { ThemeToggle } from "@/lib/theme/theme-toggle";
import { LangToggle } from "@/lib/i18n/lang-toggle";
import { NotificationBell } from "@/components/shared/notification-bell";
import { useLang } from "@/lib/i18n/context";

type Role = "student" | "teacher" | "admin" | "moderator";

// Roles that have a built /[role]/settings route. Others hide the link
// rather than 404 the user.
const ROLES_WITH_SETTINGS: Role[] = ["teacher", "admin"];

export function Topbar({ role }: { role?: Role } = {}) {
  const { t } = useLang();
  const [showTooltip, setShowTooltip] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  const handleSearchClick = () => {
    setShowTooltip(true);
    setTimeout(() => setShowTooltip(false), 2000);
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
      if (e.key === "Escape") setMenuOpen(false);
    }
    if (menuOpen) document.addEventListener("keydown", handleKey);
    return () => document.removeEventListener("keydown", handleKey);
  }, [menuOpen]);

  const showSettings = role && ROLES_WITH_SETTINGS.includes(role);

  return (
    <div className="mb-5 flex h-[52px] items-center gap-3">
      {/* Search input */}
      <div className="relative flex-1">
        <Search
          size={18}
          aria-hidden="true"
          className="pointer-events-none absolute start-3.5 top-1/2 -translate-y-1/2 text-muted-light"
        />
        <input
          type="text"
          readOnly
          onClick={handleSearchClick}
          aria-label={t("بحث", "Search")}
          placeholder={t("عن ماذا تعمل...", "What are you working on...")}
          className="glass-input h-11 w-full cursor-pointer rounded-xl pe-10 ps-11 text-sm placeholder:text-muted-light focus:outline-none"
        />
        <span className="pointer-events-none absolute end-3 top-1/2 -translate-y-1/2 rounded border border-[var(--surface-border)] px-1.5 py-0.5 text-[11px] text-muted-light">
          /
        </span>
        {showTooltip && (
          <div className="absolute start-1/2 top-full z-50 mt-2 -translate-x-1/2 rounded-lg bg-[#1A1A1F] px-3 py-1.5 text-xs text-white shadow-lg">
            {t("قريباً", "Coming soon")}
          </div>
        )}
      </div>

      {/* Year selector */}
      <div className="glass flex h-11 items-center rounded-xl px-3.5">
        <button type="button" aria-label={t("السنة", "Year")} className="flex items-center gap-2">
          <CalendarDays size={16} className="text-muted" aria-hidden="true" />
          <span className="text-sm font-medium">{new Date().getFullYear()}</span>
          <ChevronDown size={14} className="text-muted" aria-hidden="true" />
        </button>
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
            {showSettings && (
              <Link
                href={`/${role}/settings`}
                role="menuitem"
                onClick={() => setMenuOpen(false)}
                className="flex min-h-[44px] items-center gap-3 px-4 py-2.5 text-sm transition-colors hover:bg-foreground/5"
              >
                <Settings size={14} className="text-gold" aria-hidden="true" />
                {t("الإعدادات", "Settings")}
              </Link>
            )}
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
