/**
 * Eval: SM-2 review outcome correctness
 *
 * Golden cases derived from the SM-2 spec. If any of these fail it indicates
 * a fundamental regression in the spaced-repetition algorithm.
 */

import { describe, it, expect } from "vitest";
import { reviewOutcome } from "@/lib/domains/murajaah/sm2";

const seed = { intervalDays: 1, easiness: 2.5 };

describe("SM-2 review outcome — golden cases", () => {
  it("first review (I=1) with quality 5 → interval 6, EF increases", () => {
    const result = reviewOutcome(seed, 5);
    expect(result.intervalDays).toBe(6);
    expect(result.easiness).toBeGreaterThan(2.5);
  });

  it("second review (I=6) with quality 5 → interval ~16", () => {
    const after1 = reviewOutcome(seed, 5);
    const result = reviewOutcome(after1, 5);
    expect(result.intervalDays).toBeGreaterThanOrEqual(15);
    expect(result.intervalDays).toBeLessThanOrEqual(17);
  });

  it("third review (I=~16) with quality 5 → interval ~45", () => {
    const s1 = reviewOutcome(seed, 5);
    const s2 = reviewOutcome(s1, 5);
    const s3 = reviewOutcome(s2, 5);
    expect(s3.intervalDays).toBeGreaterThanOrEqual(40);
    expect(s3.intervalDays).toBeLessThanOrEqual(50);
  });

  it("lapse (quality < 3) resets interval to 1 and decreases EF", () => {
    const established = { intervalDays: 16, easiness: 2.6 };
    const result = reviewOutcome(established, 2);
    expect(result.intervalDays).toBe(1);
    expect(result.easiness).toBeLessThan(established.easiness);
  });

  it("EF clamps to minimum 1.3 after repeated poor reviews", () => {
    let state = { intervalDays: 1, easiness: 1.4 };
    for (let i = 0; i < 5; i++) state = reviewOutcome(state, 0);
    expect(state.easiness).toBeGreaterThanOrEqual(1.3);
  });

  it("throws RangeError for quality outside 0–5", () => {
    expect(() => reviewOutcome(seed, 6 as never)).toThrow(RangeError);
    expect(() => reviewOutcome(seed, -1 as never)).toThrow(RangeError);
  });
});
