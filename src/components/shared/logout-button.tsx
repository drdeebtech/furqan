"use client";

import { LogOut } from "lucide-react";
import { useLang } from "@/lib/i18n/context";

export function LogoutButton() {
  const { t } = useLang();
  return (
    <form action="/api/auth/logout" method="POST">
      <button
        type="submit"
        aria-label={t("تسجيل الخروج", "Log out")}
        className="flex items-center gap-1.5 glass glass-pill px-3 py-1.5 text-sm text-muted transition-colors hover:border-error/50 hover:text-error focus-ring"
      >
        <LogOut size={14} />
        <span className="hidden sm:inline">{t("خروج", "Log out")}</span>
      </button>
    </form>
  );
}
