import { describe, expect, it } from "vitest";
import { completedJuz } from "./juz-coverage";

describe("completedJuz", () => {
  it.each([
    {
      scenario: "complete juz 30",
      ranges: [{ surahFrom: 78, ayahFrom: 1, surahTo: 114, ayahTo: 6 }],
      expected: [30],
    },
    {
      scenario: "complete juz 1 across surahs",
      ranges: [{ surahFrom: 1, ayahFrom: 1, surahTo: 2, ayahTo: 141 }],
      expected: [1],
    },
    {
      scenario: "juz missing its final ayah",
      ranges: [{ surahFrom: 1, ayahFrom: 1, surahTo: 2, ayahTo: 140 }],
      expected: [],
    },
    {
      scenario: "out-of-order ranges that together complete a juz",
      ranges: [
        { surahFrom: 2, ayahFrom: 101, surahTo: 2, ayahTo: 141 },
        { surahFrom: 1, ayahFrom: 1, surahTo: 2, ayahTo: 100 },
      ],
      expected: [1],
    },
    { scenario: "empty input", ranges: [], expected: [] },
  ])("returns $expected for $scenario", ({ ranges, expected }) => {
    expect(completedJuz(ranges)).toEqual(expected);
  });

  it("rejects an impossible surah number", () => {
    expect(() =>
      completedJuz([{ surahFrom: 0, ayahFrom: 1, surahTo: 1, ayahTo: 1 }]),
    ).toThrow(RangeError);
  });
});
