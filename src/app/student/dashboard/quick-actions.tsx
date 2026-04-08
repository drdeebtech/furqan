"use client";

import Link from "next/link";
import { Search, Calendar, MessageSquare } from "lucide-react";
import { useLang } from "@/lib/i18n/context";

export function QuickActions() {
  const { t } = useLang();

  return (
    <div className="glass-card p-4 sm:p-5">
      <h2 className="mb-3 text-base font-semibold">{t("إجراءات سريعة", "Quick Actions")}</h2>
      <div className="space-y-1">
        <Link href="/student/teachers" className="flex min-h-[40px] items-center gap-3 rounded-xl px-3 py-2.5 text-sm transition-colors hover:bg-white/5">
          <Search size={16} className="shrink-0 text-gold" />
          <span>{t("تصفح المعلمين", "Browse Teachers")}</span>
        </Link>
        <Link href="/student/bookings" className="flex min-h-[40px] items-center gap-3 rounded-xl px-3 py-2.5 text-sm transition-colors hover:bg-white/5">
          <Calendar size={16} className="shrink-0 text-gold" />
          <span>{t("حجوزاتي", "My Bookings")}</span>
        </Link>
        <Link href="/student/messages" className="flex min-h-[40px] items-center gap-3 rounded-xl px-3 py-2.5 text-sm transition-colors hover:bg-white/5">
          <MessageSquare size={16} className="shrink-0 text-gold" />
          <span>{t("الرسائل", "Messages")}</span>
        </Link>
      </div>
    </div>
  );
}
