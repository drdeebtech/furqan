import type { ServerClient } from "@/lib/supabase/types";
import { buildNameMap } from "@/lib/admin/name-map";

/**
 * Deep-read module for the `/admin/analytics` screen (spec 034 / issue #555).
 *
 * Scope is deliberately narrow: only the metrics that did NOT already exist
 * elsewhere in the admin surface. Revenue lives on `/admin/dashboard`
 * (getAdminDailyRevenue / getAdminMonthlyRevenueTrend) and `/admin/payments`;
 * churn lives on `/admin/retention`. This module owns the two genuine gaps:
 *
 *   1. Active-user counts (DAU / WAU / MAU) for students and teachers.
 *   2. Cross-teacher session completion rates.
 *
 * The injected `supabase` client is the test seam — tests pass a fake without
 * a live server client. Functions throw on query error so the page can wrap
 * them with `helperOrFail` for widget-tagged observability.
 *
 * Activity is derived from *delivered* sessions (`sessions.started_at`),
 * joined to `bookings` for the student/teacher identity — there is no
 * `last_active_at` column (spec 034 D1: proxy, not new schema).
 */

const DAY_MS = 24 * 60 * 60 * 1000;

// ponytail: JS-side distinct/aggregation with a row cap. At small (pre-launch)
// volume this is exact and cheap. Upgrade path if audit_log/sessions grow past
// the cap: move to a SQL aggregate (RPC) so distinct counts stay exact.
const ROW_CAP = 20000;

export interface ActiveUserCounts {
  students: { dau: number; wau: number; mau: number };
  teachers: { dau: number; wau: number; mau: number };
  /** True if the 30-day window hit ROW_CAP — counts are then a floor, not exact. */
  capped: boolean;
}

type StartedSessionRow = {
  started_at: string;
  bookings: { student_id: string; teacher_id: string } | null;
};

/**
 * DAU/WAU/MAU for students and teachers over rolling 1/7/30-day windows,
 * counting distinct participants in *started* sessions. One 30-day fetch,
 * bucketed in JS.
 */
export async function getActiveUserCounts(
  supabase: ServerClient,
  now: Date = new Date(),
): Promise<ActiveUserCounts> {
  const monthStart = new Date(now.getTime() - 30 * DAY_MS).toISOString();
  const dayCutoff = now.getTime() - DAY_MS;
  const weekCutoff = now.getTime() - 7 * DAY_MS;

  const { data, error } = await supabase
    .from("sessions")
    // FK-qualified embed: the generated types expose more than one sessions↔
    // bookings relationship, so an unqualified `bookings!inner` is ambiguous and
    // 300s in PostgREST (known Sentry hits). Pin the sessions.booking_id FK.
    .select("started_at, bookings!sessions_booking_id_fkey!inner(student_id, teacher_id)")
    .gte("started_at", monthStart)
    .order("started_at", { ascending: false })
    .limit(ROW_CAP)
    .returns<StartedSessionRow[]>();

  if (error) throw new Error(`getActiveUserCounts: ${error.message}`);
  const rows = data ?? [];

  const students = { dau: new Set<string>(), wau: new Set<string>(), mau: new Set<string>() };
  const teachers = { dau: new Set<string>(), wau: new Set<string>(), mau: new Set<string>() };

  for (const r of rows) {
    if (!r.bookings) continue;
    const ts = new Date(r.started_at).getTime();
    const { student_id, teacher_id } = r.bookings;
    students.mau.add(student_id);
    teachers.mau.add(teacher_id);
    if (ts >= weekCutoff) { students.wau.add(student_id); teachers.wau.add(teacher_id); }
    if (ts >= dayCutoff) { students.dau.add(student_id); teachers.dau.add(teacher_id); }
  }

  return {
    students: { dau: students.dau.size, wau: students.wau.size, mau: students.mau.size },
    teachers: { dau: teachers.dau.size, wau: teachers.wau.size, mau: teachers.mau.size },
    capped: rows.length >= ROW_CAP,
  };
}

export interface TeacherCompletionRow {
  teacherId: string;
  teacherName: string;
  completed: number;
  /** Bookings that were due to happen: completed + no_show + confirmed. */
  scheduled: number;
  /** completed / scheduled, 0..1; null when scheduled === 0. */
  rate: number | null;
}

type BookingStatusRow = { teacher_id: string; status: string };

/**
 * Per-teacher session completion rate over the last `windowDays` (default 30).
 *
 * Denominator = bookings that were *meant* to happen in the window:
 * completed + no_show + confirmed. `pending` (not yet due) and `cancelled`
 * (deliberately called off) are excluded so the rate reflects show-through,
 * not booking volume. Sorted worst-rate-first to surface problems.
 */
export async function getTeacherCompletionRates(
  supabase: ServerClient,
  now: Date = new Date(),
  windowDays = 30,
): Promise<TeacherCompletionRow[]> {
  const since = new Date(now.getTime() - windowDays * DAY_MS).toISOString();

  const { data, error } = await supabase
    .from("bookings")
    .select("teacher_id, status")
    .gte("scheduled_at", since)
    .lte("scheduled_at", now.toISOString()) // exclude future `confirmed` — only count sessions already due
    .is("deleted_at", null)
    .in("status", ["completed", "no_show", "confirmed"])
    .limit(ROW_CAP)
    .returns<BookingStatusRow[]>();

  if (error) throw new Error(`getTeacherCompletionRates: ${error.message}`);
  const rows = data ?? [];

  const byTeacher = new Map<string, { completed: number; scheduled: number }>();
  for (const r of rows) {
    const agg = byTeacher.get(r.teacher_id) ?? { completed: 0, scheduled: 0 };
    agg.scheduled += 1;
    if (r.status === "completed") agg.completed += 1;
    byTeacher.set(r.teacher_id, agg);
  }

  const ids = [...byTeacher.keys()];
  const nameMap = await buildNameMap(supabase, ids);

  return ids
    .map((teacherId) => {
      const { completed, scheduled } = byTeacher.get(teacherId)!;
      return {
        teacherId,
        teacherName: nameMap[teacherId] ?? "—",
        completed,
        scheduled,
        rate: scheduled > 0 ? completed / scheduled : null,
      };
    })
    .sort((a, b) => (a.rate ?? 1) - (b.rate ?? 1));
}
