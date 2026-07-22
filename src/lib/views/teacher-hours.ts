import type { ServerClient } from "@/lib/supabase/types";
import { recentWindow } from "@/lib/views/_shared/teacher-reads";

/**
 * Teacher teaching-hours read module — the `/teacher/time-tracker` page.
 *
 * Behavior-preserving extraction from the retired teacher-roster read module (Task 4 of the
 * architecture-deepening series). The injected `supabase` client is the
 * test seam. The only intentional change is collapsing the inline 30-day /
 * 7-day window literals into the shared `recentWindow` helper —
 * output-identical to the original.
 */

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
  supabase: ServerClient,
  teacherId: TeacherId,
): Promise<TeacherTeachingHoursSummary> {
  const now = Date.now();
  const dayMs = 24 * 60 * 60 * 1000;
  const thirtyDaysAgo = recentWindow(30);
  const sevenDaysAgo = recentWindow(7);

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

export function _emptyDailyWindow(
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
