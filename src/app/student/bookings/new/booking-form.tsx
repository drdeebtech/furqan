"use client";

import { useActionState, useState } from "react";
import Link from "next/link";
import { ArrowRight, CalendarPlus, Clock, AlertCircle } from "lucide-react";
import { createBooking, type BookingResult } from "./actions";
import { SESSION_TYPE_AR } from "@/lib/constants";
import type { SessionType } from "@/types/database";

const DAY_AR: Record<number, string> = {
  0: "الأحد", 1: "الإثنين", 2: "الثلاثاء", 3: "الأربعاء",
  4: "الخميس", 5: "الجمعة", 6: "السبت",
};

const ALL_DURATIONS = [
  { value: 30, label: "٣٠ دقيقة", en: "30 min" },
  { value: 45, label: "٤٥ دقيقة", en: "45 min" },
  { value: 60, label: "٦٠ دقيقة", en: "60 min" },
];

const ALL_SESSION_TYPES: SessionType[] = [
  "hifz", "tajweed", "muraja", "tilawa", "qiraat", "tafsir", "combined", "other",
];

interface TeacherData {
  id: string;
  name: string;
  hourlyRate: number;
  specialties: string[];
  recitationStandards: string[];
  bio: string | null;
}

interface AvailSlot {
  dayOfWeek: number;
  startTime: string;
  endTime: string;
  slotDuration: number;
}

export function BookingForm({
  teacher,
  availability,
}: {
  teacher: TeacherData;
  availability: AvailSlot[];
}) {
  // Fix #2: Filter durations based on teacher's max slot duration
  const maxSlotDuration = availability.length > 0
    ? Math.max(...availability.map((s) => s.slotDuration))
    : 60;
  const durations = ALL_DURATIONS.filter((d) => d.value <= maxSlotDuration);
  const defaultDuration = durations.length > 0 ? durations[durations.length - 1].value : 30;

  // Fix #1: If teacher has no specialties, show all session types
  const sessionTypes = teacher.specialties.length > 0
    ? teacher.specialties
    : ALL_SESSION_TYPES;

  const [duration, setDuration] = useState(defaultDuration);
  const [selectedDate, setSelectedDate] = useState("");
  const [state, formAction, pending] = useActionState<BookingResult, FormData>(createBooking, {});

  const price = Number((teacher.hourlyRate * (duration / 60)).toFixed(2));

  const minDateObj = new Date();
  if (process.env.NODE_ENV !== "development") {
    minDateObj.setDate(minDateObj.getDate() + 1);
  }
  const minDate = minDateObj.toISOString().split("T")[0];

  // Get available time slots for selected date
  const selectedDayOfWeek = selectedDate ? new Date(selectedDate).getDay() : null;
  const daySlots = selectedDayOfWeek !== null
    ? availability.filter((s) => s.dayOfWeek === selectedDayOfWeek)
    : [];

  // Check if selected date's day of week has any availability
  const dateHasSlots = daySlots.length > 0;

  return (
    <>
      <Link href="/student/teachers" className="mb-6 inline-flex items-center gap-1 text-sm text-gold transition-colors hover:text-gold-hover focus-ring">
        <ArrowRight size={14} />
        العودة للمعلمين
      </Link>

      {/* Teacher header */}
      <div className="mb-6 rounded-xl border border-card-border bg-card p-5">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-xl font-bold">{teacher.name}</h1>
            {teacher.bio && (
              <p className="mt-1 text-sm text-muted">
                {teacher.bio.length > 120 ? teacher.bio.slice(0, 120) + "…" : teacher.bio}
              </p>
            )}
          </div>
          <div className="text-left">
            <span className="text-2xl font-bold text-gold">${teacher.hourlyRate}</span>
            <span className="text-sm text-muted">/ساعة</span>
          </div>
        </div>
      </div>

      {/* Teacher availability info */}
      {availability.length > 0 && (
        <div className="mb-6 rounded-xl border border-gold/20 bg-gold/5 p-4">
          <p className="mb-2 text-sm font-medium text-gold">أوقات المعلم المتاحة:</p>
          <div className="flex flex-wrap gap-2">
            {[...new Set(availability.map((s) => s.dayOfWeek))].sort().map((day) => {
              const slots = availability.filter((s) => s.dayOfWeek === day);
              return (
                <span key={day} className="rounded-full border border-card-border bg-card px-3 py-1 text-xs">
                  {DAY_AR[day]} {slots[0].startTime.slice(0, 5)}–{slots[0].endTime.slice(0, 5)}
                </span>
              );
            })}
          </div>
        </div>
      )}

      {availability.length === 0 && (
        <div className="mb-6 rounded-xl border border-amber-500/30 bg-amber-500/10 p-4 text-sm text-amber-400">
          <AlertCircle size={16} className="mb-1 inline" /> هذا المعلم لم يحدد مواعيد إتاحته بعد — اختر الوقت المناسب لك وسيتم التأكيد لاحقاً.
        </div>
      )}

      {state.error && (
        <div className="mb-4 rounded-lg border border-error/30 bg-error/10 p-3 text-sm text-error">
          {state.error}
        </div>
      )}

      <form action={formAction} className="space-y-5">
        <input type="hidden" name="teacher_id" value={teacher.id} />
        <input type="hidden" name="duration_min" value={duration} />

        {/* Session Type */}
        <div>
          <label className="mb-2 block text-sm font-medium">
            نوع الجلسة <span className="text-xs text-muted">Session type</span>
          </label>
          <div className="grid grid-cols-2 gap-2">
            {sessionTypes.map((s) => (
              <label key={s} className="flex cursor-pointer items-center gap-2 rounded-xl border border-input-border bg-input neu-inset px-3 py-2.5 text-sm transition-colors has-[:checked]:border-gold has-[:checked]:bg-gold/10">
                <input type="radio" name="session_type" value={s} defaultChecked={s === sessionTypes[0]} className="accent-gold" />
                {SESSION_TYPE_AR[s as SessionType] ?? s}
              </label>
            ))}
          </div>
        </div>

        {/* Duration */}
        <div>
          <label className="mb-2 block text-sm font-medium">
            <Clock size={14} className="ml-1 inline text-gold" />
            المدة <span className="text-xs text-muted">Duration</span>
          </label>
          <div className={`grid gap-2 ${durations.length === 1 ? "grid-cols-1" : durations.length === 2 ? "grid-cols-2" : "grid-cols-3"}`}>
            {durations.map((d) => (
              <button
                key={d.value}
                type="button"
                onClick={() => setDuration(d.value)}
                className={`rounded-xl border px-3 py-2.5 text-sm transition-colors ${
                  duration === d.value
                    ? "border-gold bg-gold/10 text-gold"
                    : "border-input-border bg-input text-foreground hover:border-gold/50"
                }`}
              >
                {d.label}
              </button>
            ))}
          </div>
        </div>

        {/* Date */}
        <div>
          <label htmlFor="date" className="mb-1 block text-sm font-medium">
            التاريخ <span className="text-xs text-muted">Date</span>
          </label>
          <input
            id="date"
            name="date"
            type="date"
            required
            min={minDate}
            dir="ltr"
            value={selectedDate}
            onChange={(e) => setSelectedDate(e.target.value)}
            className="w-full rounded-xl border border-input-border bg-input neu-inset px-4 py-2.5 text-left text-foreground focus:border-gold focus:outline-none focus:ring-1 focus:ring-gold"
          />
          {selectedDate && !dateHasSlots && availability.length > 0 && (
            <p className="mt-1 text-xs text-amber-400">
              <AlertCircle size={12} className="inline" /> المعلم غير متاح في هذا اليوم — اختر يوماً آخر
            </p>
          )}
        </div>

        {/* Time */}
        <div>
          <label htmlFor="time" className="mb-1 block text-sm font-medium">
            الوقت <span className="text-xs text-muted">Time</span>
          </label>
          {daySlots.length > 0 ? (
            <select
              id="time"
              name="time"
              required
              className="w-full rounded-xl border border-input-border bg-input neu-inset px-4 py-2.5 text-foreground focus:border-gold focus:outline-none focus:ring-1 focus:ring-gold"
            >
              <option value="">اختر الوقت</option>
              {daySlots.map((slot) => {
                const start = slot.startTime.slice(0, 5);
                const end = slot.endTime.slice(0, 5);
                return (
                  <option key={`${slot.dayOfWeek}-${start}`} value={start}>
                    {start} — {end}
                  </option>
                );
              })}
            </select>
          ) : (
            <input
              id="time"
              name="time"
              type="time"
              required
              dir="ltr"
              className="w-full rounded-xl border border-input-border bg-input neu-inset px-4 py-2.5 text-left text-foreground focus:border-gold focus:outline-none focus:ring-1 focus:ring-gold"
            />
          )}
        </div>

        {/* Notes */}
        <div>
          <label htmlFor="notes" className="mb-1 block text-sm font-medium">
            ملاحظات <span className="text-xs text-muted">Notes (optional)</span>
          </label>
          <textarea
            id="notes"
            name="notes"
            rows={3}
            className="w-full resize-none rounded-xl border border-input-border bg-input neu-inset px-4 py-2.5 text-foreground placeholder:text-muted/50 focus:border-gold focus:outline-none focus:ring-1 focus:ring-gold"
            placeholder="أي ملاحظات للمعلم…"
          />
        </div>

        {/* Price summary */}
        <div className="rounded-xl border border-gold/20 bg-gold/5 p-4">
          <div className="flex items-center justify-between">
            <span className="text-sm text-muted">${teacher.hourlyRate}/ساعة × {duration} دقيقة</span>
            <span className="text-2xl font-bold text-gold">${price}</span>
          </div>
        </div>

        {/* Submit */}
        <button
          type="submit"
          disabled={pending}
          className="flex w-full items-center justify-center gap-2 rounded-full bg-primary py-3 text-lg font-semibold text-white neu-btn transition-colors hover:bg-primary-hover disabled:opacity-50"
        >
          {pending ? (
            <span className="h-5 w-5 animate-spin rounded-full border-2 border-white/30 border-t-white" />
          ) : (
            <>
              <CalendarPlus size={20} />
              تأكيد الحجز
            </>
          )}
        </button>
      </form>
    </>
  );
}
