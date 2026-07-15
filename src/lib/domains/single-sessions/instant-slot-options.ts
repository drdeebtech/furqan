export interface InstantSlotOption {
  iso: string;
  label: string;
}

const ARABIC_WEEKDAYS: Record<number, string> = {
  0: "الأحد",
  1: "الإثنين",
  2: "الثلاثاء",
  3: "الأربعاء",
  4: "الخميس",
  5: "الجمعة",
  6: "السبت",
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
    horizonDays?: number;
    slotMinutes?: number;
    max?: number;
  },
): InstantSlotOption[] {
  const horizonDays = opts.horizonDays ?? 14;
  const slotMinutes = opts.slotMinutes ?? 30;
  const max = opts.max ?? 20;
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
        options.push({
          iso: slot.toISOString(),
          label: `${ARABIC_WEEKDAYS[day.getDay()]} ${timeLabel}`,
        });
      }
    }
  }

  return options
    .sort((a, b) => new Date(a.iso).getTime() - new Date(b.iso).getTime())
    .slice(0, max);
}
