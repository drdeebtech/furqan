// Canonical āyah counts per sūrah — Ḥafṣ ʿan ʿĀṣim, Madanī muṣḥaf numbering.
// surah_num (1..114) → number of āyāt. Index 0 is a placeholder (sūrah numbering
// is 1-based). This is fixed canonical data; it never changes.
//
// This is the application-layer mirror of the `quran_surahs.ayah_count` reference
// table (migration: create_quran_surahs_reference). A unit test asserts the two
// agree (ayah-counts.test.ts). The DB trigger is the hard guard; this mirror is
// for fast action-layer validation and UI āyah bounds, so we don't round-trip
// to Postgres on every keystroke.
//
// Total across all 114 sūrahs = 6236 āyāt (asserted below at module load).

const COUNTS: readonly number[] = [
  0, // [0] unused — sūrah numbering is 1-based
  7, 286, 200, 176, 120, 165, 206, 75, 129, 109, //  1–10
  123, 111, 43, 52, 99, 128, 111, 110, 98, 135, // 11–20
  112, 78, 118, 64, 77, 227, 93, 88, 69, 60, // 21–30
  34, 30, 73, 54, 45, 83, 182, 88, 75, 85, // 31–40
  54, 53, 89, 59, 37, 35, 38, 29, 18, 45, // 41–50
  60, 49, 62, 55, 78, 96, 29, 22, 24, 13, // 51–60
  14, 11, 11, 18, 12, 12, 30, 52, 52, 44, // 61–70
  28, 28, 20, 56, 40, 31, 50, 40, 46, 42, // 71–80
  29, 19, 36, 25, 22, 17, 19, 26, 30, 20, // 81–90
  15, 21, 11, 8, 8, 19, 5, 8, 8, 11, // 91–100
  11, 8, 3, 9, 5, 4, 7, 3, 6, 3, // 101–110
  5, 4, 5, 6, // 111–114
];

// Self-check (lens-2 safety): a typo in the table above would change the total
// away from the canonical 6236 and throw at module load, failing the build/tests.
const TOTAL_AYAT = 6236;
const sum = COUNTS.reduce((a, b) => a + b, 0);
if (COUNTS.length !== 115 || sum !== TOTAL_AYAT) {
  throw new Error(
    `ayah-counts integrity check failed: expected 114 sūrahs totalling ${TOTAL_AYAT}, got ${COUNTS.length - 1} sūrahs totalling ${sum}`,
  );
}

/** Number of āyāt in a sūrah (Ḥafṣ). Returns null for an invalid sūrah number. */
export function ayahCount(surahNum: number): number | null {
  if (!Number.isInteger(surahNum) || surahNum < 1 || surahNum > 114) return null;
  return COUNTS[surahNum];
}

/** surah_num → ayah_count map, for parity tests and bulk checks. */
export const AYAH_COUNTS: Readonly<Record<number, number>> = Object.freeze(
  Object.fromEntries(COUNTS.map((c, i) => [i, c]).filter(([i]) => (i as number) >= 1)),
);
