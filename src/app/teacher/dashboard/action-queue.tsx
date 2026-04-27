"use client";

import Link from "next/link";
import { BookOpen, ClipboardCheck, MessageSquare, Calendar, AlertTriangle } from "lucide-react";
import { useLang } from "@/lib/i18n/context";
import { PriorityChip, type PrioritySeverity } from "@/components/shared/priority-chip";

interface ActionQueueData {
  pendingGrading: number;
  overdueEvals: number;
  unreadMessages: number;
  todaySessionCount: number;
  lowAvailability: boolean;
}

type Item = { icon: typeof BookOpen; label: string; href: string; severity: PrioritySeverity };

export function TeacherActionQueue({ data }: { data: ActionQueueData }) {
  const { t } = useLang();
  const { pendingGrading, overdueEvals, unreadMessages, todaySessionCount, lowAvailability } = data;

  const items: Item[] = [
    pendingGrading > 0 && {
      icon: BookOpen,
      label: t(`${pendingGrading} واجبات بانتظار التقييم`, `${pendingGrading} homework awaiting grading`),
      href: "/teacher/homework",
      severity: "warning" as const,
    },
    overdueEvals > 0 && {
      icon: ClipboardCheck,
      label: t(`${overdueEvals} طلاب بحاجة لتقييم`, `${overdueEvals} students need evaluation`),
      href: "/teacher/evaluations",
      severity: "warning" as const,
    },
    todaySessionCount > 0 && {
      icon: Calendar,
      label: t(`${todaySessionCount} جلسات اليوم`, `${todaySessionCount} sessions today`),
      href: "/teacher/sessions",
      severity: "info" as const,
    },
    unreadMessages > 0 && {
      icon: MessageSquare,
      label: t(`${unreadMessages} رسائل غير مقروءة`, `${unreadMessages} unread messages`),
      href: "/teacher/messages",
      severity: "info" as const,
    },
    lowAvailability && {
      icon: AlertTriangle,
      label: t("مواعيدك قليلة — أضف المزيد", "Low availability — add more slots"),
      href: "/teacher/availability",
      severity: "critical" as const,
    },
  ].filter(Boolean) as Item[];

  if (items.length === 0) return null;

  return (
    <div className="glass-card p-5">
      <h3 className="mb-3 text-sm font-semibold text-gold">{t("مهامك الآن", "Your Actions Now")}</h3>
      <ul className="space-y-2">
        {items.map((item, i) => (
          <li key={i}>
            <Link href={item.href} className="block rounded-xl transition-colors hover:opacity-80">
              <PriorityChip
                icon={item.icon}
                label={item.label}
                severity={item.severity}
                className="min-h-[44px] w-full rounded-xl p-3"
              />
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
