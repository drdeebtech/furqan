"use client";

import Link from "next/link";
import {
  startOfMonth,
  endOfMonth,
  startOfWeek,
  endOfWeek,
  eachDayOfInterval,
  format,
  isSameMonth,
  addMonths,
  subMonths,
} from "date-fns";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { useLang } from "@/lib/i18n/context";
import { WidgetCard } from "@/components/shared/widget-card";
import type { CalendarEvent } from "@/lib/views/student-calendar";

interface Props {
  monthIso: string;
  todayIso: string;
  events: CalendarEvent[];
}

export function CalendarGrid({ monthIso, todayIso, events }: Props) {
  const { t, dir, lang } = useLang();
  const month = new Date(monthIso);

  // Build the full weeks-grid (always 6 rows × 7 cols for stability).
  const gridStart = startOfWeek(startOfMonth(month), { weekStartsOn: 1 }); // Mon
  const gridEnd = endOfWeek(endOfMonth(month), { weekStartsOn: 1 });
  const days = eachDayOfInterval({ start: gridStart, end: gridEnd });

  // Group events by ISO date.
  const eventsByDate = events.reduce<Record<string, CalendarEvent[]>>((acc, e) => {
    (acc[e.date] ||= []).push(e);
    return acc;
  }, {});

  const prevMonth = format(subMonths(month, 1), "yyyy-MM");
  const nextMonth = format(addMonths(month, 1), "yyyy-MM");
  const monthLabel = format(month, "MMMM yyyy");

  const dayHeaderLabels = lang === "ar"
    ? ["ث", "ث", "أ", "خ", "ج", "س", "ح"] // Mon..Sun in Arabic short
    : ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

  // ── Legend chips ────────────────────────────────────────────────
  const legend = [
    { color: "#3B82F6", label: t("جلسة", "Session") },
    { color: "#F59E0B", label: t("متابعة", "Follow-up") },
    { color: "#8B5CF6", label: t("انتهاء باقة", "Package expiry") },
    { color: "#06B6D4", label: t("تقييم", "Evaluation") },
  ];

  return (
    <div dir={dir} className="mx-auto max-w-[1400px] px-6 py-8 sm:px-8 sm:py-10">
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <h1 className="font-display text-3xl font-bold sm:text-4xl">
          {t("التقويم", "Calendar")}
        </h1>
        <div className="flex items-center gap-2">
          <Link
            href={`/student/calendar?month=${prevMonth}`}
            aria-label={t("الشهر السابق", "Previous month")}
            className="glass flex h-10 w-10 items-center justify-center rounded-xl text-muted transition-colors hover:text-foreground"
          >
            {dir === "rtl" ? <ChevronRight size={18} /> : <ChevronLeft size={18} />}
          </Link>
          <span className="min-w-[150px] text-center text-base font-semibold tabular-nums">
            {monthLabel}
          </span>
          <Link
            href={`/student/calendar?month=${nextMonth}`}
            aria-label={t("الشهر التالي", "Next month")}
            className="glass flex h-10 w-10 items-center justify-center rounded-xl text-muted transition-colors hover:text-foreground"
          >
            {dir === "rtl" ? <ChevronLeft size={18} /> : <ChevronRight size={18} />}
          </Link>
        </div>
      </div>

      <div className="mb-4 flex flex-wrap items-center gap-3 text-xs">
        {legend.map((l) => (
          <div key={l.label} className="flex items-center gap-1.5">
            <span className="h-2 w-2 rounded-full" style={{ background: l.color }} />
            <span className="text-muted">{l.label}</span>
          </div>
        ))}
      </div>

      <WidgetCard title={monthLabel}>
        <div className="grid grid-cols-7 gap-px overflow-hidden rounded-xl border border-[var(--surface-border)] bg-[var(--surface-border)]">
          {dayHeaderLabels.map((d, i) => (
            <div
              key={i}
              className="bg-[var(--surface)] py-2 text-center text-[11px] font-semibold uppercase tracking-wider text-muted-light"
            >
              {d}
            </div>
          ))}

          {days.map((d) => {
            const iso = format(d, "yyyy-MM-dd");
            const dayEvents = eventsByDate[iso] ?? [];
            const inMonth = isSameMonth(d, month);
            const isToday = iso === todayIso;

            return (
              <div
                key={iso}
                className={`min-h-[88px] bg-[var(--surface)] p-1.5 ${
                  inMonth ? "" : "opacity-40"
                }`}
              >
                <div className="mb-1 flex items-center justify-between">
                  <span
                    className={`inline-flex h-6 w-6 items-center justify-center rounded-full text-[11px] font-semibold ${
                      isToday
                        ? "bg-[var(--gold)] text-white"
                        : "text-foreground"
                    }`}
                  >
                    {format(d, "d")}
                  </span>
                </div>
                <div className="flex flex-col gap-0.5">
                  {dayEvents.slice(0, 3).map((e) => (
                    <Link
                      key={e.id}
                      href={e.href}
                      title={e.title}
                      className="flex items-center gap-1 truncate rounded px-1 py-0.5 text-[10px] leading-tight transition-colors hover:bg-[var(--surface-hover)]"
                      style={{ color: e.color }}
                    >
                      <span className="h-1.5 w-1.5 shrink-0 rounded-full" style={{ background: e.color }} />
                      <span className="truncate">{e.title}</span>
                    </Link>
                  ))}
                  {dayEvents.length > 3 && (
                    <span className="px-1 text-[10px] text-muted-light">
                      +{dayEvents.length - 3} {t("أخرى", "more")}
                    </span>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </WidgetCard>
    </div>
  );
}
