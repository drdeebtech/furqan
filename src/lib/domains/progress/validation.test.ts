import { describe, it, expect } from "vitest";
import { validateRange, violationMessageAr } from "./validation";
import { ayahCount, AYAH_COUNTS } from "@/lib/quran/ayah-counts";

describe("ayah-counts (canonical Ḥafṣ)", () => {
  it("has the well-known counts and totals 6236", () => {
    expect(ayahCount(1)).toBe(7); // Al-Fātiḥah
    expect(ayahCount(2)).toBe(286); // Al-Baqarah
    expect(ayahCount(9)).toBe(129); // At-Tawbah
    expect(ayahCount(36)).toBe(83); // Yā-Sīn
    expect(ayahCount(114)).toBe(6); // An-Nās
    const total = Object.values(AYAH_COUNTS).reduce((a, b) => a + b, 0);
    expect(total).toBe(6236);
    expect(Object.keys(AYAH_COUNTS)).toHaveLength(114);
  });

  it("rejects out-of-range sūrah numbers", () => {
    expect(ayahCount(0)).toBeNull();
    expect(ayahCount(115)).toBeNull();
    expect(ayahCount(1.5)).toBeNull();
  });
});

describe("validateRange", () => {
  it("accepts a valid same-sūrah range", () => {
    expect(validateRange({ surahFrom: 2, ayahFrom: 1, surahTo: 2, ayahTo: 5 })).toBeNull();
  });

  it("accepts a single āyah", () => {
    expect(validateRange({ surahFrom: 1, ayahFrom: 7, surahTo: 1, ayahTo: 7 })).toBeNull();
  });

  it("accepts a valid cross-sūrah range", () => {
    expect(validateRange({ surahFrom: 78, ayahFrom: 1, surahTo: 79, ayahTo: 5 })).toBeNull();
  });

  it("rejects an āyah beyond the sūrah's count (Al-Fātiḥah 1→300)", () => {
    const v = validateRange({ surahFrom: 1, ayahFrom: 1, surahTo: 1, ayahTo: 300 });
    expect(v).toEqual({ kind: "ayah_exceeds_count", field: "ayahTo", surah: 1, ayahCount: 7 });
  });

  it("rejects An-Nās 1→50 (6 āyāt)", () => {
    const v = validateRange({ surahFrom: 114, ayahFrom: 1, surahTo: 114, ayahTo: 50 });
    expect(v?.kind).toBe("ayah_exceeds_count");
  });

  it("rejects āyah < 1", () => {
    expect(validateRange({ surahFrom: 2, ayahFrom: 0, surahTo: 2, ayahTo: 5 })?.kind).toBe("ayah_below_one");
  });

  it("rejects reversed sūrah order", () => {
    expect(validateRange({ surahFrom: 5, ayahFrom: 1, surahTo: 2, ayahTo: 1 })).toEqual({
      kind: "order",
      detail: "surah",
    });
  });

  it("rejects reversed āyah order within a sūrah", () => {
    expect(validateRange({ surahFrom: 2, ayahFrom: 10, surahTo: 2, ayahTo: 5 })).toEqual({
      kind: "order",
      detail: "ayah",
    });
  });

  it("rejects an invalid sūrah number", () => {
    expect(validateRange({ surahFrom: 200, ayahFrom: 1, surahTo: 200, ayahTo: 1 })?.kind).toBe("surah_invalid");
  });
});

describe("violationMessageAr", () => {
  it("names the sūrah and its count for an over-count āyah", () => {
    const v = validateRange({ surahFrom: 1, ayahFrom: 1, surahTo: 1, ayahTo: 300 })!;
    const msg = violationMessageAr(v, () => "الفاتحة");
    expect(msg).toContain("7");
    expect(msg).toContain("الفاتحة");
  });
});
