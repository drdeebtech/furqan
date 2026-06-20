"use client";

import { Sun, Moon } from "lucide-react";
import { useTheme } from "./context";
import { useLang } from "@/lib/i18n/context";

export function ThemeToggle() {
  const { theme, toggle } = useTheme();
  const { t } = useLang();

  return (
    <button
      onClick={toggle}
      className="glass glass-pill flex h-11 w-11 items-center justify-center !rounded-full !p-0 text-muted transition-colors hover:text-foreground focus-ring"
      aria-label={theme === "dark" ? t("التبديل إلى الوضع الفاتح", "Switch to light mode") : t("التبديل إلى الوضع الداكن", "Switch to dark mode")}
    >
      {theme === "dark" ? <Sun size={16} /> : <Moon size={16} />}
    </button>
  );
}
