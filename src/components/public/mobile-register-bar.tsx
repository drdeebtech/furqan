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
    <div className="fixed bottom-0 inset-x-0 z-40 glass px-4 py-3 lg:hidden">
      <div className="flex items-center gap-3">
        <Link
          href="/login"
          className="focus-ring glass glass-pill px-4 py-2.5 text-sm font-medium text-muted transition-all duration-200 hover:text-gold"
        >
          {t("دخول", "Sign In")}
        </Link>
        <Link
          href="/register"
          className="focus-ring glass-gold glass-pill flex flex-1 items-center justify-center gap-2 py-2.5 text-sm font-bold transition-all duration-200"
        >
          <UserPlus size={16} />
          {t("سجّل الآن", "Register Now")}
        </Link>
      </div>
    </div>
  );
}
