import { describe, it, expect } from "vitest";
import { daysSince, daysUntil, scoreChurn } from "./retention-scoring";

describe("daysSince", () => {
  const now = new Date("2026-04-23T12:00:00Z").getTime();

  it("returns null for null/undefined", () => {
    expect(daysSince(null, now)).toBeNull();
    expect(daysSince(undefined, now)).toBeNull();
  });

  it("returns 0 for today", () => {
    expect(daysSince("2026-04-23T06:00:00Z", now)).toBe(0);
  });

  it("returns 7 for a week ago", () => {
    expect(daysSince("2026-04-16T12:00:00Z", now)).toBe(7);
  });

  it("returns negative for a future date", () => {
    expect(daysSince("2026-04-30T12:00:00Z", now)).toBeLessThan(0);
  });
});

describe("daysUntil", () => {
  const now = new Date("2026-04-23T12:00:00Z").getTime();

  it("returns null for null/undefined", () => {
    expect(daysUntil(null, now)).toBeNull();
  });

  it("returns 7 for a week from now", () => {
    expect(daysUntil("2026-04-30T12:00:00Z", now)).toBe(7);
  });

  it("returns negative for a past date", () => {
    expect(daysUntil("2026-04-16T12:00:00Z", now)).toBeLessThan(0);
  });
});

describe("scoreChurn", () => {
  it("maxes churn for a fully lapsed student", () => {
    const score = scoreChurn({
      daysSinceSession: 30,
      daysSinceBooking: 30,
      packageRemaining: 0,
      daysUntilExpiry: 3,
    });
    expect(score).toBeGreaterThanOrEqual(80);
    expect(score).toBeLessThanOrEqual(100);
  });

  it("zero churn for an engaged student", () => {
    const score = scoreChurn({
      daysSinceSession: 2,
      daysSinceBooking: 2,
      packageRemaining: 12,
      daysUntilExpiry: 30,
    });
    expect(score).toBe(0);
  });

  it("handles null inputs (brand-new student) as high risk", () => {
    const score = scoreChurn({
      daysSinceSession: null,
      daysSinceBooking: null,
      packageRemaining: null,
      daysUntilExpiry: null,
    });
    expect(score).toBe(65); // no session (+40) + no booking (+25)
  });

  it("caps at 100 even if components exceed it", () => {
    const score = scoreChurn({
      daysSinceSession: 100,
      daysSinceBooking: 100,
      packageRemaining: 0,
      daysUntilExpiry: 0,
    });
    expect(score).toBe(100);
  });

  it("middle-tier when only session is stale (8-13 days)", () => {
    const score = scoreChurn({
      daysSinceSession: 10,
      daysSinceBooking: 2,
      packageRemaining: 5,
      daysUntilExpiry: 30,
    });
    expect(score).toBe(20); // +20 for session 7-14
  });
});
