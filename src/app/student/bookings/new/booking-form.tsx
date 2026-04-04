"use client";

import { useActionState, useState } from "react";
import Link from "next/link";
import { ArrowRight, CalendarPlus, Clock } from "lucide-react";
import { createBooking, type BookingResult } from "./actions";
import type { SessionType } from "@/types/database";

const SESSION_TYPE_AR: Record<SessionType, string> = {
  hifz: "حفظ",
  muraja: "مراجعة",
  tajweed: "تجويد",
  tilawa: "تلاوة",
  qiraat: "قراءات",
  tafsir: "تفسير",
  combined: "حفظ + مراجعة",
  other: "أخرى",
};

const DURATIONS = [
  { value: 30, label: "٣٠ دقيقة", en: "30 min" },
  { value: 45, label: "٤٥ دقيقة", en: "45 min" },
  { value: 60, label: "٦٠ دقيقة", en: "60 min" },
];

interface TeacherData {
  id: string;
  name: string;
  hourlyRate: number;
  specialties: string[];
  recitationStandards: string[];
  bio: string | null;
}

export function BookingForm({
  teacher,
  studentId,
}: {
  teacher: TeacherData;
  studentId: string;
}) {
  const [duration, setDuration] = useState(60);
  const [state, formAction, pending] = useActionState<BookingResult, FormData>(
    createBooking,
    {},
  );

  const price = Number((teacher.hourlyRate * (duration / 60)).toFixed(2));

  // Tomorrow as min date
  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  const minDate = tomorrow.toISOString().split("T")[0];

  return (
    <>
      {/* Back link */}
      <Link
        href="/student/teachers"
        className="mb-6 inline-flex items-center gap-1 text-sm text-gold hover:text-gold-hover"
      >
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
                {teacher.bio.length > 120
                  ? teacher.bio.slice(0, 120) + "…"
                  : teacher.bio}
              </p>
            )}
          </div>
          <div className="text-left">
            <span className="text-2xl font-bold text-gold">
              ${teacher.hourlyRate}
            </span>
            <span className="text-sm text-muted">/ساعة</span>
          </div>
        </div>
      </div>

      {/* Error */}
      {state.error && (
        <div className="mb-4 rounded-lg border border-error/30 bg-error/10 p-3 text-sm text-error">
          {state.error}
        </div>
      )}

      {/* Form */}
      <form action={formAction} className="space-y-5">
        <input type="hidden" name="student_id" value={studentId} />
        <input type="hidden" name="teacher_id" value={teacher.id} />
        <input type="hidden" name="rate_snapshot" value={teacher.hourlyRate} />
        <input type="hidden" name="duration_min" value={duration} />

        {/* Session Type */}
        <div>
          <label className="mb-2 block text-sm font-medium">
            نوع الجلسة
            <span className="mr-2 text-xs text-muted">Session type</span>
          </label>
          <div className="grid grid-cols-2 gap-2">
            {teacher.specialties.map((s) => (
              <label
                key={s}
                className="flex cursor-pointer items-center gap-2 rounded-lg border border-input-border bg-input px-3 py-2.5 text-sm transition-colors has-[:checked]:border-gold has-[:checked]:bg-gold/10"
              >
                <input
                  type="radio"
                  name="session_type"
                  value={s}
                  defaultChecked={s === teacher.specialties[0]}
                  className="accent-gold"
                />
                {SESSION_TYPE_AR[s as SessionType] ?? s}
              </label>
            ))}
          </div>
        </div>

        {/* Duration */}
        <div>
          <label className="mb-2 block text-sm font-medium">
            <Clock size={14} className="ml-1 inline text-gold" />
            المدة
            <span className="mr-2 text-xs text-muted">Duration</span>
          </label>
          <div className="grid grid-cols-3 gap-2">
            {DURATIONS.map((d) => (
              <button
                key={d.value}
                type="button"
                onClick={() => setDuration(d.value)}
                className={`rounded-lg border px-3 py-2.5 text-sm transition-colors ${
                  duration === d.value
                    ? "border-gold bg-gold/10 text-gold"
                    : "border-input-border bg-input text-foreground hover:border-gold/50"
                }`}
              >
                {d.label}
                <span className="mr-1 text-xs text-muted">{d.en}</span>
              </button>
            ))}
          </div>
        </div>

        {/* Date */}
        <div>
          <label htmlFor="date" className="mb-1 block text-sm font-medium">
            التاريخ
            <span className="mr-2 text-xs text-muted">Date</span>
          </label>
          <input
            id="date"
            name="date"
            type="date"
            required
            min={minDate}
            dir="ltr"
            className="w-full rounded-lg border border-input-border bg-input px-4 py-2.5 text-left text-foreground focus:border-input-focus focus:outline-none focus:ring-1 focus:ring-input-focus"
          />
        </div>

        {/* Time */}
        <div>
          <label htmlFor="time" className="mb-1 block text-sm font-medium">
            الوقت
            <span className="mr-2 text-xs text-muted">Time</span>
          </label>
          <input
            id="time"
            name="time"
            type="time"
            required
            dir="ltr"
            className="w-full rounded-lg border border-input-border bg-input px-4 py-2.5 text-left text-foreground focus:border-input-focus focus:outline-none focus:ring-1 focus:ring-input-focus"
          />
        </div>

        {/* Notes */}
        <div>
          <label htmlFor="notes" className="mb-1 block text-sm font-medium">
            ملاحظات
            <span className="mr-2 text-xs text-muted">Notes (optional)</span>
          </label>
          <textarea
            id="notes"
            name="notes"
            rows={3}
            className="w-full resize-none rounded-lg border border-input-border bg-input px-4 py-2.5 text-foreground placeholder:text-muted/50 focus:border-input-focus focus:outline-none focus:ring-1 focus:ring-input-focus"
            placeholder="أي ملاحظات للمعلم…"
          />
        </div>

        {/* Price summary */}
        <div className="rounded-xl border border-gold/20 bg-gold/5 p-4">
          <div className="flex items-center justify-between">
            <span className="text-sm text-muted">
              ${teacher.hourlyRate}/ساعة × {duration} دقيقة
            </span>
            <span className="text-2xl font-bold text-gold">${price}</span>
          </div>
        </div>

        {/* Submit */}
        <button
          type="submit"
          disabled={pending}
          className="flex w-full items-center justify-center gap-2 rounded-lg bg-gold py-3 text-lg font-semibold text-black transition-colors hover:bg-gold-hover disabled:opacity-50"
        >
          {pending ? (
            <span className="h-5 w-5 animate-spin rounded-full border-2 border-black/30 border-t-black" />
          ) : (
            <>
              <CalendarPlus size={20} />
              تأكيد الحجز
              <span className="text-sm opacity-70">Confirm Booking</span>
            </>
          )}
        </button>
      </form>
    </>
  );
}
