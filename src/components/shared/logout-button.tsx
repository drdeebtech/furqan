"use client";

import { LogOut } from "lucide-react";

export function LogoutButton() {
  return (
    <form action="/api/auth/logout" method="POST">
      <button
        type="submit"
        className="flex items-center gap-1.5 rounded-lg border border-card-border bg-card px-3 py-1.5 text-sm text-muted transition-colors hover:border-error/50 hover:text-error"
      >
        <LogOut size={14} />
        خروج
      </button>
    </form>
  );
}
