import { describe, it, expect } from "vitest";
import { arabicCounted } from "./content";

/**
 * Arabic counted-noun agreement. Caught by a design critique: every individual
 * plan card read "4 ساعة / شهر" — literally "4 hour" — because the branch
 * hardcoded the singular, while the group branch two rows above correctly said
 * "4 جلسات". On a Quran-education platform a native speaker sees that instantly.
 *
 * The live plans are all 4/6/8 credits, so only the 3–10 band ships today; the
 * rest is pinned so adding a 1-, 2- or 12-session plan can't reintroduce it.
 */
const HOUR = ["ساعة", "ساعتان", "ساعات"] as const;
const SESSION = ["جلسة", "جلستان", "جلسات"] as const;

const hours = (n: number) => arabicCounted(n, ...HOUR);
const sessions = (n: number) => arabicCounted(n, ...SESSION);

describe("arabicCounted", () => {
  it("uses the plural for 3–10, the band every live plan falls in", () => {
    for (const n of [3, 4, 5, 6, 7, 8, 9, 10]) {
      expect(hours(n)).toBe("ساعات");
      expect(sessions(n)).toBe("جلسات");
    }
  });

  it("never renders the singular for a live plan size", () => {
    // The exact regression: 4/6/8 must not read "4 ساعة".
    for (const n of [4, 6, 8]) {
      expect(hours(n)).not.toBe("ساعة");
      expect(sessions(n)).not.toBe("جلسة");
    }
  });

  it("uses the singular for 1", () => {
    expect(hours(1)).toBe("ساعة");
    expect(sessions(1)).toBe("جلسة");
  });

  it("uses the dual for 2", () => {
    expect(hours(2)).toBe("ساعتان");
    expect(sessions(2)).toBe("جلستان");
  });

  it("returns to the singular from 11 up (tamyīz)", () => {
    for (const n of [11, 12, 20, 100]) {
      expect(hours(n)).toBe("ساعة");
      expect(sessions(n)).toBe("جلسة");
    }
  });
});
