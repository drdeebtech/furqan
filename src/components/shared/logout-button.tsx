"use client";

import { LogOut } from "lucide-react";

export function LogoutButton() {
  return (
    <form action="/api/auth/logout" method="POST">
      <button
        type="submit"
        aria-label="تسجيل الخروج"
        className="flex items-center gap-1.5 glass glass-pill px-3 py-1.5 text-sm text-muted transition-colors hover:border-error/50 hover:text-error focus-ring"
      >
        <LogOut size={14} />
        <span className="hidden sm:inline">خروج</span>
      </button>
    </form>
  );
}
