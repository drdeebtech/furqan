import { describe, it, expect } from "vitest";
import { isInQuietHours } from "./dispatcher-quiet-hours";

describe("isInQuietHours", () => {
  describe("null/empty bounds", () => {
    it("returns false when start is null", () => {
      expect(isInQuietHours("12:00", null, "17:00")).toBe(false);
    });

    it("returns false when end is null", () => {
      expect(isInQuietHours("12:00", "09:00", null)).toBe(false);
    });

    it("returns false when both are undefined", () => {
      expect(isInQuietHours("12:00", undefined, undefined)).toBe(false);
    });

    it("returns false when end is empty string", () => {
      expect(isInQuietHours("12:00", "09:00", "")).toBe(false);
    });
  });

  describe("same-day window (start <= end)", () => {
    it("returns true when current time is inside", () => {
      expect(isInQuietHours("12:00", "09:00", "17:00")).toBe(true);
    });

    it("returns true at the exact start boundary (inclusive)", () => {
      expect(isInQuietHours("09:00", "09:00", "17:00")).toBe(true);
    });

    it("returns true at the exact end boundary (inclusive)", () => {
      expect(isInQuietHours("17:00", "09:00", "17:00")).toBe(true);
    });

    it("returns false just before start", () => {
      expect(isInQuietHours("08:59", "09:00", "17:00")).toBe(false);
    });

    it("returns false just after end", () => {
      expect(isInQuietHours("17:01", "09:00", "17:00")).toBe(false);
    });
  });

  describe("overnight window (start > end)", () => {
    it("returns true late evening (after start)", () => {
      expect(isInQuietHours("23:30", "22:00", "06:00")).toBe(true);
    });

    it("returns true early morning (before end)", () => {
      expect(isInQuietHours("05:30", "22:00", "06:00")).toBe(true);
    });

    it("returns true at exact start", () => {
      expect(isInQuietHours("22:00", "22:00", "06:00")).toBe(true);
    });

    it("returns true at exact end", () => {
      expect(isInQuietHours("06:00", "22:00", "06:00")).toBe(true);
    });

    it("returns false in the middle of the day", () => {
      expect(isInQuietHours("12:00", "22:00", "06:00")).toBe(false);
    });

    it("returns false just after end", () => {
      expect(isInQuietHours("06:01", "22:00", "06:00")).toBe(false);
    });

    it("returns false just before start", () => {
      expect(isInQuietHours("21:59", "22:00", "06:00")).toBe(false);
    });
  });

  describe("PostgreSQL TIME string format (HH:MM:SS)", () => {
    it("truncates inputs to HH:MM for same-day window", () => {
      expect(isInQuietHours("12:00:45", "09:00:00", "17:00:00")).toBe(true);
    });

    it("truncates inputs to HH:MM for overnight window", () => {
      expect(isInQuietHours("23:30:00", "22:00:00", "06:00:00")).toBe(true);
    });
  });
});
