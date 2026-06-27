import { describe, expect, it } from "vitest";
import { countCoveredAyahs, projectCompletion } from "./projection";

const NOW = new Date("2026-06-29T00:00:00.000Z");

describe("projectCompletion", () => {
  it("projects completion from the current weekly pace", () => {
    const projection = projectCompletion(20, 60, 10, NOW);

    expect(projection).toEqual({
      remaining: 40,
      weeksLeft: 4,
      projectedDate: new Date("2026-07-27T00:00:00.000Z"),
    });
  });

  it("returns an unknown date when pace is zero", () => {
    expect(projectCompletion(20, 60, 0, NOW)).toEqual({
      remaining: 40,
      weeksLeft: null,
      projectedDate: null,
    });
  });

  it("returns zero remaining when the goal is already complete", () => {
    expect(projectCompletion(60, 60, 10, NOW).remaining).toBe(0);
  });

  it("counts overlapping progress once and clips it to the goal", () => {
    const covered = countCoveredAyahs(
      { surahStart: 1, ayahStart: 2, surahEnd: 2, ayahEnd: 3 },
      [
        { surahStart: 1, ayahStart: 1, surahEnd: 1, ayahEnd: 5 },
        { surahStart: 1, ayahStart: 4, surahEnd: 2, ayahEnd: 2 },
        { surahStart: 3, ayahStart: 1, surahEnd: 3, ayahEnd: 10 },
      ],
    );

    expect(covered).toBe(8);
  });
});
