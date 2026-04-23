/**
 * Pure quiet-hours logic extracted from dispatcher.ts so it can be unit tested
 * without pulling in server-only Supabase code.
 *
 * Handles both same-day windows (e.g. 09:00 → 17:00) and overnight windows
 * that wrap past midnight (e.g. 22:00 → 06:00).
 */

/**
 * Returns true if `currentTimeHHMM` falls within the quiet-hours window
 * defined by `start` and `end` (both "HH:MM" or longer strings — only the
 * first 5 chars are used).
 *
 * Returns false if either bound is null/undefined/empty (no window configured).
 * The window is inclusive on both ends.
 */
export function isInQuietHours(
  currentTimeHHMM: string,
  start: string | null | undefined,
  end: string | null | undefined,
): boolean {
  if (!start || !end) return false;
  const s = start.slice(0, 5);
  const e = end.slice(0, 5);
  const now = currentTimeHHMM.slice(0, 5);

  if (s <= e) {
    // Same-day window
    return now >= s && now <= e;
  }
  // Overnight window (e.g., 22:00 → 06:00)
  return now >= s || now <= e;
}
