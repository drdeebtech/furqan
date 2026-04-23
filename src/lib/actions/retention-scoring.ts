/**
 * Pure scoring helpers for retention risk assessment.
 * No runtime dependencies — can be unit-tested.
 */

const DAY_MS = 86_400_000;

export function daysSince(iso: string | null | undefined, now: number = Date.now()): number | null {
  if (!iso) return null;
  return Math.floor((now - new Date(iso).getTime()) / DAY_MS);
}

export function daysUntil(iso: string | null | undefined, now: number = Date.now()): number | null {
  if (!iso) return null;
  return Math.floor((new Date(iso).getTime() - now) / DAY_MS);
}

/**
 * Churn risk score 0-100 (higher = higher risk).
 * Weights:
 *   +40 if no session in 14+ days or never       +20 if 7-13 days
 *   +25 if no booking in 14+ days or never       +10 if 7-13 days
 *   +20 if package_remaining == 0
 *   +15 if package expires in [0, 7] days
 */
export function scoreChurn(input: {
  daysSinceSession: number | null;
  daysSinceBooking: number | null;
  packageRemaining: number | null;
  daysUntilExpiry: number | null;
}): number {
  let score = 0;

  if (input.daysSinceSession == null || input.daysSinceSession >= 14) score += 40;
  else if (input.daysSinceSession >= 7) score += 20;

  if (input.daysSinceBooking == null || input.daysSinceBooking >= 14) score += 25;
  else if (input.daysSinceBooking >= 7) score += 10;

  if (input.packageRemaining === 0) score += 20;

  if (input.daysUntilExpiry != null && input.daysUntilExpiry >= 0 && input.daysUntilExpiry <= 7) {
    score += 15;
  }

  return Math.min(100, score);
}
