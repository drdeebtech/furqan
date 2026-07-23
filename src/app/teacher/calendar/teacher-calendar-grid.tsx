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
import { ChevronLeft, ChevronRight, Clock } from "lucide-react";
import { useLang } from "@/lib/i18n/context";
import { WidgetCard } from "@/components/shared/widget-card";
import type {
  TeacherCalendarEvent,
  TeacherWeeklyAvailabilityRow,
} from "@/lib/views/teacher-calendar";

interface Props {
  monthIso: string;
  events: TeacherCalendarEvent[];
  weeklyAvailability: TeacherWeeklyAvailabilityRow[];
}

const DAY_LABELS_AR = ["أ", "ث", "ث", "أ", "خ", "ج", "س"]; // Sun..Sat
const DAY_LABELS_EN = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

/** "14h" / "3.5h" — strip the trailing zero on whole-hour values. Caught
 *  in the 2026-05-06 visual audit (the prior code rendered "14h" alongside
 *  "3.0h" — inconsistent decimal). */
function formatHours(minutes: number): string {
  const hours = minutes / 60;
  if (hours === Math.floor(hours)) return `${hours}h`;
  return `${hours.toFixed(1)}h`;
}

/** Format an ISO timestamp's *local time* as `HH:mm`. Runs in the browser,
 *  so the teacher sees their local timezone — fixing the UTC bug filed in
 *  `project_calendar_utc_followup.md`. */
function formatLocalTime(iso: string, locale: string): string {
  return new Date(iso).toLocaleTimeString(locale, {
    hour: "2-digit",
    minute: "2-digit",
  });
}

/** Local-date key matching `format(d, "yyyy-MM-dd")` so client-side
 *  bucket-by-date matches the grid's per-cell lookup. */
function localDateKey(iso: string): string {
  const d = new Date(iso);
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

export function TeacherCalendarGrid({
  monthIso,
  events,
  weeklyAvailability,
}: Props) {
  const { t, dir, lang } = useLang();
  const month = new Date(monthIso);
  const today = new Date();
  const localeArg = lang === "ar" ? "ar-EG" : "en-US";

  const gridStart = startOfWeek(startOfMonth(month), { weekStartsOn: 1 });
  const gridEnd = endOfWeek(endOfMonth(month), { weekStartsOn: 1 });
  const days = eachDayOfInterval({ start: gridStart, end: gridEnd });

  // Group events by local-date key so non-UTC teachers see them on the
  // right day cell. Server returns raw ISO; client buckets locally.
  const eventsByDate = events.reduce<Record<string, TeacherCalendarEvent[]>>(
    (acc, e) => {
      const key = localDateKey(e.isoStart);
      (acc[key] ||= []).push(e);
      return acc;
    },
    {},
  );

  // Weekday set with recurring slots — used to differentiate "no slot"
  // (faint hint) vs days the teacher could be booked.
  const weekdaysWithSlots = new Set(
    weeklyAvailability.map((w) => w.dayOfWeek),
  );

  const prevMonth = format(subMonths(month, 1), "yyyy-MM");
  const nextMonth = format(addMonths(month, 1), "yyyy-MM");
  const monthLabel = format(month, "MMMM yyyy");

  // Display the day-header in a Mon-first grid (date-fns weekStartsOn: 1).
  const dayHeaderLabels = (lang === "ar" ? DAY_LABELS_AR : DAY_LABELS_EN);
  const monFirstHeaders = [...dayHeaderLabels.slice(1), dayHeaderLabels[0]];

  const legend = [
    { color: "#F59E0B", label: t("جلسة محجوزة", "Booked session") },
    { color: "#10B981", label: t("حلقة", "Halaqa") },
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

      {/* Weekly availability summary row — replaces the per-cell repetition.
          One chip per weekday with non-zero recurring slots. */}
      {weeklyAvailability.length > 0 && (
        <div className="mb-5 flex flex-wrap items-center gap-2 rounded-2xl border border-card-border bg-card/30 px-4 py-3">
          <span className="inline-flex items-center gap-1.5 text-xs text-muted">
            <Clock size={12} aria-hidden="true" />
            {t("الإتاحة الأسبوعية المتكررة:", "Recurring weekly availability:")}
          </span>
          {weeklyAvailability.map((w) => {
            const labels = lang === "ar" ? DAY_LABELS_AR : DAY_LABELS_EN;
            return (
              <Link
                key={w.dayOfWeek}
                href="/teacher/availability"
                className="inline-flex items-center gap-1 rounded-full border border-card-border/60 bg-card/40 px-2 py-0.5 text-xs text-muted-light transition-colors hover:text-foreground"
              >
                <span className="font-medium">{labels[w.dayOfWeek]}</span>
                <span>· {formatHours(w.totalMinutes)}</span>
              </Link>
            );
          })}
        </div>
      )}

      <WidgetCard title={monthLabel}>
        <div className="grid grid-cols-7 gap-px overflow-hidden rounded-xl border border-[var(--surface-border)] bg-[var(--surface-border)]">
          {monFirstHeaders.map((d, i) => (
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
            const dow = d.getDay();
            // "No recurring slot" hint for in-month cells without bookings
            // and without weekday availability — distinguishes "free for
            // booking" from "slot pattern not configured."
            const showNoSlotHint =
              inMonth && all.length === 0 && !weekdaysWithSlots.has(dow);

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
                  {all.slice(0, 3).map((e) => {
                    const timeLabel = formatLocalTime(e.isoStart, localeArg);
                    return (
                      <Link
                        key={e.id}
                        href={e.href}
                        title={`${timeLabel} · ${e.label}`}
                        className="flex items-center gap-1 truncate rounded px-1 py-0.5 text-[10px] leading-tight transition-colors hover:bg-[var(--surface-hover)]"
                        style={{ color: e.color }}
                      >
                        <span
                          className="h-1.5 w-1.5 shrink-0 rounded-full"
                          style={{ background: e.color }}
                        />
                        <span className="truncate">
                          {timeLabel} · {e.label}
                        </span>
                      </Link>
                    );
                  })}
                  {all.length > 3 && (
                    <span className="px-1 text-[10px] text-muted-light">
                      +{all.length - 3} {t("أخرى", "more")}
                    </span>
                  )}
                  {showNoSlotHint && (
                    <span className="px-1 text-[10px] italic text-muted-light/60">
                      {t("لا يوجد توقيت", "no slot")}
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
