import { ayahCount } from "@/lib/quran/ayah-counts";

const DAY_MS = 24 * 60 * 60 * 1000;

export interface QuranRange {
  surahStart: number;
  ayahStart: number;
  surahEnd: number;
  ayahEnd: number;
}

export interface CompletionProjection {
  remaining: number;
  weeksLeft: number | null;
  projectedDate: Date | null;
}

type Interval = readonly [start: number, end: number];

function ayahOrdinal(surah: number, ayah: number): number {
  let ordinal = ayah;
  for (let current = 1; current < surah; current += 1) {
    const count = ayahCount(current);
    if (count === null) throw new Error(`Invalid surah: ${current}`);
    ordinal += count;
  }
  return ordinal;
}

export function totalAyahsInRange(range: QuranRange): number {
  return ayahOrdinal(range.surahEnd, range.ayahEnd)
    - ayahOrdinal(range.surahStart, range.ayahStart) + 1;
}

function clippedIntervals(goal: QuranRange, ranges: readonly QuranRange[]): Interval[] {
  const goalStart = ayahOrdinal(goal.surahStart, goal.ayahStart);
  const goalEnd = ayahOrdinal(goal.surahEnd, goal.ayahEnd);
  return ranges
    .map((range) => [
      Math.max(goalStart, ayahOrdinal(range.surahStart, range.ayahStart)),
      Math.min(goalEnd, ayahOrdinal(range.surahEnd, range.ayahEnd)),
    ] as const)
    .filter(([start, end]) => start <= end)
    .sort((a, b) => a[0] - b[0]);
}

function mergedIntervalLength(intervals: readonly Interval[]): number {
  if (intervals.length === 0) return 0;

  let covered = 0;
  let [mergedStart, mergedEnd] = intervals[0];
  for (const [start, end] of intervals.slice(1)) {
    if (start <= mergedEnd + 1) {
      mergedEnd = Math.max(mergedEnd, end);
    } else {
      covered += mergedEnd - mergedStart + 1;
      mergedStart = start;
      mergedEnd = end;
    }
  }
  return covered + mergedEnd - mergedStart + 1;
}

export function countCoveredAyahs(goal: QuranRange, ranges: readonly QuranRange[]): number {
  return mergedIntervalLength(clippedIntervals(goal, ranges));
}

export function projectCompletion(
  ayahsMemorizedInGoal: number,
  totalAyahsInGoal: number,
  ayahsPerWeek: number,
  now: Date = new Date(),
): CompletionProjection {
  const remaining = Math.max(0, totalAyahsInGoal - ayahsMemorizedInGoal);
  if (remaining === 0) {
    return { remaining: 0, weeksLeft: 0, projectedDate: new Date(now) };
  }
  if (ayahsPerWeek <= 0) {
    return { remaining, weeksLeft: null, projectedDate: null };
  }

  const weeksLeft = Math.ceil(remaining / ayahsPerWeek);
  return {
    remaining,
    weeksLeft,
    projectedDate: new Date(now.getTime() + weeksLeft * 7 * DAY_MS),
  };
}
