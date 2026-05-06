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
  isSameDay,
  addMonths,
  subMonths,
} from "date-fns";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { useLang } from "@/lib/i18n/context";
import { WidgetCard } from "@/components/shared/widget-card";
import type { TeacherCalendarEvent } from "@/lib/teacher-queries";

interface Props {
  monthIso: string;
  events: TeacherCalendarEvent[];
}

/**
 * Fork of the student CalendarGrid for the teacher's overlay calendar.
 * Forked rather than generalized because:
 *  - three event classes (booking / halaqa / availability), each with
 *    semantics specific to teacher operations
 *  - month-nav links are role-specific (`/teacher/calendar?month=...`)
 *  - the availability summary chip uses muted styling that the student
 *    version doesn't render
 *
 * If a third role ever adopts the same overlay model, refactor both
 * forks into one generalized component then. Until then, two small
 * components beat one over-parameterized one.
 */
export function TeacherCalendarGrid({ monthIso, events }: Props) {
  const { t, dir, lang } = useLang();
  const month = new Date(monthIso);
  const today = new Date();

  const gridStart = startOfWeek(startOfMonth(month), { weekStartsOn: 1 });
  const gridEnd = endOfWeek(endOfMonth(month), { weekStartsOn: 1 });
  const days = eachDayOfInterval({ start: gridStart, end: gridEnd });

  const eventsByDate = events.reduce<
    Record<string, TeacherCalendarEvent[]>
  >((acc, e) => {
    (acc[e.date] ||= []).push(e);
    return acc;
  }, {});

  const prevMonth = format(subMonths(month, 1), "yyyy-MM");
  const nextMonth = format(addMonths(month, 1), "yyyy-MM");
  const monthLabel = format(month, "MMMM yyyy");

  const dayHeaderLabels =
    lang === "ar"
      ? ["ث", "ث", "أ", "خ", "ج", "س", "ح"]
      : ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

  const legend = [
    { color: "#F59E0B", label: t("جلسة محجوزة", "Booked session") },
    { color: "#10B981", label: t("حلقة", "Halaqa") },
    { color: "#94A3B8", label: t("متاح", "Available") },
  ];

  return (
    <div dir={dir} className="mx-auto max-w-[1400px] px-6 py-8 sm:px-8 sm:py-10">
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <h1 className="font-display text-3xl font-bold sm:text-4xl">
          {t("تقويم المعلم", "Teacher Calendar")}
        </h1>
        <div className="flex items-center gap-2">
          <Link
            href={`/teacher/calendar?month=${prevMonth}`}
            aria-label={t("الشهر السابق", "Previous month")}
            className="glass flex h-10 w-10 items-center justify-center rounded-xl text-muted transition-colors hover:text-foreground"
          >
            {dir === "rtl" ? <ChevronRight size={18} /> : <ChevronLeft size={18} />}
          </Link>
          <span className="min-w-[150px] text-center text-base font-semibold tabular-nums">
            {monthLabel}
          </span>
          <Link
            href={`/teacher/calendar?month=${nextMonth}`}
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
            <span
              className="h-2 w-2 rounded-full"
              style={{ background: l.color }}
            />
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
            const all = eventsByDate[iso] || [];
            const inMonth = isSameMonth(d, month);
            const isToday = isSameDay(d, today);

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
                  {all.slice(0, 3).map((e) => (
                    <Link
                      key={e.id}
                      href={e.href}
                      title={e.title}
                      className={`flex items-center gap-1 truncate rounded px-1 py-0.5 text-[10px] leading-tight transition-colors hover:bg-[var(--surface-hover)] ${
                        e.kind === "availability" ? "italic opacity-70" : ""
                      }`}
                      style={{ color: e.color }}
                    >
                      <span
                        className="h-1.5 w-1.5 shrink-0 rounded-full"
                        style={{ background: e.color }}
                      />
                      <span className="truncate">{e.title}</span>
                    </Link>
                  ))}
                  {all.length > 3 && (
                    <span className="px-1 text-[10px] text-muted-light">
                      +{all.length - 3} {t("أخرى", "more")}
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
