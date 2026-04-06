"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { UserPlus } from "lucide-react";
import { useLang } from "@/lib/i18n/context";

export function MobileRegisterBar() {
  const { t } = useLang();
  const pathname = usePathname();

  // Hide on auth pages — not needed there
  if (pathname === "/login" || pathname === "/register" || pathname === "/forgot-password") {
    return null;
  }

  return (
    <div className="fixed bottom-0 left-0 right-0 z-40 border-t border-gold/30 bg-background/95 px-4 py-3 backdrop-blur-sm lg:hidden">
      <div className="flex items-center gap-3">
        <Link
          href="/login"
          className="focus-ring rounded-lg border border-card-border px-4 py-2.5 text-sm font-medium text-muted transition-colors hover:text-gold"
        >
          {t("دخول", "Sign In")}
        </Link>
        <Link
          href="/register"
          className="focus-ring flex flex-1 items-center justify-center gap-2 rounded-lg bg-gold py-2.5 text-sm font-bold text-background transition-colors hover:bg-gold-hover"
        >
          <UserPlus size={16} />
          {t("سجّل الآن", "Register Now")}
        </Link>
      </div>
    </div>
  );
}
