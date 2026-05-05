"use client";

import Link from "next/link";
import { ArrowLeft, ArrowRight, BookOpen, Calendar, ClipboardCheck, Clock } from "lucide-react";
import { useLang } from "@/lib/i18n/context";
import { WidgetCard } from "@/components/shared/widget-card";

interface TodaysPlanItem {
  id: string;
  kind: "session" | "homework" | "quiz";
  title: string;
  detail: string;
  href: string;
  /** ISO timestamp — used to sort and to render the time chip. */
  at: string | null;
  /** Optional urgency flag — renders an attention-tone border. */
  urgent?: boolean;
}

interface TodaysPlanProps {
  items: TodaysPlanItem[];
  homeworkPulse: { overdue: number; dueToday: number; dueThisWeek: number };
}

/**
 * Unified "what's on my plate today" surface — sessions + homework + quizzes
 * in one card, sorted chronologically. Replaces the implicit context-juggling
 * the dashboard required before (4 separate KPIs to figure out the day).
 */
export function TodaysPlan({ items, homeworkPulse }: TodaysPlanProps) {
  const { t, dir, lang } = useLang();
  const Arrow = dir === "rtl" ? ArrowLeft : ArrowRight;
  const locale = lang === "ar" ? "ar" : "en-US";

  const headerAction = (
    <Link
      href="/student/calendar"
      className="text-xs font-medium text-gold transition-colors hover:text-gold-light"
    >
      {t("التقويم", "Open calendar")} →
    </Link>
  );

  return (
    <WidgetCard
      title={t("خطة اليوم", "Today's Plan")}
      subtitle={items.length > 0 ? `${items.length} ${t("بنود", "items")}` : undefined}
      headerAction={headerAction}
    >
      {items.length === 0 ? (
        <EmptyPlan homeworkPulse={homeworkPulse} />
      ) : (
        <ul className="space-y-2" aria-label={t("بنود اليوم", "Today's items")}>
          {items.map((item) => {
            const Icon = item.kind === "session" ? Calendar
              : item.kind === "homework" ? BookOpen
              : ClipboardCheck;
            const tone = item.urgent ? "border-warning/30 bg-warning/5" : "border-[var(--surface-border)] bg-surface/40";
            const timeChip = item.at
              ? new Date(item.at).toLocaleTimeString(locale, { hour: "2-digit", minute: "2-digit" })
              : null;
            return (
              <li key={item.id}>
                <Link
                  href={item.href}
                  className={`group flex items-center gap-3 rounded-xl border ${tone} p-3 transition-colors hover:border-gold/30`}
                >
                  <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-gold/10 text-gold">
                    <Icon size={18} aria-hidden="true" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-semibold text-foreground">{item.title}</p>
                    <p className="mt-0.5 truncate text-xs text-muted">{item.detail}</p>
                  </div>
                  {timeChip && (
                    <span
                      className="hidden shrink-0 rounded-full bg-gold/10 px-2.5 py-1 font-mono text-[11px] font-semibold text-gold sm:inline-flex"
                      aria-label={t("الوقت", "Time")}
                      suppressHydrationWarning
                    >
                      {timeChip}
                    </span>
                  )}
                  <Arrow size={14} className="text-muted-light transition-colors group-hover:text-foreground" aria-hidden="true" />
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </WidgetCard>
  );
}

function EmptyPlan({ homeworkPulse }: { homeworkPulse: { overdue: number; dueToday: number; dueThisWeek: number } }) {
  const { t } = useLang();
  const hasHwSignal = homeworkPulse.overdue + homeworkPulse.dueToday + homeworkPulse.dueThisWeek > 0;

  return (
    <div className="flex flex-col items-center px-4 py-6 text-center">
      <div className="mb-3 inline-flex h-10 w-10 items-center justify-center rounded-xl bg-gold/10">
        <Clock size={18} className="text-gold" aria-hidden="true" />
      </div>
      <p className="text-sm font-semibold text-foreground">
        {t("لا شيء مجدول لليوم", "Nothing scheduled today")}
      </p>
      <p className="mt-1 max-w-xs text-xs leading-relaxed text-muted">
        {hasHwSignal
          ? t(
              "لكن هناك متابعات قادمة. ربما الوقت مناسب لمراجعة هادئة.",
              "There are follow-ups coming up. A quiet review might be a good use of the time.",
            )
          : t(
              "وقت مفتوح. مراجعة، حفظ، أو احجز جلسة قادمة.",
              "Open time. Revise, memorize, or book your next session.",
            )}
      </p>
      <Link
        href="/student/teachers"
        className="mt-4 text-xs font-medium text-gold transition-colors hover:text-gold-light"
      >
        {t("احجز جلسة جديدة ←", "Book a new session →")}
      </Link>
    </div>
  );
}
