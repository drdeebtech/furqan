import { describe, it, expect } from "vitest";
import {
  findSlotContaining,
  fitsAnySlot,
  isBlockedByException,
  computeAmountUsd,
  isMoreThanWindowInPast,
  timeToHHMM,
  dateToYYYYMMDD,
  type AvailabilitySlot,
  type AvailabilityException,
} from "./validation";

const slot = (
  start: string,
  end: string,
  duration = 30,
): AvailabilitySlot => ({
  start_time: start,
  end_time: end,
  slot_duration: duration,
});

const ex = (
  is_blocked: boolean,
  start_time: string | null = null,
  end_time: string | null = null,
): AvailabilityException => ({ is_blocked, start_time, end_time });

describe("findSlotContaining", () => {
  it("returns undefined when slot list is empty", () => {
    expect(findSlotContaining("09:00", [])).toBeUndefined();
  });

  it("matches a slot whose half-open range contains the time", () => {
    const slots = [slot("09:00:00", "11:00:00")];
    expect(findSlotContaining("10:00", slots)).toEqual(slots[0]);
  });

  it("includes the start boundary (inclusive)", () => {
    const slots = [slot("09:00:00", "11:00:00")];
    expect(findSlotContaining("09:00", slots)).toEqual(slots[0]);
  });

  it("excludes the end boundary (exclusive)", () => {
    const slots = [slot("09:00:00", "11:00:00")];
    expect(findSlotContaining("11:00", slots)).toBeUndefined();
  });

  it("compares against the HH:MM prefix even when DB returns HH:MM:SS", () => {
    const slots = [slot("09:00:00", "11:00:00")];
    expect(findSlotContaining("10:30", slots)).toEqual(slots[0]);
  });

  it("returns the first matching slot when multiple slots overlap the time", () => {
    const slots = [
      slot("08:00:00", "10:00:00"),
      slot("09:30:00", "11:00:00"),
    ];
    expect(findSlotContaining("09:45", slots)).toEqual(slots[0]);
  });

  it("returns undefined when no slot contains the time", () => {
    const slots = [
      slot("09:00:00", "10:00:00"),
      slot("13:00:00", "14:00:00"),
    ];
    expect(findSlotContaining("12:00", slots)).toBeUndefined();
  });
});

describe("fitsAnySlot", () => {
  it("is false when no slots exist", () => {
    expect(fitsAnySlot("09:00", [])).toBe(false);
  });

  it("is true when a slot covers the time", () => {
    expect(fitsAnySlot("09:30", [slot("09:00:00", "10:00:00")])).toBe(true);
  });

  it("is false when no slot covers the time", () => {
    expect(fitsAnySlot("12:00", [slot("09:00:00", "10:00:00")])).toBe(false);
  });
});

describe("isBlockedByException", () => {
  it("is false when there are no exceptions", () => {
    expect(isBlockedByException("09:00", [])).toBe(false);
  });

  it("blocks the entire day when is_blocked=true and both times are null", () => {
    expect(isBlockedByException("09:00", [ex(true, null, null)])).toBe(true);
    expect(isBlockedByException("23:59", [ex(true, null, null)])).toBe(true);
  });

  it("does not block when is_blocked=false even if a time range is set", () => {
    expect(
      isBlockedByException("09:30", [ex(false, "09:00:00", "10:00:00")]),
    ).toBe(false);
  });

  it("blocks within a half-open time range when is_blocked=true", () => {
    const exceptions = [ex(true, "09:00:00", "10:00:00")];
    expect(isBlockedByException("09:30", exceptions)).toBe(true);
  });

  it("includes the start boundary of a blocking range (inclusive)", () => {
    const exceptions = [ex(true, "09:00:00", "10:00:00")];
    expect(isBlockedByException("09:00", exceptions)).toBe(true);
  });

  it("excludes the end boundary of a blocking range (exclusive)", () => {
    const exceptions = [ex(true, "09:00:00", "10:00:00")];
    expect(isBlockedByException("10:00", exceptions)).toBe(false);
  });

  it("treats is_blocked=true with only start_time set as non-blocking (defensive)", () => {
    expect(
      isBlockedByException("09:30", [ex(true, "09:00:00", null)]),
    ).toBe(false);
  });

  it("treats is_blocked=true with only end_time set as non-blocking (defensive)", () => {
    expect(
      isBlockedByException("09:30", [ex(true, null, "10:00:00")]),
    ).toBe(false);
  });

  it("blocks if any exception in the list matches", () => {
    const exceptions = [
      ex(false, "08:00:00", "09:00:00"),
      ex(true, "10:00:00", "11:00:00"),
    ];
    expect(isBlockedByException("10:30", exceptions)).toBe(true);
  });
});

describe("computeAmountUsd", () => {
  it("computes a full hour at the rate", () => {
    expect(computeAmountUsd(25, 60)).toBe(25);
  });

  it("computes a half hour at half the rate", () => {
    expect(computeAmountUsd(25, 30)).toBe(12.5);
  });

  it("rounds to two decimals (numeric(10,2))", () => {
    // 50 * 35/60 = 29.1666… → toFixed(2) = "29.17"
    expect(computeAmountUsd(50, 35)).toBe(29.17);
  });

  it("handles zero duration", () => {
    expect(computeAmountUsd(40, 0)).toBe(0);
  });

  it("handles a 90-minute booking", () => {
    expect(computeAmountUsd(20, 90)).toBe(30);
  });

  it("returns a number, not a string", () => {
    expect(typeof computeAmountUsd(25, 30)).toBe("number");
  });
});

describe("isMoreThanWindowInPast", () => {
  const now = new Date("2026-05-07T12:00:00.000Z");
  const THIRTY_MIN = 30 * 60 * 1000;

  it("is true when scheduledAt is well before the window", () => {
    const scheduled = new Date(now.getTime() - 60 * 60 * 1000);
    expect(isMoreThanWindowInPast(scheduled, THIRTY_MIN, now)).toBe(true);
  });

  it("is false when scheduledAt is in the future", () => {
    const scheduled = new Date(now.getTime() + 60 * 60 * 1000);
    expect(isMoreThanWindowInPast(scheduled, THIRTY_MIN, now)).toBe(false);
  });

  it("is false when scheduledAt is exactly at the window boundary (strict <)", () => {
    const scheduled = new Date(now.getTime() - THIRTY_MIN);
    expect(isMoreThanWindowInPast(scheduled, THIRTY_MIN, now)).toBe(false);
  });

  it("is true one millisecond past the boundary", () => {
    const scheduled = new Date(now.getTime() - THIRTY_MIN - 1);
    expect(isMoreThanWindowInPast(scheduled, THIRTY_MIN, now)).toBe(true);
  });

  it("is false when scheduledAt equals now", () => {
    expect(isMoreThanWindowInPast(now, THIRTY_MIN, now)).toBe(false);
  });
});

describe("timeToHHMM", () => {
  it("returns a five-character HH:MM string", () => {
    const d = new Date("2026-05-07T09:30:00");
    const result = timeToHHMM(d);
    expect(result).toHaveLength(5);
    expect(result).toMatch(/^\d{2}:\d{2}$/);
  });
});

describe("dateToYYYYMMDD", () => {
  it("returns the UTC date prefix", () => {
    const d = new Date("2026-05-07T15:30:00.000Z");
    expect(dateToYYYYMMDD(d)).toBe("2026-05-07");
  });

  it("uses UTC, not local — late-evening UTC dates do not roll back", () => {
    const d = new Date("2026-05-07T23:59:59.000Z");
    expect(dateToYYYYMMDD(d)).toBe("2026-05-07");
  });

  it("rolls forward at the UTC day boundary", () => {
    const d = new Date("2026-05-08T00:00:00.000Z");
    expect(dateToYYYYMMDD(d)).toBe("2026-05-08");
  });
});
