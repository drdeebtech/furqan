import "server-only";

import { ayahCount } from "@/lib/quran/ayah-counts";

export interface CertificateRange {
  start: string;
  end: string;
}

/**
 * Resolve a cited range for an appreciation_level certificate.
 *
 * milestoneKey formats:
 *   "N"   — single surah N          → { start: "N:1",   end: "N:{lastAyah}" }
 *   "N-M" — surah range N through M → { start: "N:1",   end: "M:{lastAyah}" }
 *
 * Throws on: non-integer, surah outside 1-114, N > M in a range.
 * Never returns an approximation — throws instead of guessing.
 */
export function getLevelBoundaries(milestoneKey: string): CertificateRange {
  const parts = milestoneKey.split("-");

  if (parts.length === 1) {
    const n = parseSurah(milestoneKey, "milestoneKey");
    const last = requireAyahCount(n);
    return { start: `${n}:1`, end: `${n}:${last}` };
  }

  if (parts.length === 2) {
    const n = parseSurah(parts[0], "start surah");
    const m = parseSurah(parts[1], "end surah");
    if (n > m) {
      throw new Error(
        `getLevelBoundaries: reversed range "${milestoneKey}" — start surah ${n} > end surah ${m}`,
      );
    }
    const lastAyah = requireAyahCount(m);
    return { start: `${n}:1`, end: `${m}:${lastAyah}` };
  }

  throw new Error(
    `getLevelBoundaries: unrecognised milestoneKey format "${milestoneKey}"`,
  );
}

function parseSurah(raw: string, label: string): number {
  const n = Number(raw);
  if (!Number.isInteger(n) || isNaN(n)) {
    throw new Error(
      `getLevelBoundaries: ${label} "${raw}" is not an integer`,
    );
  }
  if (n < 1 || n > 114) {
    throw new Error(
      `getLevelBoundaries: ${label} ${n} is outside the valid range 1-114`,
    );
  }
  return n;
}

function requireAyahCount(surahNum: number): number {
  const count = ayahCount(surahNum);
  if (!count) {
    throw new Error(
      `getLevelBoundaries: ayah count for surah ${surahNum} is unavailable`,
    );
  }
  return count;
}
