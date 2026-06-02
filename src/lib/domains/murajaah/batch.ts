/**
 * Murajaah daily-batch shaping (spec 001) — pure row → DTO mapping.
 *
 * `getTodaysMurajaahBatch` (src/lib/dashboard-queries.ts) reads the student's
 * due review rows joined to their memorised range; this module owns the pure
 * shaping so the mapping — including the "the joined progress row is missing"
 * fallback — is unit-testable without a Supabase client. See batch.test.ts.
 */

/** One due-review item the dashboard card renders. */
export interface MurajaahDueItem {
  scheduleId: string;
  surahFrom: number | null;
  ayahFrom: number | null;
  surahTo: number | null;
  ayahTo: number | null;
}

/** A schedule row with its embedded (to-one) student_progress range, as PostgREST returns it. */
export interface MurajaahScheduleRow {
  id: string;
  student_progress: {
    surah_from: number | null;
    ayah_from: number | null;
    surah_to: number | null;
    ayah_to: number | null;
  } | null;
}

/**
 * Map raw schedule rows to dashboard items. A row whose `student_progress` join
 * is absent (e.g. the progress row was deleted) keeps its scheduleId and falls
 * back to null ranges — the card renders it as the generic "القرآن" rather than
 * crashing.
 */
export function toMurajaahDueItems(rows: MurajaahScheduleRow[] | null | undefined): MurajaahDueItem[] {
  return (rows ?? []).map((r) => ({
    scheduleId: r.id,
    surahFrom: r.student_progress?.surah_from ?? null,
    ayahFrom: r.student_progress?.ayah_from ?? null,
    surahTo: r.student_progress?.surah_to ?? null,
    ayahTo: r.student_progress?.ayah_to ?? null,
  }));
}
