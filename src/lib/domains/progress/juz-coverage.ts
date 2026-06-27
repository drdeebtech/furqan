import { AYAH_COUNTS, ayahCount } from "@/lib/quran/ayah-counts";
import { allJuzBoundaries } from "@/lib/quran/juz-boundaries";

export interface MemorizedRange {
  surahFrom: number;
  ayahFrom: number;
  surahTo: number;
  ayahTo: number;
}

interface OrdinalRange {
  start: number;
  end: number;
}

export function completedJuz(ranges: MemorizedRange[]): number[] {
  const mergedRanges = mergeRanges(ranges.map(toOrdinalRange));

  return allJuzBoundaries()
    .filter((boundary) => {
      const juzRange = toOrdinalRange({
        surahFrom: boundary.startSurah,
        ayahFrom: boundary.startAyah,
        surahTo: boundary.endSurah,
        ayahTo: boundary.endAyah,
      });
      return mergedRanges.some(
        (range) => range.start <= juzRange.start && range.end >= juzRange.end,
      );
    })
    .map((boundary) => boundary.juz);
}

function toOrdinalRange(range: MemorizedRange): OrdinalRange {
  const start = ayahOrdinal(range.surahFrom, range.ayahFrom);
  const end = ayahOrdinal(range.surahTo, range.ayahTo);
  if (start > end) {
    throw new RangeError(
      `Quran range start must not follow end: ${range.surahFrom}:${range.ayahFrom}–${range.surahTo}:${range.ayahTo}`,
    );
  }
  return { start, end };
}

function ayahOrdinal(surah: number, ayah: number): number {
  const surahAyahCount = ayahCount(surah);
  if (surahAyahCount === null) {
    throw new RangeError(`surah number must be 1–114, got ${surah}`);
  }
  if (!Number.isInteger(ayah) || ayah < 1 || ayah > surahAyahCount) {
    throw new RangeError(`ayah number must be 1–${surahAyahCount} for surah ${surah}, got ${ayah}`);
  }

  let ordinal = ayah;
  for (let previousSurah = 1; previousSurah < surah; previousSurah += 1) {
    ordinal += AYAH_COUNTS[previousSurah];
  }
  return ordinal;
}

function mergeRanges(ranges: OrdinalRange[]): OrdinalRange[] {
  const sortedRanges = ranges.toSorted((left, right) => left.start - right.start);
  const mergedRanges: OrdinalRange[] = [];

  for (const range of sortedRanges) {
    const previous = mergedRanges.at(-1);
    if (!previous || range.start > previous.end + 1) {
      mergedRanges.push({ ...range });
    } else {
      previous.end = Math.max(previous.end, range.end);
    }
  }
  return mergedRanges;
}
