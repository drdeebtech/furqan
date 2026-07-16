export interface InstantSlotOption {
  /** Absolute instant (UTC ISO) — what gets stored/charged against. */
  iso: string;
  label: string;
  /**
   * Student-local wall-clock of the same slot. The server validates
   * availability with THESE (teacher_availability stores app-local wall-clock
   * strings), never by re-deriving wall-clock from `iso` in its own timezone
   * — mirrors the subscription booking-form contract.
   */
  dayOfWeek: number;
  localDate: string;
  localTime: string;
}

const WEEKDAYS: Record<"ar" | "en", Record<number, string>> = {
  ar: {
    0: "الأحد",
    1: "الإثنين",
    2: "الثلاثاء",
    3: "الأربعاء",
    4: "الخميس",
    5: "الجمعة",
    6: "السبت",
  },
  en: {
    0: "Sunday",
    1: "Monday",
    2: "Tuesday",
    3: "Wednesday",
    4: "Thursday",
    5: "Friday",
    6: "Saturday",
  },
};

function parseTime(time: string): number {
  const [hours = "0", minutes = "0"] = time.slice(0, 5).split(":");
  return Number(hours) * 60 + Number(minutes);
}

export function generateInstantSlotOptions(
  availability: readonly {
    day_of_week: number;
    start_time: string;
    end_time: string;
  }[],
  opts: {
    now: Date;
    /** Weekday-label language; defaults to Arabic (the platform default). */
    lang?: "ar" | "en";
    horizonDays?: number;
    slotMinutes?: number;
    max?: number;
  },
): InstantSlotOption[] {
  const horizonDays = opts.horizonDays ?? 14;
  const slotMinutes = opts.slotMinutes ?? 30;
  const max = opts.max ?? 20;
  const weekdays = WEEKDAYS[opts.lang ?? "ar"];
  const options: InstantSlotOption[] = [];

  for (let offset = 0; offset <= horizonDays; offset += 1) {
    const day = new Date(
      opts.now.getFullYear(),
      opts.now.getMonth(),
      opts.now.getDate() + offset,
    );

    for (const window of availability) {
      if (window.day_of_week !== day.getDay()) continue;

      const startMinutes = parseTime(window.start_time);
      const endMinutes = parseTime(window.end_time);

      for (let minutes = startMinutes; minutes < endMinutes; minutes += slotMinutes) {
        const hours = Math.floor(minutes / 60);
        const minute = minutes % 60;
        const slot = new Date(
          opts.now.getFullYear(),
          opts.now.getMonth(),
          opts.now.getDate() + offset,
          hours,
          minute,
        );

        if (slot.getTime() <= opts.now.getTime()) continue;

        const timeLabel = `${String(hours).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
        const localDate = `${slot.getFullYear()}-${String(slot.getMonth() + 1).padStart(2, "0")}-${String(slot.getDate()).padStart(2, "0")}`;
        options.push({
          iso: slot.toISOString(),
          label: `${weekdays[day.getDay()]} ${timeLabel}`,
          dayOfWeek: slot.getDay(),
          localDate,
          localTime: timeLabel,
        });
      }
    }
  }

  return options
    .sort((a, b) => new Date(a.iso).getTime() - new Date(b.iso).getTime())
    .slice(0, max);
}
