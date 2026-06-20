import { ayahCount } from "@/lib/quran/ayah-counts";

/**
 * Spec 022 (م٥) — Quran-structural validation for specialized single-session
 * bookings.
 *
 * Per AGENTS.md §2 (Quran integrity — highest priority) and FR-015: any
 * surah / ayah / juz target on a specialized session MUST be validated
 * against the canonical reference (`src/lib/quran/ayah-counts.ts` and the
 * `student_progress_ayah_range_guard` lineage). Invalid ranges are rejected,
 * NEVER auto-corrected by a model.
 *
 * This module is a pure validator — no DB writes, no Stripe calls — so it
 * runs at the route boundary BEFORE any charge or booking creation
 * (fail-before-charge, R-004).
 */

/** Shape of a specialized session's `target_scope` (mirrors contracts §1). */
export interface TargetScope {
  surah?: number;
  ayahStart?: number;
  ayahEnd?: number;
  juz?: number;
  mutoon?: string;
  mutashabihat?: string;
}

export interface TargetScopeValidation {
  valid: boolean;
  error?: string;
}

/**
 * Validate a specialized-session target scope. Returns `{valid: true}` on
 * success or `{valid: false, error}` with a human-readable reason. The error
 * message is safe to surface to the client as a 422 body.
 *
 * Rules (FR-015 / FR-016):
 *   • surah   — integer 1..114
 *   • juz     — integer 1..30
 *   • ayahStart / ayahEnd — if surah present, both must be ≤ ayahCount(surah)
 *     and ayahStart ≤ ayahEnd
 *   • mutoon / mutashabihat — free-text descriptors; only length-capped to
 *     prevent abuse (no canonical reference exists to validate against)
 *
 * At least ONE field must be present. An empty scope is invalid.
 */
export function validateTargetScope(
  scope: unknown,
): TargetScopeValidation {
  if (typeof scope !== "object" || scope === null || Array.isArray(scope)) {
    return { valid: false, error: "target_scope must be an object" };
  }
  const s = scope as Record<string, unknown>;

  const surahRaw = s.surah;
  const juzRaw = s.juz;
  const ayahStartRaw = s.ayahStart;
  const ayahEndRaw = s.ayahEnd;
  const mutoonRaw = s.mutoon;
  const mutashabihatRaw = s.mutashabihat;

  // At least one field must be set.
  if (
    surahRaw === undefined &&
    juzRaw === undefined &&
    mutoonRaw === undefined &&
    mutashabihatRaw === undefined &&
    ayahStartRaw === undefined &&
    ayahEndRaw === undefined
  ) {
    return {
      valid: false,
      error: "target_scope must contain at least one of: surah, juz, ayahStart, ayahEnd, mutoon, mutashabihat",
    };
  }

  // Type-narrow the numeric fields. Anything non-number (e.g. string) is rejected.
  const surah: number | undefined =
    typeof surahRaw === "number" && Number.isFinite(surahRaw) ? surahRaw : undefined;
  const juz: number | undefined =
    typeof juzRaw === "number" && Number.isFinite(juzRaw) ? juzRaw : undefined;
  const ayahStart: number | undefined =
    typeof ayahStartRaw === "number" && Number.isFinite(ayahStartRaw)
      ? ayahStartRaw
      : undefined;
  const ayahEnd: number | undefined =
    typeof ayahEndRaw === "number" && Number.isFinite(ayahEndRaw)
      ? ayahEndRaw
      : undefined;

  // If a value was provided but failed the typeof guard, reject with the field's raw form.
  if (surahRaw !== undefined && surah === undefined) {
    return { valid: false, error: `Invalid surah: ${String(surahRaw)}. Must be an integer 1–114.` };
  }
  if (juzRaw !== undefined && juz === undefined) {
    return { valid: false, error: `Invalid juz: ${String(juzRaw)}. Must be an integer 1–30.` };
  }

  // surah: integer 1..114.
  if (surah !== undefined) {
    if (!Number.isInteger(surah) || surah < 1 || surah > 114) {
      return {
        valid: false,
        error: `Invalid surah: ${surah}. Valid range is 1–114.`,
      };
    }
  }

  // juz: integer 1..30.
  if (juz !== undefined) {
    if (!Number.isInteger(juz) || juz < 1 || juz > 30) {
      return {
        valid: false,
        error: `Invalid juz: ${juz}. Valid range is 1–30.`,
      };
    }
  }

  // ayahStart/ayhEnd only meaningful with a surah; if provided, validate
  // against the canonical ayah count for that surah.
  if ((ayahStart !== undefined || ayahEnd !== undefined) && surah === undefined) {
    return {
      valid: false,
      error: "ayahStart/ayahEnd require a surah to be specified",
    };
  }
  if (ayahStartRaw !== undefined && ayahStart === undefined) {
    return { valid: false, error: `Invalid ayahStart: ${String(ayahStartRaw)}. Must be an integer.` };
  }
  if (ayahEndRaw !== undefined && ayahEnd === undefined) {
    return { valid: false, error: `Invalid ayahEnd: ${String(ayahEndRaw)}. Must be an integer.` };
  }
  if (surah !== undefined) {
    const count = ayahCount(surah);
    if (count !== null) {
      if (ayahStart !== undefined) {
        if (!Number.isInteger(ayahStart) || ayahStart < 1 || ayahStart > count) {
          return {
            valid: false,
            error: `Invalid ayahStart: ${ayahStart}. Surah ${surah} has ${count} ayat.`,
          };
        }
      }
      if (ayahEnd !== undefined) {
        if (!Number.isInteger(ayahEnd) || ayahEnd < 1 || ayahEnd > count) {
          return {
            valid: false,
            error: `Invalid ayahEnd: ${ayahEnd}. Surah ${surah} has ${count} ayat.`,
          };
        }
      }
      if (
        ayahStart !== undefined &&
        ayahEnd !== undefined &&
        ayahStart > ayahEnd
      ) {
        return {
          valid: false,
          error: `ayahStart (${ayahStart}) must be ≤ ayahEnd (${ayahEnd}).`,
        };
      }
    }
  }

  // mutoon / mutashabihat: free-text descriptors, length-capped.
  const MAX_DESC = 200;
  if (mutoonRaw !== undefined) {
    if (
      typeof mutoonRaw !== "string" ||
      mutoonRaw.length === 0 ||
      mutoonRaw.length > MAX_DESC
    ) {
      return {
        valid: false,
        error: `Invalid mutoon: must be a non-empty string of ≤ ${MAX_DESC} characters.`,
      };
    }
  }
  if (mutashabihatRaw !== undefined) {
    if (
      typeof mutashabihatRaw !== "string" ||
      mutashabihatRaw.length === 0 ||
      mutashabihatRaw.length > MAX_DESC
    ) {
      return {
        valid: false,
        error: `Invalid mutashabihat: must be a non-empty string of ≤ ${MAX_DESC} characters.`,
      };
    }
  }

  return { valid: true };
}
