"use client";

import { useLang } from "./context";
import { Languages } from "lucide-react";

export function LangToggle() {
  const { lang, toggle } = useLang();

  return (
    <button
      onClick={toggle}
      className="flex min-h-[44px] items-center gap-1.5 rounded-full border border-card-border px-3 py-1.5 text-xs font-medium text-muted transition-colors hover:border-gold/40 hover:text-gold focus-ring"
      aria-label={lang === "ar" ? "Switch to English" : "التبديل إلى العربية"}
    >
      <Languages size={14} />
      {lang === "ar" ? "EN" : "عربي"}
    </button>
  );
}
