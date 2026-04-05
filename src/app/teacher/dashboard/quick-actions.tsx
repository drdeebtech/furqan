"use client";

import Link from "next/link";
import { Calendar, Users, MessageSquare } from "lucide-react";
import { useLang } from "@/lib/i18n/context";
import { InstantSessionButton } from "./instant-session";

interface Student { id: string; name: string }

export function TeacherQuickActions({ students }: { students: Student[] }) {
  const { t } = useLang();

  return (
    <div className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
      <div className="flex items-center">
        <InstantSessionButton students={students} />
      </div>
      <Link href="/teacher/availability" className="flex items-center gap-3 rounded-xl border border-card-border bg-card p-4 transition-colors hover:border-gold/40">
        <Calendar size={18} className="shrink-0 text-gold" />
        <span className="text-sm font-medium">{t("إدارة المواعيد", "Manage Schedule")}</span>
      </Link>
      <Link href="/teacher/students" className="flex items-center gap-3 rounded-xl border border-card-border bg-card p-4 transition-colors hover:border-gold/40">
        <Users size={18} className="shrink-0 text-gold" />
        <span className="text-sm font-medium">{t("طلابي", "My Students")}</span>
      </Link>
      <Link href="/teacher/messages" className="flex items-center gap-3 rounded-xl border border-card-border bg-card p-4 transition-colors hover:border-gold/40">
        <MessageSquare size={18} className="shrink-0 text-gold" />
        <span className="text-sm font-medium">{t("الرسائل", "Messages")}</span>
      </Link>
    </div>
  );
}
