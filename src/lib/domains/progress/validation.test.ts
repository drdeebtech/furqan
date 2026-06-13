import { describe, it, expect } from "vitest";
import { validateRange, violationMessageAr, validateHomeworkRange } from "./validation";
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

  it("rejects a non-integer āyah (1.5)", () => {
    expect(validateRange({ surahFrom: 2, ayahFrom: 1.5, surahTo: 2, ayahTo: 5 })?.kind).toBe("ayah_below_one");
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

describe("validateHomeworkRange (regression: HIGH-1 surah/ayah guard for homework)", () => {
  it("accepts a valid same-surah range (Al-Fatiha 1-7)", () => {
    expect(validateHomeworkRange(1, 1, 7)).toBeNull();
  });

  it("returns null when there is no range (all-null) or no surah", () => {
    expect(validateHomeworkRange(null, null, null)).toBeNull();
    expect(validateHomeworkRange(null, 1, 7)).toBeNull();
  });

  it("rejects a partial range — surah set but one āyah bound missing (T4)", () => {
    expect(validateHomeworkRange(1, null, 5)).not.toBeNull();
    expect(validateHomeworkRange(1, 1, null)).not.toBeNull();
    expect(validateHomeworkRange(2, null, 5)).not.toBeNull();
    expect(validateHomeworkRange(114, 1, null)).not.toBeNull();
  });

  it("rejects ayah_end exceeding surah count (Al-Fatiha has 7 ayat)", () => {
    const msg = validateHomeworkRange(1, 1, 300);
    expect(msg).not.toBeNull();
    expect(msg).toContain("7");
  });

  it("rejects ayah_start exceeding surah count", () => {
    const msg = validateHomeworkRange(2, 999, 999);
    expect(msg).not.toBeNull();
    expect(msg).toContain("286");
  });

  it("rejects reversed ayah order within same surah", () => {
    const msg = validateHomeworkRange(2, 10, 5);
    expect(msg).not.toBeNull();
    expect(msg).toContain("آية النهاية");
  });

  it("rejects an invalid surah number (0)", () => {
    expect(validateHomeworkRange(0, 1, 1)).not.toBeNull();
  });

  it("rejects an invalid surah number (115)", () => {
    expect(validateHomeworkRange(115, 1, 1)).not.toBeNull();
  });

  it("rejects ayah below 1", () => {
    expect(validateHomeworkRange(2, 0, 5)).not.toBeNull();
    expect(validateHomeworkRange(2, 1, 0)).not.toBeNull();
  });

  it("accepts An-Nas 1-6 (surah 114, 6 ayat)", () => {
    expect(validateHomeworkRange(114, 1, 6)).toBeNull();
  });
});
