"use client";

import Link from "next/link";
import { Search, Calendar, MessageSquare } from "lucide-react";
import { useLang } from "@/lib/i18n/context";

export function QuickActions() {
  const { t } = useLang();

  return (
    <div className="mt-6 grid grid-cols-1 gap-3 sm:grid-cols-3">
      <Link href="/student/teachers" className="flex min-h-[44px] items-center gap-3 glass-card p-4 transition-colors hover:border-gold/40">
        <Search size={18} className="shrink-0 text-gold" />
        <span className="text-sm font-medium">{t("تصفح المعلمين", "Browse Teachers")}</span>
      </Link>
      <Link href="/student/bookings" className="flex min-h-[44px] items-center gap-3 glass-card p-4 transition-colors hover:border-gold/40">
        <Calendar size={18} className="shrink-0 text-gold" />
        <span className="text-sm font-medium">{t("حجوزاتي", "My Bookings")}</span>
      </Link>
      <Link href="/student/messages" className="flex min-h-[44px] items-center gap-3 glass-card p-4 transition-colors hover:border-gold/40">
        <MessageSquare size={18} className="shrink-0 text-gold" />
        <span className="text-sm font-medium">{t("الرسائل", "Messages")}</span>
      </Link>
    </div>
  );
}
