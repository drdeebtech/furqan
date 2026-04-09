"use client";

import { useState } from "react";
import { Search, CalendarDays, ChevronDown, MoreHorizontal } from "lucide-react";
import { ThemeToggle } from "@/lib/theme/theme-toggle";
import { LangToggle } from "@/lib/i18n/lang-toggle";
import { useLang } from "@/lib/i18n/context";

export function Topbar() {
  const { t } = useLang();
  const [showTooltip, setShowTooltip] = useState(false);

  const handleSearchClick = () => {
    setShowTooltip(true);
    setTimeout(() => setShowTooltip(false), 2000);
  };

  return (
    <div className="mb-5 flex h-[52px] items-center gap-3">
      {/* Search input */}
      <div className="relative flex-1">
        <Search
          size={18}
          className="pointer-events-none absolute start-3.5 top-1/2 -translate-y-1/2 text-[var(--muted-light,var(--muted))]"
        />
        <input
          type="text"
          readOnly
          onClick={handleSearchClick}
          placeholder={t("عن ماذا تعمل...", "What are you working on...")}
          className="glass-input h-11 w-full cursor-pointer rounded-xl pe-10 ps-11 text-sm placeholder:text-[var(--muted-light,var(--muted))] focus:outline-none"
        />
        <span className="pointer-events-none absolute end-3 top-1/2 -translate-y-1/2 rounded border border-[var(--surface-border)] px-1.5 py-0.5 text-[11px] text-[var(--muted-light,var(--muted))]">
          /
        </span>
        {showTooltip && (
          <div className="absolute start-1/2 top-full z-50 mt-2 -translate-x-1/2 rounded-lg bg-[#1A1A1F] px-3 py-1.5 text-xs text-white shadow-lg">
            {t("قريباً", "Coming soon")}
          </div>
        )}
      </div>

      {/* Year selector */}
      <div className="glass flex h-11 items-center gap-2 rounded-xl px-3.5">
        <CalendarDays size={16} className="text-[var(--muted)]" />
        <span className="text-sm font-medium">{new Date().getFullYear()}</span>
        <ChevronDown size={14} className="text-[var(--muted)]" />
      </div>

      {/* Theme toggle */}
      <div className="glass flex h-11 w-11 items-center justify-center rounded-xl">
        <ThemeToggle />
      </div>

      {/* Lang toggle */}
      <div className="glass flex h-11 items-center justify-center rounded-xl px-2">
        <LangToggle />
      </div>

      {/* Menu dots */}
      <div className="glass flex h-11 w-11 items-center justify-center rounded-xl">
        <MoreHorizontal size={18} className="text-[var(--muted)]" />
      </div>
    </div>
  );
}
