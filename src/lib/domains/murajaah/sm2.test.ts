import { describe, it, expect } from "vitest";
import { reviewOutcome } from "./sm2";

describe("reviewOutcome (SM-2 recompute)", () => {
  it("graduates a freshly-memorized item from interval 1 to 6 on a good recall", () => {
    // Regression guard: the shipped SQL froze the interval at 1 forever, so an
    // item fell due every day and never spaced out. A good recall (q=4) on the
    // seed interval MUST graduate to 6.
    const next = reviewOutcome({ intervalDays: 1, easiness: 2.5 }, 4);
    expect(next.intervalDays).toBe(6);
  });

  it("scales an established interval by the new easiness on a perfect recall", () => {
    // q=5 raises easiness 2.6 → 2.7, and the interval scales round(6 × 2.7) = 16.
    const next = reviewOutcome({ intervalDays: 6, easiness: 2.6 }, 5);
    expect(next.easiness).toBeCloseTo(2.7, 5);
    expect(next.intervalDays).toBe(16);
  });

  it("resets the interval to 1 on a lapse (quality < 3), however large it was", () => {
    const next = reviewOutcome({ intervalDays: 16, easiness: 2.7 }, 2);
    expect(next.intervalDays).toBe(1);
  });

  it("clamps easiness to the 1.3 floor (never lets a hard item collapse further)", () => {
    // Raw formula would push 1.3 down to ~0.5 on q=0; SM-2 floors it at 1.3.
    const next = reviewOutcome({ intervalDays: 1, easiness: 1.3 }, 0);
    expect(next.easiness).toBe(1.3);
  });

  it("clamps easiness to the 3.5 ceiling (never lets an easy item run away)", () => {
    const next = reviewOutcome({ intervalDays: 6, easiness: 3.5 }, 5);
    expect(next.easiness).toBe(3.5);
  });

  it("rejects a quality outside the 0–5 integer range", () => {
    expect(() => reviewOutcome({ intervalDays: 1, easiness: 2.5 }, 9)).toThrow(RangeError);
    expect(() => reviewOutcome({ intervalDays: 1, easiness: 2.5 }, -1)).toThrow(RangeError);
    expect(() => reviewOutcome({ intervalDays: 1, easiness: 2.5 }, 2.5)).toThrow(RangeError);
  });
});
