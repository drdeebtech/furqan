/**
 * Murajaah SM-2 recompute — the spaced-repetition core (spec 001).
 *
 * Given a schedule row's current spacing state and the recall quality of one
 * review, returns the next spacing state. This is the single source of truth
 * for the SM-2 interval/easiness progression: the SQL `complete_review` is a
 * thin atomic persister that calls nothing — it stores what this computes.
 *
 * Why it lives in TS (not SQL): the original logic shipped inside the
 * `complete_review` plpgsql function, which the vitest test runner can't reach
 * (there is no pgTAP / PG harness in CI). It shipped a bug — the interval froze
 * at 1 forever — that no test could have caught. Extracting the algorithm here
 * makes the progression unit-testable; see sm2.test.ts.
 */

export interface ReviewState {
  /** Days until the item is next due. The seed (I(1)) is 1. */
  intervalDays: number;
  /** SM-2 easiness factor, clamped to [1.3, 3.5]. Seeded at 2.5. */
  easiness: number;
}

/**
 * Recompute the spacing state after one review.
 *
 * @param state   the item's current {intervalDays, easiness}
 * @param quality recall quality, an integer in [0, 5]
 * @throws RangeError if quality is not an integer in [0, 5]
 */
export function reviewOutcome(state: ReviewState, quality: number): ReviewState {
  if (!Number.isInteger(quality) || quality < 0 || quality > 5) {
    throw new RangeError(`quality must be an integer in [0, 5], got ${quality}`);
  }

  // SM-2 easiness update: EF + (0.1 - (5-q)·(0.08 + (5-q)·0.02)). q=4 is the
  // fixed point (no change); q=5 nudges up, low q pushes down.
  const q = quality;
  const rawEasiness = state.easiness + (0.1 - (5 - q) * (0.08 + (5 - q) * 0.02));
  const easiness = Math.min(3.5, Math.max(1.3, rawEasiness));

  // Interval progression. A lapse (q < 3) resets to 1 day. Otherwise the seed
  // I(1)=1 graduates to I(2)=6 on the first success; every later success scales
  // by the new easiness, round(I·EF).
  const intervalDays =
    q < 3 ? 1 : state.intervalDays <= 1 ? 6 : Math.round(state.intervalDays * easiness);

  return { intervalDays, easiness };
}
