"use client";

import { useActionState } from "react";
import { Plus } from "lucide-react";
import { addSlot, type AvailabilityResult } from "./actions";

const DAYS = [
  { value: 0, label: "الأحد", en: "Sun" },
  { value: 1, label: "الإثنين", en: "Mon" },
  { value: 2, label: "الثلاثاء", en: "Tue" },
  { value: 3, label: "الأربعاء", en: "Wed" },
  { value: 4, label: "الخميس", en: "Thu" },
  { value: 5, label: "الجمعة", en: "Fri" },
  { value: 6, label: "السبت", en: "Sat" },
];

const DURATIONS = [
  { value: 30, label: "٣٠ دقيقة" },
  { value: 45, label: "٤٥ دقيقة" },
  { value: 60, label: "٦٠ دقيقة" },
];

/**
 * Render the form for creating a new availability slot.
 *
 * The form includes inputs for day, start time, end time, and slot duration, displays a server-side error banner when present, and reflects submission state by disabling the submit button and showing a spinner while pending.
 *
 * @returns A JSX element containing the slot creation form.
 */
export function SlotForm() {
  const [state, formAction, pending] = useActionState<
    AvailabilityResult,
    FormData
  >(addSlot, {});

  return (
    <div className="rounded-2xl border border-card-border bg-card elevation-2 p-5">
      <h2 className="mb-4 text-lg font-semibold">
        إضافة موعد جديد
        <span className="mr-2 text-sm font-normal text-muted">Add slot</span>
      </h2>

      {state.error && (
        <div className="mb-4 rounded-lg border border-error/30 bg-error/10 p-3 text-sm text-error">
          {state.error}
        </div>
      )}

      <form action={formAction} className="space-y-4">
        {/* Day */}
        <div>
          <label
            htmlFor="day_of_week"
            className="mb-1 block text-sm font-medium"
          >
            اليوم
            <span className="mr-2 text-xs text-muted">Day</span>
          </label>
          <select
            id="day_of_week"
            name="day_of_week"
            required
            className="w-full rounded-xl border border-input-border bg-input neu-inset px-4 py-2.5 text-foreground focus:border-input-focus focus:outline-none focus:ring-1 focus:ring-input-focus"
          >
            {DAYS.map((d) => (
              <option key={d.value} value={d.value}>
                {d.label} ({d.en})
              </option>
            ))}
          </select>
        </div>

        {/* Time range */}
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label
              htmlFor="start_time"
              className="mb-1 block text-sm font-medium"
            >
              من
              <span className="mr-2 text-xs text-muted">From</span>
            </label>
            <input
              id="start_time"
              name="start_time"
              type="time"
              required
              dir="ltr"
              className="w-full rounded-xl border border-input-border bg-input neu-inset px-4 py-2.5 text-left text-foreground focus:border-input-focus focus:outline-none focus:ring-1 focus:ring-input-focus"
            />
          </div>
          <div>
            <label
              htmlFor="end_time"
              className="mb-1 block text-sm font-medium"
            >
              إلى
              <span className="mr-2 text-xs text-muted">To</span>
            </label>
            <input
              id="end_time"
              name="end_time"
              type="time"
              required
              dir="ltr"
              className="w-full rounded-xl border border-input-border bg-input neu-inset px-4 py-2.5 text-left text-foreground focus:border-input-focus focus:outline-none focus:ring-1 focus:ring-input-focus"
            />
          </div>
        </div>

        {/* Slot duration */}
        <div>
          <label
            htmlFor="slot_duration"
            className="mb-1 block text-sm font-medium"
          >
            مدة الحصة
            <span className="mr-2 text-xs text-muted">Slot duration</span>
          </label>
          <select
            id="slot_duration"
            name="slot_duration"
            required
            className="w-full rounded-xl border border-input-border bg-input neu-inset px-4 py-2.5 text-foreground focus:border-input-focus focus:outline-none focus:ring-1 focus:ring-input-focus"
          >
            {DURATIONS.map((d) => (
              <option key={d.value} value={d.value}>
                {d.label}
              </option>
            ))}
          </select>
        </div>

        <button
          type="submit"
          disabled={pending}
          className="flex w-full items-center justify-center gap-2 rounded-full bg-primary py-2.5 font-semibold text-white neu-btn transition-colors hover:bg-primary-hover disabled:opacity-50"
        >
          {pending ? (
            <span className="h-5 w-5 animate-spin rounded-full border-2 border-white/30 border-t-white" />
          ) : (
            <>
              <Plus size={18} />
              إضافة
            </>
          )}
        </button>
      </form>
    </div>
  );
}
