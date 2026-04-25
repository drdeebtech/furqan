"use client";

import { useActionState, useState } from "react";
import Link from "next/link";
import { ArrowRight, CalendarPlus, Clock, AlertCircle, ChevronDown } from "lucide-react";
import { createBooking, type BookingResult } from "./actions";
import { SESSION_TYPE_AR } from "@/lib/constants";
import { useLang } from "@/lib/i18n/context";
import type { SessionType } from "@/types/database";
import { BookingSteps } from "@/components/shared/booking-steps";

const DAY_AR: Record<number, string> = {
  0: "الأحد", 1: "الإثنين", 2: "الثلاثاء", 3: "الأربعاء",
  4: "الخميس", 5: "الجمعة", 6: "السبت",
};

const ALL_DURATIONS = [
  { value: 30, label: "٣٠ دقيقة" },
  { value: 45, label: "٤٥ دقيقة" },
  { value: 60, label: "٦٠ دقيقة" },
];

const ALL_SESSION_TYPES: SessionType[] = [
  "hifz", "tajweed", "muraja", "tilawa", "qiraat", "tafsir", "combined", "other",
];

const SESSION_TYPE_EN: Record<SessionType, string> = {
  hifz: "Hifz", muraja: "Review", tajweed: "Tajweed", tilawa: "Tilawa",
  qiraat: "Qiraat", tafsir: "Tafsir", combined: "Hifz + Review", other: "Other",
};

interface TeacherData {
  id: string; name: string; hourlyRate: number;
  specialties: string[]; recitationStandards: string[]; bio: string | null;
}

interface AvailSlot {
  dayOfWeek: number; startTime: string; endTime: string; slotDuration: number;
}

export function BookingForm({ teacher, availability }: { teacher: TeacherData; availability: AvailSlot[] }) {
  const { t, lang } = useLang();
  const locale = lang === "ar" ? "ar" : "en-US";
  const maxSlotDuration = availability.length > 0 ? Math.max(...availability.map((s) => s.slotDuration)) : 60;
  const durations = ALL_DURATIONS.filter((d) => d.value <= maxSlotDuration);
  const defaultDuration = durations.length > 0 ? durations[durations.length - 1].value : 30;
  const sessionTypes = teacher.specialties.length > 0 ? teacher.specialties : ALL_SESSION_TYPES;

  const [duration, setDuration] = useState(defaultDuration);
  const [selectedDate, setSelectedDate] = useState("");
  const [selectedTime, setSelectedTime] = useState("");
  const [selectedType, setSelectedType] = useState(sessionTypes[0]);
  const [notes, setNotes] = useState("");
  const [showNotes, setShowNotes] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [state, formAction, pending] = useActionState<BookingResult, FormData>(createBooking, {});

  const _minDate = new Date().toISOString().split("T")[0];

  // Available days of week from teacher's schedule
  const availableDays = new Set(availability.map((s) => s.dayOfWeek));

  // Filter: only allow dates on available days
  function isDateAvailable(dateStr: string): boolean {
    if (availability.length === 0) return true; // no schedule = any day
    const day = new Date(dateStr).getDay();
    return availableDays.has(day);
  }

  const selectedDayOfWeek = selectedDate ? new Date(selectedDate).getDay() : null;
  const daySlots = selectedDayOfWeek !== null ? availability.filter((s) => s.dayOfWeek === selectedDayOfWeek) : [];

  // Generate next 14 days as date options (filtered by availability)
  const dateOptions: { value: string; label: string; available: boolean }[] = [];
  for (let i = 0; i < 14; i++) {
    const d = new Date();
    d.setDate(d.getDate() + i);
    const val = d.toISOString().split("T")[0];
    const available = isDateAvailable(val);
    dateOptions.push({
      value: val,
      label: `${DAY_AR[d.getDay()]} ${d.getDate()}/${d.getMonth() + 1}`,
      available,
    });
  }

  // Check if form is complete for confirmation
  const isComplete = selectedType && duration && selectedDate && selectedTime;

  return (
    <>
      <BookingSteps current={showConfirm ? 3 : 2} />

      <Link href="/student/teachers" className="mb-4 inline-flex items-center gap-1 text-sm text-gold hover:text-gold-hover">
        <ArrowRight size={14} /> العودة للمعلمين
      </Link>

      {/* Teacher header - compact */}
      <div className="mb-4 glass-card p-4">
        <h1 className="text-lg font-bold">{teacher.name}</h1>
        {availability.length > 0 && (
          <div className="mt-2 flex flex-wrap gap-1.5">
            {[...new Set(availability.map((s) => s.dayOfWeek))].sort().map((day) => {
              const slots = availability.filter((s) => s.dayOfWeek === day);
              return (
                <span key={day} className="glass glass-pill px-2 py-0.5 text-xs text-gold">
                  {DAY_AR[day]} {slots[0].startTime.slice(0, 5)}
                </span>
              );
            })}
          </div>
        )}
      </div>

      {state.error && (
        <div className="mb-4 rounded-lg border border-error/30 bg-error/10 p-3 text-sm text-error">{state.error}</div>
      )}

      {/* Confirmation Summary */}
      {showConfirm && isComplete ? (
        <div className="space-y-4">
          <div className="glass-card p-6 text-center">
            <p className="text-sm text-gold">تأكيد الحجز</p>
            <h2 className="mt-2 text-xl font-bold">{teacher.name}</h2>
            <div className="mt-3 space-y-1 text-sm">
              <p>{(lang === "ar" ? SESSION_TYPE_AR[selectedType as SessionType] : SESSION_TYPE_EN[selectedType as SessionType]) ?? selectedType} · {duration} {lang === "ar" ? "دقيقة" : "min"}</p>
              <p className="text-muted">
                {new Date(selectedDate).toLocaleDateString(locale, { weekday: "long", day: "numeric", month: "long" })}
                {" · "}
                {selectedTime}
              </p>
            </div>
          </div>

          <form action={formAction}>
            <input type="hidden" name="teacher_id" value={teacher.id} />
            <input type="hidden" name="duration_min" value={duration} />
            <input type="hidden" name="session_type" value={selectedType} />
            <input type="hidden" name="date" value={selectedDate} />
            <input type="hidden" name="time" value={selectedTime} />
            <input type="hidden" name="notes" value={notes} />
            <button
              type="submit"
              disabled={pending}
              className="focus-ring flex w-full items-center justify-center gap-2 rounded-xl glass-gold py-4 text-lg font-bold text-white transition-colors disabled:opacity-50"
            >
              {pending ? (
                <span className="h-5 w-5 animate-spin rounded-full border-2 border-background/30 border-t-background" />
              ) : (
                <><CalendarPlus size={20} /> تأكيد الحجز</>
              )}
            </button>
          </form>

          <button onClick={() => setShowConfirm(false)} className="focus-ring w-full text-center text-sm text-muted hover:text-gold">
            ← تعديل التفاصيل
          </button>
        </div>
      ) : (
        <div className="space-y-5">
          {/* Session Type */}
          <div>
            <label className="mb-2 block text-sm font-medium">نوع الجلسة</label>
            <div className="grid grid-cols-2 gap-2">
              {sessionTypes.map((s) => (
                <button
                  key={s}
                  type="button"
                  onClick={() => setSelectedType(s)}
                  className={`rounded-xl border px-3 py-3 text-sm transition-colors ${
                    selectedType === s ? "border-gold bg-gold/10 font-medium text-gold" : "glass-input hover:border-gold/50"
                  }`}
                >
                  {(lang === "ar" ? SESSION_TYPE_AR[s as SessionType] : SESSION_TYPE_EN[s as SessionType]) ?? s}
                </button>
              ))}
            </div>
          </div>

          {/* Duration */}
          <div>
            <label className="mb-2 block text-sm font-medium"><Clock size={14} className="ms-1 inline text-gold" /> المدة</label>
            <div className={`grid gap-2 ${durations.length === 1 ? "grid-cols-1" : durations.length === 2 ? "grid-cols-2" : "grid-cols-3"}`}>
              {durations.map((d) => (
                <button
                  key={d.value}
                  type="button"
                  onClick={() => setDuration(d.value)}
                  className={`rounded-xl border px-3 py-3 text-sm transition-colors ${
                    duration === d.value ? "border-gold bg-gold/10 font-medium text-gold" : "glass-input hover:border-gold/50"
                  }`}
                >
                  {d.label}
                </button>
              ))}
            </div>
          </div>

          {/* Date — tappable day buttons */}
          <div>
            <label className="mb-2 block text-sm font-medium">التاريخ</label>
            <div className="flex gap-2 overflow-x-auto pb-2">
              {dateOptions.map((d) => (
                <button
                  key={d.value}
                  type="button"
                  disabled={!d.available}
                  onClick={() => { setSelectedDate(d.value); setSelectedTime(""); }}
                  className={`shrink-0 rounded-xl border px-3 py-2.5 text-xs transition-colors ${
                    selectedDate === d.value ? "border-gold bg-gold/10 font-bold text-gold" :
                    d.available ? "glass-input hover:border-gold/50" :
                    "glass-input text-muted/30 line-through"
                  }`}
                >
                  {d.label}
                </button>
              ))}
            </div>
            {/* Date value is passed via hidden input inside the confirmation form */}
            {selectedDate && !isDateAvailable(selectedDate) && availability.length > 0 && (
              <p className="mt-1 text-xs text-amber-400"><AlertCircle size={12} className="inline" /> المعلم غير متاح في هذا اليوم</p>
            )}
          </div>

          {/* Time — tappable slot buttons */}
          {selectedDate && (
            <div>
              <label className="mb-2 block text-sm font-medium">الوقت</label>
              {daySlots.length > 0 ? (
                <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
                  {daySlots.map((slot) => {
                    const start = slot.startTime.slice(0, 5);
                    return (
                      <button
                        key={`${slot.dayOfWeek}-${start}`}
                        type="button"
                        onClick={() => setSelectedTime(start)}
                        className={`rounded-xl border px-3 py-3 text-sm transition-colors ${
                          selectedTime === start ? "border-gold bg-gold/10 font-bold text-gold" : "glass-input hover:border-gold/50"
                        }`}
                      >
                        {start}
                      </button>
                    );
                  })}
                </div>
              ) : availability.length === 0 ? (
                <input
                  type="time"
                  required
                  dir="ltr"
                  value={selectedTime}
                  onChange={(e) => setSelectedTime(e.target.value)}
                  className="w-full rounded-xl glass-input px-4 py-3 text-left text-foreground focus:border-gold focus:outline-none"
                />
              ) : (
                <p className="text-xs text-amber-400"><AlertCircle size={12} className="inline" /> لا توجد أوقات متاحة في هذا اليوم</p>
              )}
              {/* Time value is passed via hidden input inside the confirmation form */}
            </div>
          )}

          {/* Notes — collapsed by default */}
          <div>
            <button type="button" onClick={() => setShowNotes(!showNotes)} className="flex items-center gap-1 text-sm text-muted hover:text-gold">
              <ChevronDown size={14} className={`transition-transform ${showNotes ? "rotate-180" : ""}`} />
              إضافة ملاحظات (اختياري)
            </button>
            {showNotes && (
              <textarea
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                rows={3}
                aria-label={t("ملاحظات للمعلم", "Notes for teacher")}
                className="mt-2 w-full resize-none rounded-xl glass-input px-4 py-2.5 text-sm text-foreground placeholder:text-muted/50 focus:border-gold focus:outline-none"
                placeholder={t("أي ملاحظات للمعلم…", "Any notes for the teacher…")}
              />
            )}
          </div>

          {/* Next: show confirmation */}
          <button
            type="button"
            onClick={() => setShowConfirm(true)}
            disabled={!isComplete}
            className="focus-ring flex w-full items-center justify-center gap-2 rounded-xl glass-gold py-4 text-lg font-bold text-white transition-colors disabled:opacity-40"
          >
            التالي — مراجعة الحجز
          </button>
        </div>
      )}
    </>
  );
}
