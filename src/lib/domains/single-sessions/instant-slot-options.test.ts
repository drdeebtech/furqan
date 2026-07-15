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

  it("exposes student-local wall-clock fields consistent with the iso instant (PR #701 tz contract)", () => {
    const options = generateInstantSlotOptions(
      [{ day_of_week: DOW, start_time: "09:00:00", end_time: "11:00:00" }],
      { now: NOW, horizonDays: 1, slotMinutes: 30 },
    );
    expect(options.length).toBeGreaterThan(0);
    for (const o of options) {
      const d = new Date(o.iso); // same runtime tz as the generating client
      expect(o.dayOfWeek).toBe(d.getDay());
      expect(o.localDate).toBe(
        `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`,
      );
      expect(o.localTime).toBe(
        `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`,
      );
      // Wall-clock sits inside the window it was generated from.
      expect(o.localTime >= "09:00" && o.localTime < "11:00").toBe(true);
    }
  });

  it("pins wall-clock to the availability window (known-good values, no accessor round-trip)", () => {
    // The generator builds wall-clock FROM the window, so these exact values
    // are the ground truth — unlike decoding o.iso back through the same Date
    // accessors the source uses. Afternoon window keeps the test valid across
    // runner timezones (CI=UTC, dev machines within a few hours of it).
    const options = generateInstantSlotOptions(
      [{ day_of_week: DOW, start_time: "15:00:00", end_time: "17:00:00" }],
      { now: NOW, horizonDays: 0, slotMinutes: 30 },
    );
    expect(options.map((o) => o.localTime)).toEqual(["15:00", "15:30", "16:00", "16:30"]);
    expect(new Set(options.map((o) => o.dayOfWeek))).toEqual(new Set([DOW]));
  });

  it("localizes weekday labels when lang='en' (bilingual UI)", () => {
    const options = generateInstantSlotOptions(
      [{ day_of_week: DOW, start_time: "15:00:00", end_time: "16:00:00" }],
      { now: NOW, horizonDays: 0, slotMinutes: 30, lang: "en" },
    );
    const EN_WEEKDAYS = [
      "Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday",
    ];
    expect(options[0]?.label).toBe(`${EN_WEEKDAYS[DOW]} 15:00`);
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
