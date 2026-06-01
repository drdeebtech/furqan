/**
 * Progress domain — types for ḥifẓ capture (spec 010).
 *
 * Per ADR-0002/0004: domain functions take already-authenticated structured
 * input (the route adapter does requireRole + owns-booking) and return a
 * discriminated outcome the adapter maps to `<ActionFeedback>`.
 */

export type ErrorType = "makharij" | "sifat" | "madd" | "waqf" | "ghunna" | "other";
export type ProgressType = "new" | "muraja" | "correction";
export type StudentLevel = "beginner" | "intermediate" | "advanced";

export interface CapturedError {
  surahNum: number;
  ayahNum: number;
  errorType: ErrorType;
  note?: string | null;
}

export interface RecordProgressInput {
  bookingId: string;
  progressType: ProgressType;
  /** Required for `new` (a memorized portion); optional for `muraja`/`correction`. */
  range: { surahFrom: number; ayahFrom: number; surahTo: number; ayahTo: number } | null;
  pagesReviewed?: number | null;
  qualityRating?: number | null; // 1..5
  level?: StudentLevel;
  teacherNotes?: string | null;
  errors?: CapturedError[];
}

export type RecordProgressOutcome =
  | { ok: true; progressId: string }
  | { ok: false; reason: "invalid_range"; message: string } // Arabic, names the sūrah + count
  | { ok: false; reason: "missing_range"; message: string } // `new` without a range
  | { ok: false; reason: "not_found" }
  | { ok: false; reason: "error"; message: string };
