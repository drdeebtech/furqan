import type { ServerClient } from "@/lib/supabase/types";

/**
 * Teacher roster-progress read module — the `/teacher/progress` page.
 *
 * Behavior-preserving extraction from the retired teacher-roster read module (Task 4 of the
 * architecture-deepening series). The injected `supabase` client is the
 * test seam.
 *
 * NOTE: this function's name-resolve block queries `profiles` (not
 * `public_profiles`) for `id, full_name` inside a `Promise.all` alongside
 * the evaluations RPC. It structurally resembles the shared
 * `resolveStudentNames` helper's output shape, but reads a different table
 * (different RLS reach — see `src/lib/admin/name-map.ts`'s comment on why
 * `public_profiles` exists). Swapping the data source is a behavior change
 * out of scope for a mechanical move, so it's left verbatim; flagged in the
 * Task 4 report.
 */

export type TeacherId = string;

// ─── Roster progress dashboard ──────────────────────────────────────────────

export interface TeacherRosterProgressRow {
  studentId: string;
  studentName: string;
  /** Average across the last 5 evaluations the teacher gave this student. */
  hifzAvg: number | null;
  tajweedAvg: number | null;
  fluencyAvg: number | null;
  attendanceAvg: number | null;
  overallAvg: number | null;
  /** Composite — 0.4·hifz + 0.4·tajweed + 0.2·fluency. Null when none of the
   *  inputs are present. The schema has no `akhlaq_score`; we substitute
   *  `fluency_score` as the third dimension. */
  composite: number | null;
  evalCount: number;
  daysSinceLastEval: number | null;
  /** Surfaces students who need attention. Three signals OR'd:
   *   - composite < 3 (poor scores)
   *   - daysSinceLastEval > 30 (eval lag)
   *   - never evaluated despite a booking history */
  atRisk: boolean;
}

const ROSTER_COMPOSITE_AT_RISK_THRESHOLD = 3.0;
const ROSTER_EVAL_LAG_DAYS_DEFAULT = 30;

/**
 * Hifz / tajweed / fluency composite weights used by the roster heatmap.
 *
 * TODO(human): a senior Quran teacher should validate these weights —
 * particularly which dimension matters most when a student is uneven (e.g.
 * strong hifz but weak tajweed vs. the inverse). The schema lacks an
 * akhlaq_score column so this composite uses fluency as the third dim;
 * if/when akhlaq is added to evaluations, the weight 0.2 belongs to akhlaq
 * and fluency should drop. See Learning by Doing #1 in the parity plan.
 */
const COMPOSITE_W_HIFZ = 0.4;
const COMPOSITE_W_TAJWEED = 0.4;
const COMPOSITE_W_FLUENCY = 0.2;

interface EvalRow {
  student_id: string;
  evaluation_date: string;
  hifz_score: number | null;
  tajweed_score: number | null;
  fluency_score: number | null;
  attendance_score: number | null;
  overall_score: number | null;
}

export function avgOf(values: Array<number | null>): number | null {
  const nums = values.filter((v): v is number => typeof v === "number");
  if (nums.length === 0) return null;
  return nums.reduce((s, n) => s + n, 0) / nums.length;
}

/**
 * Per-student roster progress — the "command center" view a teacher uses
 * to spot who's stuck, who's blooming, who's at risk. One row per student
 * with at least one booking history entry.
 *
 * Per-student `.limit(5)` rather than a global `.limit(N)` to avoid the
 * truncation pattern flagged on PR #125 (one very-active student crowds
 * out the rest of the roster). N+1 queries are fine at typical roster
 * sizes (5–30); revisit if a teacher hits 100+ students.
 */
export async function getTeacherRosterProgress(
  supabase: ServerClient,
  teacherId: TeacherId,
): Promise<TeacherRosterProgressRow[]> {
  // Step 1: distinct students via indexed RPC (S1 scale fix). Cast until
  // db:types regenerates post-migration.
  const distinctRes = await (
    supabase
      .rpc("teacher_distinct_students" as never, { p_teacher_id: teacherId } as never)
      .returns<{ student_id: string }[]>() as unknown as Promise<{
        data: { student_id: string }[] | null;
        error: { message: string } | null;
      }>
  );
  if (distinctRes.error) throw new Error(distinctRes.error.message);
  const studentIds = (distinctRes.data ?? []).map((r) => r.student_id);
  if (studentIds.length === 0) return [];

  // Step 2: profiles + last-5 evaluations per student in a single IN-query
  // instead of one query per student (audit H11). Rows arrive globally
  // evaluation_date-desc; keeping the first 5 seen per student reproduces the
  // previous per-student `.limit(5)`.
  const [profilesRes, evalsRes] = await Promise.all([
    supabase
      .from("profiles")
      .select("id, full_name")
      .in("id", studentIds)
      .returns<{ id: string; full_name: string | null }[]>(),
    // Window-function RPC bounds to exactly 5 evaluations PER student for this
    // teacher (replaces the global .limit() cap).
    supabase
      .rpc("roster_recent_evaluations", { p_teacher_id: teacherId, p_student_ids: studentIds })
      .returns<EvalRow[]>(),
  ]);
  if (profilesRes.error) throw profilesRes.error;
  if (evalsRes.error) throw evalsRes.error;

  const nameById = new Map<string, string>();
  if (profilesRes.data) {
    for (const p of profilesRes.data)
      nameById.set(p.id, p.full_name ?? "—");
  }

  const evalsByStudent = new Map<string, EvalRow[]>();
  for (const id of studentIds) evalsByStudent.set(id, []);
  for (const row of evalsRes.data ?? []) {
    const arr = evalsByStudent.get(row.student_id);
    if (arr && arr.length < 5) arr.push(row);
  }

  const now = Date.now();
  const dayMs = 24 * 60 * 60 * 1000;

  return studentIds.map((id) => {
    const evalRows = evalsByStudent.get(id) ?? [];
    const hifzAvg = avgOf(evalRows.map((e) => e.hifz_score));
    const tajweedAvg = avgOf(evalRows.map((e) => e.tajweed_score));
    const fluencyAvg = avgOf(evalRows.map((e) => e.fluency_score));
    const attendanceAvg = avgOf(evalRows.map((e) => e.attendance_score));
    const overallAvg = avgOf(evalRows.map((e) => e.overall_score));

    let composite: number | null = null;
    if (hifzAvg !== null || tajweedAvg !== null || fluencyAvg !== null) {
      let weighted = 0;
      let weightSum = 0;
      if (hifzAvg !== null) {
        weighted += hifzAvg * COMPOSITE_W_HIFZ;
        weightSum += COMPOSITE_W_HIFZ;
      }
      if (tajweedAvg !== null) {
        weighted += tajweedAvg * COMPOSITE_W_TAJWEED;
        weightSum += COMPOSITE_W_TAJWEED;
      }
      if (fluencyAvg !== null) {
        weighted += fluencyAvg * COMPOSITE_W_FLUENCY;
        weightSum += COMPOSITE_W_FLUENCY;
      }
      composite = weightSum > 0 ? weighted / weightSum : null;
    }

    const lastEvalDate = evalRows.length > 0 ? evalRows[0].evaluation_date : null;
    const daysSinceLastEval = lastEvalDate
      ? Math.floor((now - new Date(lastEvalDate).getTime()) / dayMs)
      : null;

    const atRisk =
      (composite !== null && composite < ROSTER_COMPOSITE_AT_RISK_THRESHOLD) ||
      daysSinceLastEval === null ||
      daysSinceLastEval >= ROSTER_EVAL_LAG_DAYS_DEFAULT;

    return {
      studentId: id,
      studentName: nameById.get(id) ?? "—",
      hifzAvg,
      tajweedAvg,
      fluencyAvg,
      attendanceAvg,
      overallAvg,
      composite,
      evalCount: evalRows.length,
      daysSinceLastEval,
      atRisk,
    };
  });
}
