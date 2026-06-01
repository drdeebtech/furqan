import { ayahCount } from "@/lib/quran/ayah-counts";

/**
 * Pure ḥifẓ-range validation (Progress domain). Table-free — uses the canonical
 * āyah-count mirror — so it is unit-tested directly (the interface is the test
 * surface) and runs at the action layer before any DB write (FR-004). The
 * `validate_student_progress_range` DB trigger is the hard backstop (FR-002).
 */

export interface AyahRange {
  surahFrom: number;
  ayahFrom: number;
  surahTo: number;
  ayahTo: number;
}

export type RangeViolation =
  | { kind: "surah_invalid"; surah: number }
  | { kind: "ayah_below_one"; field: "ayahFrom" | "ayahTo" }
  | { kind: "ayah_exceeds_count"; field: "ayahFrom" | "ayahTo"; surah: number; ayahCount: number }
  | { kind: "order"; detail: "surah" | "ayah" };

/** Returns the first violation, or null when the range is canonically valid. */
export function validateRange(r: AyahRange): RangeViolation | null {
  const fromCount = ayahCount(r.surahFrom);
  const toCount = ayahCount(r.surahTo);

  if (fromCount === null) return { kind: "surah_invalid", surah: r.surahFrom };
  if (toCount === null) return { kind: "surah_invalid", surah: r.surahTo };

  // Āyah numbers are discrete — reject decimals (e.g. 1.5) before they coerce
  // into the DB's integer columns and silently change what was selected.
  if (!Number.isInteger(r.ayahFrom) || r.ayahFrom < 1) return { kind: "ayah_below_one", field: "ayahFrom" };
  if (!Number.isInteger(r.ayahTo) || r.ayahTo < 1) return { kind: "ayah_below_one", field: "ayahTo" };

  if (r.ayahFrom > fromCount) {
    return { kind: "ayah_exceeds_count", field: "ayahFrom", surah: r.surahFrom, ayahCount: fromCount };
  }
  if (r.ayahTo > toCount) {
    return { kind: "ayah_exceeds_count", field: "ayahTo", surah: r.surahTo, ayahCount: toCount };
  }

  if (r.surahTo < r.surahFrom) return { kind: "order", detail: "surah" };
  if (r.surahTo === r.surahFrom && r.ayahTo < r.ayahFrom) return { kind: "order", detail: "ayah" };

  return null;
}

/** Arabic, user-facing message for a violation (FR-004). `surahName` injected so
 *  this stays decoupled from the names module. */
export function violationMessageAr(v: RangeViolation, surahName: (n: number) => string | null): string {
  switch (v.kind) {
    case "surah_invalid":
      return `رقم السورة غير صالح (${v.surah}). يجب أن يكون بين 1 و 114.`;
    case "ayah_below_one":
      return "رقم الآية يجب أن يكون 1 أو أكثر.";
    case "ayah_exceeds_count": {
      const name = surahName(v.surah) ?? `السورة ${v.surah}`;
      return `سورة ${name} تحتوي على ${v.ayahCount} آية فقط — لا يمكن اختيار آية ${v.field === "ayahFrom" ? "البداية" : "النهاية"} خارج هذا النطاق.`;
    }
    case "order":
      return v.detail === "surah"
        ? "سورة النهاية يجب أن تكون بعد سورة البداية أو نفسها."
        : "آية النهاية يجب أن تكون بعد آية البداية أو نفسها داخل نفس السورة.";
  }
}
