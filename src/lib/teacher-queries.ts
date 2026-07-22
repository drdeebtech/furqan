/**
 * Teacher-roster-scoped Supabase queries.
 *
 * Sibling to `dashboard-queries.ts` (which is page-level). This module is the
 * single source of truth for queries scoped to a teacher's roster — talqeen
 * inbox, recitation tracker, calendar events, package balances, teaching
 * hours, and roster progress aggregations.
 *
 * Every function here filters by `teacher_id = auth.uid()` (or equivalent
 * ownership) at the SQL level, so RLS plus the explicit filter give
 * defense-in-depth. Pages must never bypass this module by writing inline
 * Supabase calls — that pattern caused the duplicated-query problem in the
 * student dashboard before the existing dashboard-queries.ts consolidation.
 *
 * Functions are added incrementally per PR. Each new function lands alongside
 * its consuming page in the same PR, never as speculative scaffolding.
 */

import { createClient } from "@/lib/supabase/server";

export type TeacherId = string;

// ─── Teaching hours analytics ───────────────────────────────────────────────

export interface TeacherTeachingHoursSummary {
  /** Total minutes taught in the rolling last-7-day window. */
  thisWeekMinutes: number;
  /** Total minutes taught in the rolling last-30-day window. */
  thisMonthMinutes: number;
  /** Per-session-type minutes for the last-30-day window. */
  byTypeThisMonth: Record<string, number>;
  /** Daily totals for the last 30 days, oldest → newest. */
  daily: Array<{ date: string; minutes: number }>;
}

/**
 * Teaching-hours analytics for /teacher/time-tracker.
 *
 * NOT a clone of /student/time-tracker. The student tracker is a self-logged
 * stopwatch (`study_log` table). The teacher's source of truth is **completed
 * sessions** — `sessions.actual_duration` for rows whose `ended_at IS NOT
 * NULL`, joined to bookings to attribute by teacher and session_type.
 *
 * Reads only — no mutations, no migrations.
 */
export async function getTeacherTeachingHours(
  teacherId: TeacherId,
): Promise<TeacherTeachingHoursSummary> {
  const supabase = await createClient();
  const now = Date.now();
  const dayMs = 24 * 60 * 60 * 1000;
  const thirtyDaysAgo = new Date(now - 30 * dayMs).toISOString();
  const sevenDaysAgo = new Date(now - 7 * dayMs).toISOString();

  // Step 1: bookings owned by this teacher in the last-30 window. Defines
  // the candidate booking set + carries session_type for the breakdown.
  const bookingsRes = await supabase
    .from("bookings")
    .select("id, session_type, scheduled_at")
    .eq("teacher_id", teacherId)
    .gte("scheduled_at", thirtyDaysAgo)
    .returns<
      { id: string; session_type: string; scheduled_at: string }[]
    >();
  if (bookingsRes.error) throw bookingsRes.error;
  const bookings = bookingsRes.data;
  if (!bookings || bookings.length === 0) {
    return {
      thisWeekMinutes: 0,
      thisMonthMinutes: 0,
      byTypeThisMonth: {},
      daily: _emptyDailyWindow(now, dayMs),
    };
  }

  const bookingIds = bookings.map((b) => b.id);
  const sessionTypeByBooking = new Map<string, string>();
  for (const b of bookings) sessionTypeByBooking.set(b.id, b.session_type);

  // Step 2: completed sessions for those bookings.
  const sessionsRes = await supabase
    .from("sessions")
    .select("booking_id, actual_duration, started_at, ended_at")
    .in("booking_id", bookingIds)
    .not("ended_at", "is", null)
    .returns<
      {
        booking_id: string;
        actual_duration: number | null;
        started_at: string | null;
        ended_at: string | null;
      }[]
    >();
  if (sessionsRes.error) throw sessionsRes.error;

  let thisWeekMinutes = 0;
  let thisMonthMinutes = 0;
  const byTypeThisMonth: Record<string, number> = {};
  const dailyTotals = new Map<string, number>();

  const sessions = sessionsRes.data;
  if (sessions) {
    for (const s of sessions) {
      const minutes = s.actual_duration ?? 0;
      if (minutes <= 0) continue;
      const sessionType = sessionTypeByBooking.get(s.booking_id) ?? "other";
      const startedAt = s.started_at ?? s.ended_at;
      if (!startedAt) continue;

      thisMonthMinutes += minutes;
      byTypeThisMonth[sessionType] =
        (byTypeThisMonth[sessionType] ?? 0) + minutes;

      if (startedAt >= sevenDaysAgo) {
        thisWeekMinutes += minutes;
      }

      const day = startedAt.slice(0, 10);
      dailyTotals.set(day, (dailyTotals.get(day) ?? 0) + minutes);
    }
  }

  // Materialize the daily window with zeros for empty days.
  const daily = _emptyDailyWindow(now, dayMs).map((entry) => ({
    date: entry.date,
    minutes: dailyTotals.get(entry.date) ?? 0,
  }));

  return {
    thisWeekMinutes,
    thisMonthMinutes,
    byTypeThisMonth,
    daily,
  };
}

function _emptyDailyWindow(
  now: number,
  dayMs: number,
): Array<{ date: string; minutes: number }> {
  const out: Array<{ date: string; minutes: number }> = [];
  for (let i = 29; i >= 0; i--) {
    const d = new Date(now - i * dayMs);
    out.push({ date: d.toISOString().slice(0, 10), minutes: 0 });
  }
  return out;
}

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

function avgOf(values: Array<number | null>): number | null {
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
  teacherId: TeacherId,
): Promise<TeacherRosterProgressRow[]> {
  const supabase = await createClient();

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
