import { describe, it, expect } from "vitest";

import { REVIEW_QUALITY_OPTIONS } from "@/lib/domains/murajaah/quality-options";
import { reviewOutcome } from "@/lib/domains/murajaah/sm2";

describe("REVIEW_QUALITY_OPTIONS", () => {
  it("exposes exactly three options that map to SM-2 qualities 5, 3, 1 in order", () => {
    expect(REVIEW_QUALITY_OPTIONS).toHaveLength(3);
    expect(REVIEW_QUALITY_OPTIONS.map((o) => o.quality)).toEqual([5, 3, 1]);
  });

  it("uses the correct Arabic labels (حفظت / بجهد / لم أحفظ)", () => {
    expect(REVIEW_QUALITY_OPTIONS.map((o) => o.ar)).toEqual([
      "حفظت",
      "بجهد",
      "لم أحفظ",
    ]);
  });

  it("pairs each Arabic label with its English gloss", () => {
    expect(REVIEW_QUALITY_OPTIONS.map((o) => o.en)).toEqual([
      "I remembered",
      "With effort",
      "I didn't remember",
    ]);
  });
});

describe("SM-2 pedagogy behind the 3 options (seed interval=6, easiness=2.5)", () => {
  // Why this matters: complete_review treats q < 3 as a lapse (interval resets
  // to 1 day) and q >= 3 as a pass (interval grows). The card's three options
  // sit either side of that threshold on purpose.

  const seed = { intervalDays: 6, easiness: 2.5 };

  it("quality 5 (حفظت) grows the interval", () => {
    const next = reviewOutcome(seed, 5);
    expect(next.intervalDays).toBeGreaterThanOrEqual(seed.intervalDays);
  });

  it("quality 3 (بجهد) still grows the interval — just above the lapse threshold", () => {
    const next = reviewOutcome(seed, 3);
    expect(next.intervalDays).toBeGreaterThanOrEqual(seed.intervalDays);
  });

  it("quality 1 (لم أحفظ) resets the interval to 1 day", () => {
    const next = reviewOutcome(seed, 1);
    expect(next.intervalDays).toBe(1);
  });
});
