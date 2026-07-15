import { describe, it, expect } from "vitest";
import { generateInstantSlotOptions } from "./instant-slot-options";

// Weekly availability → concrete upcoming bookable slots for the "pay for one
// session" dropdown. Pure function; `now` is injected for deterministic tests.

const NOW = new Date("2026-08-03T08:00:00.000Z");
const DOW = NOW.getDay(); // build availability on now's own weekday

describe("generateInstantSlotOptions", () => {
  it("returns no options when the teacher has no availability", () => {
    expect(generateInstantSlotOptions([], { now: NOW })).toEqual([]);
  });

  it("generates future 30-min slots inside an available window, none in the past, sorted", () => {
    const options = generateInstantSlotOptions(
      [{ day_of_week: DOW, start_time: "09:00:00", end_time: "11:00:00" }],
      { now: NOW, horizonDays: 1, slotMinutes: 30 },
    );
    expect(options.length).toBeGreaterThan(0);
    // Every option is strictly in the future.
    for (const o of options) {
      expect(new Date(o.iso).getTime()).toBeGreaterThan(NOW.getTime());
      expect(typeof o.label).toBe("string");
      expect(o.label.length).toBeGreaterThan(0);
    }
    // Sorted ascending.
    const times = options.map((o) => new Date(o.iso).getTime());
    expect(times).toEqual([...times].sort((a, b) => a - b));
  });

  it("excludes a window entirely in the past (today, earlier than now)", () => {
    const options = generateInstantSlotOptions(
      [{ day_of_week: DOW, start_time: "06:00:00", end_time: "07:30:00" }],
      { now: NOW, horizonDays: 0, slotMinutes: 30 },
    );
    expect(options).toEqual([]);
  });

  it("respects the max cap", () => {
    const options = generateInstantSlotOptions(
      [{ day_of_week: DOW, start_time: "09:00:00", end_time: "23:00:00" }],
      { now: NOW, horizonDays: 7, slotMinutes: 30, max: 5 },
    );
    expect(options.length).toBe(5);
  });
});
