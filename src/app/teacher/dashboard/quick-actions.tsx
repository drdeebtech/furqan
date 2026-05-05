"use client";

import Link from "next/link";
import { Calendar, Users, MessageSquare, ClipboardCheck, BookOpen } from "lucide-react";
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
        <Link href="/teacher/availability" className="flex min-h-[44px] items-center gap-3 rounded-xl px-3 py-2.5 text-sm transition-colors hover:bg-foreground/5">
          <Calendar size={16} className="shrink-0 text-gold" aria-hidden="true" />
          <span>{t("إدارة المواعيد", "Manage Schedule")}</span>
        </Link>
        <Link href="/teacher/students" className="flex min-h-[44px] items-center gap-3 rounded-xl px-3 py-2.5 text-sm transition-colors hover:bg-foreground/5">
          <Users size={16} className="shrink-0 text-gold" aria-hidden="true" />
          <span>{t("طلابي", "My Students")}</span>
        </Link>
        {/* Pedagogical actions — write eval + grade follow-ups. Promoted as
            quick actions because they're the two recurring actions a Quran
            teacher does between sessions, and the dashboard now surfaces
            both as numeric signals (overdueEvals, talqeen inbox count). */}
        <Link href="/teacher/evaluations" className="flex min-h-[44px] items-center gap-3 rounded-xl px-3 py-2.5 text-sm transition-colors hover:bg-foreground/5">
          <ClipboardCheck size={16} className="shrink-0 text-gold" aria-hidden="true" />
          <span>{t("كتابة تقييم", "Write Evaluation")}</span>
        </Link>
        <Link href="/teacher/follow-up" className="flex min-h-[44px] items-center gap-3 rounded-xl px-3 py-2.5 text-sm transition-colors hover:bg-foreground/5">
          <BookOpen size={16} className="shrink-0 text-gold" aria-hidden="true" />
          <span>{t("المتابعة والتصحيح", "Follow-ups & Grading")}</span>
        </Link>
        <Link href="/teacher/messages" className="flex min-h-[44px] items-center gap-3 rounded-xl px-3 py-2.5 text-sm transition-colors hover:bg-foreground/5">
          <MessageSquare size={16} className="shrink-0 text-gold" aria-hidden="true" />
          <span>{t("الرسائل", "Messages")}</span>
        </Link>
      </div>
    </div>
  );
}
