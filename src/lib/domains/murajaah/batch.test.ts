import { describe, it, expect } from "vitest";
import { toMurajaahDueItems } from "./batch";

describe("toMurajaahDueItems", () => {
  it("maps a schedule row to its memorised range", () => {
    const items = toMurajaahDueItems([
      { id: "s1", student_progress: { surah_from: 2, ayah_from: 1, surah_to: 2, ayah_to: 5 } },
    ]);
    expect(items).toEqual([
      { scheduleId: "s1", surahFrom: 2, ayahFrom: 1, surahTo: 2, ayahTo: 5 },
    ]);
  });

  it("keeps the scheduleId and falls back to null ranges when the progress join is missing", () => {
    // A schedule row whose student_progress was deleted must not crash — the
    // card renders the generic 'القرآن' instead.
    const items = toMurajaahDueItems([{ id: "s2", student_progress: null }]);
    expect(items).toEqual([
      { scheduleId: "s2", surahFrom: null, ayahFrom: null, surahTo: null, ayahTo: null },
    ]);
  });

  it("returns an empty list for no rows (null, undefined, or empty)", () => {
    expect(toMurajaahDueItems(null)).toEqual([]);
    expect(toMurajaahDueItems(undefined)).toEqual([]);
    expect(toMurajaahDueItems([])).toEqual([]);
  });
});
