import type { ServerClient } from "@/lib/supabase/types";
import { recentWindow } from "@/lib/views/_shared/teacher-reads";

/**
 * Teacher *insights* deep-read module — passive KPI / analytics reads.
 *
 * "How are my class and I doing." Owns the read-assembly for the teacher
 * dashboard's grade-latency KPI and roster recitation-error pulse behind a
 * small `(supabase, teacherId) -> widget data` interface. The injected
 * `supabase` client is the test seam. Behavior-preserving extraction from
 * the `dashboard-queries.ts` god module — query logic is byte-identical.
 */

/**
 * Time-to-grade discipline KPI for the teacher dashboard.
 *
 * Returns the median + 90th-percentile time (in hours) the teacher took
 * to grade a student's follow-up after the student marked it ready
 * (`ready_at` → `completed_at`), over the last 30 days, alongside the
 * sample size.
 *
 * The point is to give teachers a public-to-themselves discipline
 * number — the same kind of accountability the eval-discipline gate
 * enforces, but for grading. Returns nulls when the sample is too
 * small to draw conclusions (< 3 graded items in 30 days).
 *
 * Used by the teacher dashboard KPI strip; thresholds for color-coding
 * (green ≤ 24h, amber ≤ 72h, red beyond) live in the rendering
 * component, not here, since they're a UX choice.
 */
export async function getTeacherTimeToGrade(
  supabase: ServerClient,
  teacherId: string,
): Promise<{ medianHours: number | null; p90Hours: number | null; sampleSize: number }> {
  const thirtyDaysAgoIso = recentWindow(30);

  // Only graded follow-ups (any of the 4 completed_* statuses) where both
  // timestamps are present. ready_at can be null for grandfathered rows
  // pre-Sprint 2.3, so filter explicitly.
  const result = await supabase
    .from("homework_assignments")
    .select("ready_at, completed_at")
    .eq("teacher_id", teacherId)
    .in("status", [
      "completed_excellent",
      "completed_good",
      "completed_needs_work",
      "completed_not_done",
    ])
    .not("ready_at", "is", null)
    .not("completed_at", "is", null)
    .gte("completed_at", thirtyDaysAgoIso)
    .returns<{ ready_at: string; completed_at: string }[]>();
  if (result.error) throw result.error;

  const rows = result.data ?? [];
  if (rows.length < 3) {
    return { medianHours: null, p90Hours: null, sampleSize: rows.length };
  }

  const hours = rows
    .map(r => (new Date(r.completed_at).getTime() - new Date(r.ready_at).getTime()) / (1000 * 60 * 60))
    .filter(h => h >= 0) // defensive: ignore impossible negative durations
    .sort((a, b) => a - b);

  if (hours.length < 3) {
    return { medianHours: null, p90Hours: null, sampleSize: hours.length };
  }

  const median = hours[Math.floor(hours.length / 2)];
  const p90Index = Math.min(hours.length - 1, Math.floor(hours.length * 0.9));
  const p90 = hours[p90Index];

  return {
    medianHours: Math.round(median * 10) / 10,
    p90Hours: Math.round(p90 * 10) / 10,
    sampleSize: hours.length,
  };
}

/**
 * Roster-wide recitation-error pulse for the teacher dashboard.
 *
 * Aggregates `recitation_errors` across all of this teacher's students'
 * progress rows over the last 30 days, returning the top categories so
 * the teacher can see "what does my whole class need work on this
 * month" — the kind of insight a department head would normally
 * compile by hand.
 *
 * Filters OUT the no-errors-observed sentinel rows (Sprint 2.2)
 * because they exist only to flip the per-session banner green and
 * would otherwise inflate the `other` bucket.
 *
 * Returns at most 3 categories, sorted by count desc. An empty array
 * means either no errors logged or the teacher has no progress rows
 * with logged errors yet.
 */
export type RecitationErrorCategory = "makharij" | "sifat" | "madd" | "waqf" | "ghunna" | "other";

export async function getTeacherRosterErrorPulse(
  supabase: ServerClient,
  teacherId: string,
): Promise<{ category: RecitationErrorCategory; count: number }[]> {
  const thirtyDaysAgoIso = recentWindow(30);

  // Single query: recitation_errors joined to this teacher's student_progress
  // rows (last 30 days) via the progress_id FK. Replaces a 2-query waterfall
  // (progress ids, then errors.in(progress_id)) with one round-trip on the
  // dashboard hot path. `!inner` keeps only errors whose progress row belongs
  // to this teacher; the embedded filter scopes the join. (Issue #559.)
  const errorsRes = await supabase
    .from("recitation_errors")
    .select("error_type, note, student_progress!inner(teacher_id, created_at)")
    .eq("student_progress.teacher_id", teacherId)
    .gte("student_progress.created_at", thirtyDaysAgoIso)
    .gte("created_at", thirtyDaysAgoIso)
    .returns<{ error_type: string; note: string | null }[]>();
  if (errorsRes.error) throw errorsRes.error;
  const errors = errorsRes.data;

  if (!errors || errors.length === 0) return [];

  const counts: Record<RecitationErrorCategory, number> = {
    makharij: 0, sifat: 0, madd: 0, waqf: 0, ghunna: 0, other: 0,
  };
  for (const e of errors) {
    if (e.note === "__no_errors_observed_sentinel__") continue;
    if (e.error_type in counts) counts[e.error_type as RecitationErrorCategory] += 1;
    else counts.other += 1;
  }

  return (Object.entries(counts) as [RecitationErrorCategory, number][])
    .filter(([, c]) => c > 0)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([category, count]) => ({ category, count }));
}
