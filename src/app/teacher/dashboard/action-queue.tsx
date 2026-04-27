"use client";

import Link from "next/link";
import { BookOpen, ClipboardCheck, MessageSquare, Calendar, AlertTriangle } from "lucide-react";
import { useLang } from "@/lib/i18n/context";

interface ActionQueueData {
  pendingGrading: number;
  overdueEvals: number;
  unreadMessages: number;
  todaySessionCount: number;
  lowAvailability: boolean;
}

export function TeacherActionQueue({ data }: { data: ActionQueueData }) {
  const { t } = useLang();
  const { pendingGrading, overdueEvals, unreadMessages, todaySessionCount, lowAvailability } = data;

  const items = [
    pendingGrading > 0 && {
      icon: BookOpen,
      label: t(`${pendingGrading} واجبات بانتظار التقييم`, `${pendingGrading} homework awaiting grading`),
      href: "/teacher/homework",
      color: "text-amber-400",
      bg: "bg-amber-500/10",
    },
    overdueEvals > 0 && {
      icon: ClipboardCheck,
      label: t(`${overdueEvals} طلاب بحاجة لتقييم`, `${overdueEvals} students need evaluation`),
      href: "/teacher/evaluations",
      color: "text-orange-400",
      bg: "bg-orange-500/10",
    },
    todaySessionCount > 0 && {
      icon: Calendar,
      label: t(`${todaySessionCount} جلسات اليوم`, `${todaySessionCount} sessions today`),
      href: "/teacher/sessions",
      color: "text-blue-400",
      bg: "bg-blue-500/10",
    },
    unreadMessages > 0 && {
      icon: MessageSquare,
      label: t(`${unreadMessages} رسائل غير مقروءة`, `${unreadMessages} unread messages`),
      href: "/teacher/messages",
      color: "text-purple-400",
      bg: "bg-purple-500/10",
    },
    lowAvailability && {
      icon: AlertTriangle,
      label: t("مواعيدك قليلة — أضف المزيد", "Low availability — add more slots"),
      href: "/teacher/availability",
      color: "text-red-400",
      bg: "bg-red-500/10",
    },
  ].filter(Boolean) as { icon: typeof BookOpen; label: string; href: string; color: string; bg: string }[];

  if (items.length === 0) return null;

  return (
    <div className="glass-card p-5">
      <h3 className="mb-3 text-sm font-semibold text-gold">{t("مهامك الآن", "Your Actions Now")}</h3>
      <ul className="space-y-2">
        {items.map((item, i) => {
          const Icon = item.icon;
          return (
            <li key={i}>
              <Link href={item.href} className={`flex min-h-[44px] items-center gap-3 rounded-xl ${item.bg} p-3 transition-colors hover:opacity-80`}>
                <Icon size={16} className={item.color} aria-hidden="true" />
                <span className="text-sm">{item.label}</span>
              </Link>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
