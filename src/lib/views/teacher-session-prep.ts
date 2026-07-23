import type { ServerClient } from "@/lib/supabase/types";
import { ayahCount } from "@/lib/quran/ayah-counts";
import type { RecitationErrorCategory } from "@/lib/views/teacher-insights";

/**
 * Read seam for the "Session prep" card on `/teacher/sessions/[id]`.
 *
 * Deterministic, non-AI query card. Gives a teacher a 10-second read on the
 * student they are about to teach:
 *   1. Top 3 recitation-error categories in the last 90 days (with counts).
 *   2. Repeat-offender ayahs — every ayah with >= 2 logged errors across all
 *      sessions (all-time), by ayah NUMBER only (surah:ayah). No Quran text.
 *
 * SM-2 "overdue reviews" (the issue's third metric) is intentionally OMITTED:
 * the SM-2 data lives in `student_review_schedule`, whose RLS grants SELECT
 * only to the student themselves (`srs__student_read: student_id = auth.uid()`)
 * or an admin. A teacher gets zero rows — proven with a rolled-back RLS control
 * (teacher count = 0, student count = 1). There is no teacher-authorized read
 * path (the only SECURITY DEFINER routine over that table is a batch writer),
 * and bypassing RLS / using the service-role key is forbidden. So the metric
 * cannot be scoped to the teacher and is left out rather than faked.
 *
 * Scoping / security:
 *   - `recitation_errors` has no student_id; it links via
 *     `progress_id -> student_progress`. We embed `student_progress!inner`
 *     and filter on `student_progress.student_id`.
 *   - RLS `errors_select` already lets a teacher read their own students'
 *     errors (progress row's teacher_id = auth.uid()). We rely on RLS — no
 *     SECURITY DEFINER, no service-role. The `studentId` arg is a scoping
 *     filter, NOT the trust source: RLS is the gate, so a wrong id cannot
 *     widen access beyond the caller's own students.
 *
 * The injected `supabase` client is the test seam.
 */

/** How far back the error-category breakdown looks. */
export const SESSION_PREP_WINDOW_DAYS = 90;

/** An ayah is a "repeat offender" at or above this many logged errors. */
export const REPEAT_OFFENDER_THRESHOLD = 2;

/** Sentinel note used by the "no errors observed" attestation rows. */
const NO_ERRORS_SENTINEL = "__no_errors_observed_sentinel__";

export interface SessionPrepErrorType {
  category: RecitationErrorCategory;
  count: number;
}

export interface RepeatOffenderAyah {
  surah: number;
  ayah: number;
  count: number;
}

export interface StudentSessionPrep {
  /** Top 3 error categories in the last 90 days, highest first. */
  topErrorTypes: SessionPrepErrorType[];
  /** Ayahs with >= 2 errors across all sessions (all-time), worst first. */
  repeatOffenderAyahs: RepeatOffenderAyah[];
}

interface ErrorRow {
  error_type: string;
  surah_num: number | null;
  ayah_num: number;
  note: string | null;
  created_at: string;
}

const CATEGORIES: RecitationErrorCategory[] = [
  "makharij",
  "sifat",
  "madd",
  "waqf",
  "ghunna",
  "other",
];

/**
 * Load the session-prep metrics for one student, scoped by RLS to the
 * authenticated teacher. Throws on a query error so the caller
 * (`helperOrFail`) can log with widget tags and render an empty card.
 */
export async function getStudentSessionPrep(
  supabase: ServerClient,
  studentId: string,
): Promise<StudentSessionPrep> {
  // One round trip: pull every error row for this student's progress rows.
  // No created_at filter here — metric 2 is all-time; metric 1 slices the
  // 90-day window in memory. The embed also dodges the URL-length risk of a
  // two-step `.in(progressIds)` for a student with many progress rows.
  const { data, error } = await supabase
    .from("recitation_errors")
    .select("error_type, surah_num, ayah_num, note, created_at, student_progress!inner(student_id)")
    .eq("student_progress.student_id", studentId)
    .returns<ErrorRow[]>();
  if (error) throw error;
  const rows = data ?? [];

  // ── Metric 1: top-3 error categories, last 90 days ──────────────────────
  const windowStart = Date.now() - SESSION_PREP_WINDOW_DAYS * 86400_000;
  const counts: Record<RecitationErrorCategory, number> = {
    makharij: 0, sifat: 0, madd: 0, waqf: 0, ghunna: 0, other: 0,
  };
  for (const r of rows) {
    if (r.note === NO_ERRORS_SENTINEL) continue; // attestation, not a real error
    if (new Date(r.created_at).getTime() < windowStart) continue;
    if (Object.prototype.hasOwnProperty.call(counts, r.error_type)) {
      counts[r.error_type as RecitationErrorCategory] += 1;
    } else counts.other += 1; // defensive: any unknown type folds into "other"
  }
  const topErrorTypes = CATEGORIES
    .map((category) => ({ category, count: counts[category] }))
    .filter((e) => e.count > 0)
    .sort((a, b) => b.count - a.count)
    .slice(0, 3);

  // ── Metric 2: repeat-offender ayahs, all-time (>= 2 errors) ─────────────
  // "across sessions" = total logged errors for that ayah is >= 2 (the plain
  // reading — not >= 2 distinct sessions). Needs both surah + ayah to render
  // "surah:ayah", so null-surah rows are dropped.
  const ayahCounts = new Map<string, RepeatOffenderAyah>();
  for (const r of rows) {
    if (r.note === NO_ERRORS_SENTINEL) continue;
    if (r.surah_num == null) continue;
    const surahAyahCount = ayahCount(r.surah_num);
    if (surahAyahCount == null || r.ayah_num < 1 || r.ayah_num > surahAyahCount) continue;
    const key = `${r.surah_num}:${r.ayah_num}`;
    const prev = ayahCounts.get(key);
    if (prev) prev.count += 1;
    else ayahCounts.set(key, { surah: r.surah_num, ayah: r.ayah_num, count: 1 });
  }
  const repeatOffenderAyahs = Array.from(ayahCounts.values())
    .filter((a) => a.count >= REPEAT_OFFENDER_THRESHOLD)
    .sort((a, b) => b.count - a.count || a.surah - b.surah || a.ayah - b.ayah);

  return { topErrorTypes, repeatOffenderAyahs };
}
