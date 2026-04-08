"use client";

import Link from "next/link";
import { Calendar, Users, MessageSquare } from "lucide-react";
import { useLang } from "@/lib/i18n/context";
import { InstantSessionButton } from "./instant-session";

interface Student { id: string; name: string }

export function TeacherQuickActions({ students }: { students: Student[] }) {
  const { t } = useLang();

  return (
    <div className="glass-card p-4 sm:p-5">
      <h2 className="mb-3 text-base font-semibold">{t("إجراءات سريعة", "Quick Actions")}</h2>
      <div className="space-y-1">
        <div className="flex items-center rounded-xl px-3 py-2.5">
          <InstantSessionButton students={students} />
        </div>
        <Link href="/teacher/availability" className="flex min-h-[40px] items-center gap-3 rounded-xl px-3 py-2.5 text-sm transition-colors hover:bg-white/5">
          <Calendar size={16} className="shrink-0 text-gold" />
          <span>{t("إدارة المواعيد", "Manage Schedule")}</span>
        </Link>
        <Link href="/teacher/students" className="flex min-h-[40px] items-center gap-3 rounded-xl px-3 py-2.5 text-sm transition-colors hover:bg-white/5">
          <Users size={16} className="shrink-0 text-gold" />
          <span>{t("طلابي", "My Students")}</span>
        </Link>
        <Link href="/teacher/messages" className="flex min-h-[40px] items-center gap-3 rounded-xl px-3 py-2.5 text-sm transition-colors hover:bg-white/5">
          <MessageSquare size={16} className="shrink-0 text-gold" />
          <span>{t("الرسائل", "Messages")}</span>
        </Link>
      </div>
    </div>
  );
}
