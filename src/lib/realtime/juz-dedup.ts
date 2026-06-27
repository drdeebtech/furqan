import type { Json } from "@/types/database";

/**
 * Session-scoped de-duplication for juz-completion celebrations.
 * Ensures a juz modal fires at most once per browser session even if the
 * realtime channel reconnects and re-delivers the same event.
 *
 * Pure utility — no React, no framework deps — so it is unit-testable.
 */

const KEY_PREFIX = "furqan:juz-celebrated:";

/**
 * Safely extract a juz number (1–30) from a notification's `data` field.
 * Returns null if absent, non-numeric, or out of Quran juz range.
 * Always called on server-verified data (poke→fetch), never on socket payload.
 */
export function extractJuzNumber(data: Json | null | undefined): number | null {
  if (data === null || data === undefined || typeof data !== "object" || Array.isArray(data)) {
    return null;
  }
  const juz = (data as Record<string, Json>).juz;
  if (typeof juz !== "number" || !Number.isInteger(juz) || juz < 1 || juz > 30) return null;
  return juz;
}

/** True if this juz has already been celebrated in the current session. */
export function isJuzCelebrated(juz: number): boolean {
  if (typeof sessionStorage === "undefined") return true; // SSR: skip
  return sessionStorage.getItem(`${KEY_PREFIX}${juz}`) !== null;
}

/** Mark a juz as celebrated. Call immediately before showing the modal. */
export function markJuzCelebrated(juz: number): void {
  if (typeof sessionStorage === "undefined") return;
  sessionStorage.setItem(`${KEY_PREFIX}${juz}`, "1");
}
