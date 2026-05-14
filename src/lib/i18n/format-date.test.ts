import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { formatDate } from "./format-date";

describe("formatDate", () => {
  const originalTZ = process.env.TZ;

  beforeAll(() => {
    // Force UTC for deterministic time testing
    process.env.TZ = "UTC";
  });

  afterAll(() => {
    if (originalTZ === undefined) {
      delete process.env.TZ;
    } else {
      process.env.TZ = originalTZ;
    }
  });

  const testDateStr = "2026-03-07T14:30:00Z";
  const testDateObj = new Date(testDateStr);

  it("handles null, undefined, and empty string", () => {
    expect(formatDate(null, "en")).toBe("");
    expect(formatDate(undefined, "ar")).toBe("");
    expect(formatDate("", "en")).toBe("");
  });

  it("handles invalid dates", () => {
    expect(formatDate("not-a-date", "en")).toBe("");
    expect(formatDate(new Date("invalid"), "ar")).toBe("");
  });

  it("formats short style in English", () => {
    expect(formatDate(testDateStr, "en")).toBe("Mar 7, 2026");
    expect(formatDate(testDateStr, "en", "short")).toBe("Mar 7, 2026");
  });

  it("formats long style in English", () => {
    expect(formatDate(testDateStr, "en", "long")).toBe("Saturday, March 7, 2026");
  });

  it("formats time style in English", () => {
    // Note: process.env.TZ might not affect Intl.DateTimeFormat in all Node versions
    // So we test for inclusion of 2:30 which handles formatting variations
    expect(formatDate(testDateStr, "en", "time")).toMatch(/2:30/i);
  });

  it("formats short style in Arabic", () => {
    expect(formatDate(testDateStr, "ar")).toMatch(/٧ مارس ٢٠٢٦/);
  });

  it("formats long style in Arabic", () => {
    expect(formatDate(testDateStr, "ar", "long")).toMatch(/السبت، ٧ مارس ٢٠٢٦/);
  });

  it("formats time style in Arabic", () => {
    expect(formatDate(testDateStr, "ar", "time")).toMatch(/٠٢:٣٠/);
  });

  it("accepts a Date object", () => {
    expect(formatDate(testDateObj, "en", "short")).toBe("Mar 7, 2026");
  });
});
