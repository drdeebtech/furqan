import { createClient } from "@/lib/supabase/server";
import type { ServerClient } from "@/lib/supabase/types";
import type { Lang } from "@/lib/i18n/server";
import { formatDate } from "@/lib/i18n/format-date";
import { logError } from "@/lib/logger";
import {
  generateEmptyWeek,
  EN_DAYS,
  AR_DAYS,
  type ChartDataPoint,
} from "@/lib/views/_shared/chart";
import type { LiveSessionItem } from "@/lib/views/_shared/live-session";

/**
 * Calendar events for /student/calendar — combines bookings, follow-up due
 * dates, package expiries, and evaluation periods into a single
 * date-keyed list scoped to a month window. Returns one row per event;
 * the calendar grid groups them by date client-side.
 */
export type CalendarEvent = {
  id: string;
  date: string; // ISO yyyy-mm-dd
  kind: "session" | "homework" | "package_expiry" | "evaluation";
  title: string;
  href: string;
  color: string; // tailwind palette token (passed inline as hex)
};


export async function getStudentCalendarEvents(
  supabase: ServerClient,
  studentId: string,
  monthStart: Date,
  monthEnd: Date,
): Promise<CalendarEvent[]> {
  const startIso = monthStart.toISOString();
  const endIso = monthEnd.toISOString();

  const [bookingsRes, homeworkRes, packagesRes, evalsRes] = await Promise.all([
    supabase.from("bookings")
      .select("id, scheduled_at, session_type, status")
      .eq("student_id", studentId)
      .gte("scheduled_at", startIso).lte("scheduled_at", endIso)
      .returns<{ id: string; scheduled_at: string; session_type: string; status: string }[]>(),
    supabase.from("homework_assignments")
      .select("id, due_date, status")
      .eq("student_id", studentId)
      .not("due_date", "is", null)
      .gte("due_date", startIso).lte("due_date", endIso)
      .returns<{ id: string; due_date: string | null; status: string }[]>(),
    supabase.from("student_packages")
      .select("id, expires_at, status")
      .eq("student_id", studentId)
      .not("expires_at", "is", null)
      .gte("expires_at", startIso).lte("expires_at", endIso)
      .returns<{ id: string; expires_at: string | null; status: string }[]>(),
    supabase.from("session_evaluations")
      .select("id, evaluation_date, evaluation_type")
      .eq("student_id", studentId)
      .gte("evaluation_date", startIso).lte("evaluation_date", endIso)
      .returns<{ id: string; evaluation_date: string; evaluation_type: string }[]>(),
  ]);

  const events: CalendarEvent[] = [];
  const day = (iso: string) => iso.slice(0, 10);

  for (const b of bookingsRes.data ?? []) {
    events.push({
      id: `booking_${b.id}`,
      date: day(b.scheduled_at),
      kind: "session",
      title: b.session_type,
      href: `/student/sessions`,
      color: b.status === "completed" ? "#10B981" : b.status === "no_show" ? "#EF4444" : "#3B82F6",
    });
  }
  for (const h of homeworkRes.data ?? []) {
    if (!h.due_date) continue;
    events.push({
      id: `hw_${h.id}`,
      date: day(h.due_date),
      kind: "homework",
      title: h.status === "assigned" ? "Follow-up due" : `Follow-up (${h.status})`,
      href: "/student/follow-up",
      color: "#F59E0B",
    });
  }
  for (const p of packagesRes.data ?? []) {
    if (!p.expires_at) continue;
    events.push({
      id: `pkg_${p.id}`,
      date: day(p.expires_at),
      kind: "package_expiry",
      title: "Package expires",
      href: "/student/dashboard",
      color: "#8B5CF6",
    });
  }
  for (const e of evalsRes.data ?? []) {
    events.push({
      id: `eval_${e.id}`,
      date: day(e.evaluation_date),
      kind: "evaluation",
      title: `Evaluation (${e.evaluation_type})`,
      href: "/student/progress",
      color: "#06B6D4",
    });
  }

  return events;
}


/**
 * Month-over-month revenue for the admin MRR card.
 * Returns current-MTD and previous-month-same-period (or full month) totals
 * so a visible delta can be computed client-side.
 */
export interface MonthlyRevenueTrend {
  currentMonthUsd: number;
  previousMonthUsd: number;
  changePct: number; // rounded to integer
}


export async function getAdminMonthlyRevenueTrend(): Promise<MonthlyRevenueTrend> {
  const supabase = await createClient();
  const now = new Date();
  const firstOfThisMonth = new Date(now.getFullYear(), now.getMonth(), 1);
  const firstOfLastMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  const lastMonthSameDay = new Date(
    firstOfLastMonth.getFullYear(),
    firstOfLastMonth.getMonth(),
    Math.min(
      now.getDate(),
      new Date(firstOfThisMonth.getTime() - 1).getDate(),
    ),
    23, 59, 59,
  );

  const [currentRes, previousRes] = await Promise.all([
    supabase
      .from("bookings")
      .select("amount_usd")
      .eq("status", "completed")
      .gte("created_at", firstOfThisMonth.toISOString())
      .returns<{ amount_usd: number }[]>(),
    supabase
      .from("bookings")
      .select("amount_usd")
      .eq("status", "completed")
      .gte("created_at", firstOfLastMonth.toISOString())
      .lt("created_at", lastMonthSameDay.toISOString())
      .returns<{ amount_usd: number }[]>(),
  ]);

  const sum = (rows: { amount_usd: number }[] | null | undefined) =>
    (rows ?? []).reduce((acc, r) => acc + Number(r.amount_usd || 0), 0);

  const currentMonthUsd = sum(currentRes.data);
  const previousMonthUsd = sum(previousRes.data);
  const changePct = previousMonthUsd > 0
    ? Math.round(((currentMonthUsd - previousMonthUsd) / previousMonthUsd) * 100)
    : currentMonthUsd > 0 ? 100 : 0;

  return { currentMonthUsd, previousMonthUsd, changePct };
}


export async function getAdminDailyRevenue(
  lang: "ar" | "en" = "en"
): Promise<ChartDataPoint[]> {
  const supabase = await createClient();
  const sevenDaysAgo = new Date();
  sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

  const { data: bookings, error: bookingsErr } = await supabase
    .from("bookings")
    .select("amount_usd, created_at")
    .eq("status", "completed")
    .gte("created_at", sevenDaysAgo.toISOString())
    .returns<{ amount_usd: number; created_at: string }[]>();
  if (bookingsErr) logError("dashboard-queries: admin daily revenue bookings fetch failed", bookingsErr, { tag: "dashboard-queries" });

  if (!bookings || bookings.length === 0) return generateEmptyWeek(lang);

  const days = lang === "ar" ? AR_DAYS : EN_DAYS;
  const order = [1, 2, 3, 4, 5, 6, 0]; // Mon–Sun
  const buckets: Record<number, number> = {};

  for (const b of bookings) {
    const dayIndex = new Date(b.created_at).getDay();
    buckets[dayIndex] = (buckets[dayIndex] ?? 0) + Number(b.amount_usd);
  }

  const result = order.map((i) => ({
    day: days[i],
    value: Math.round((buckets[i] ?? 0) * 100) / 100,
    isActive: false,
  }));

  let maxVal = 0;
  let maxIdx = -1;
  for (let i = 0; i < result.length; i++) {
    if (result[i].value > maxVal) {
      maxVal = result[i].value;
      maxIdx = i;
    }
  }
  if (maxIdx >= 0) result[maxIdx].isActive = true;

  return result;
}


export async function getPlatformLiveSessions(): Promise<LiveSessionItem[]> {
  const supabase = await createClient();

  // Single round-trip via FK chain: sessions.booking_id → bookings →
  // {student, teacher} profiles. Replaces the previous 3-stage cascade.
  type Row = {
    id: string;
    started_at: string;
    booking: {
      session_type: string;
      student: { full_name: string | null } | null;
      teacher: { full_name: string | null } | null;
    } | null;
  };

  // Stranded-session guard: a session that started but never ended will sit in
  // this filter forever and pollute every "live" view. Clamp to a 4h window —
  // covers 2× the longest realistic 90-min session and stays in sync with the
  // auto-complete cron's 2× duration_min cutoff.
  const fourHoursAgo = new Date(Date.now() - 4 * 60 * 60 * 1000).toISOString();
  const { data: sessions, error: sessionsErr } = await supabase
    .from("sessions")
    .select(
      // Disambiguate which sessions↔bookings FK to embed: the schema has
      // both bookings.session_id (one-to-many) and sessions.booking_id
      // (one-to-one). Without the !sessions_booking_id_fkey hint
      // PostgREST returns PGRST201. (Sentry JAVASCRIPT-NEXTJS-E4-17.)
      "id, started_at, booking:bookings!sessions_booking_id_fkey(session_type, student:profiles!student_id(full_name), teacher:profiles!teacher_id(full_name))",
    )
    .not("started_at", "is", null)
    .is("ended_at", null)
    .gte("started_at", fourHoursAgo)
    .returns<Row[]>();
  if (sessionsErr) logError("dashboard-queries: platform live sessions fetch failed", sessionsErr, { tag: "dashboard-queries" });

  if (!sessions || sessions.length === 0) return [];

  const now = Date.now();
  return sessions.map((s) => {
    const studentName = s.booking?.student?.full_name ?? "—";
    const teacherName = s.booking?.teacher?.full_name ?? "—";
    const initials = teacherName.slice(0, 2);
    const elapsed = now - new Date(s.started_at).getTime();
    const hrs = Math.floor(elapsed / 3600000);
    const mins = Math.floor((elapsed % 3600000) / 60000);
    const secs = Math.floor((elapsed % 60000) / 1000);
    const timeStr = `${String(hrs).padStart(2, "0")}:${String(mins).padStart(2, "0")}:${String(secs).padStart(2, "0")}`;

    return {
      id: s.id,
      title: `${studentName} ← ${teacherName}`,
      subtitle: s.booking?.session_type ?? "session",
      initials,
      timeRemaining: timeStr,
      progressPercent: undefined,
    };
  });
}


const BOOKING_STATUS_COLORS: Record<string, { ar: string; en: string; color: string }> =
  {
    completed: { ar: "مكتمل", en: "Completed", color: "#22C55E" },
    confirmed: { ar: "مؤكد", en: "Confirmed", color: "#7C5CFF" },
    pending: { ar: "معلق", en: "Pending", color: "#F59E0B" },
    cancelled: { ar: "ملغي", en: "Cancelled", color: "#EF4444" },
    no_show: { ar: "لم يحضر", en: "No Show", color: "#9CA3AF" },
  };


export async function getAdminBookingStatusBreakdown(
  lang: Lang = "ar",
): Promise<{ label: string; value: number; color: string }[]> {
  const supabase = await createClient();
  const thirtyDaysAgo = new Date();
  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

  const { data: bookings, error: bookingsErr } = await supabase
    .from("bookings")
    .select("status")
    .gte("created_at", thirtyDaysAgo.toISOString())
    .returns<{ status: string }[]>();
  if (bookingsErr) logError("dashboard-queries: admin booking status breakdown fetch failed", bookingsErr, { tag: "dashboard-queries" });

  if (!bookings || bookings.length === 0) return [];

  const counts: Record<string, number> = {};
  for (const b of bookings) {
    counts[b.status] = (counts[b.status] ?? 0) + 1;
  }

  return Object.entries(counts)
    .sort((a, b) => b[1] - a[1])
    .map(([status, count]) => {
      const meta = BOOKING_STATUS_COLORS[status];
      const label = meta ? meta[lang] : status;
      const color = meta ? meta.color : "#9CA3AF";
      return { label, value: count, color };
    });
}


export async function getAdminRecentBookings(
  limit = 6,
  lang: Lang = "ar",
): Promise<{ id: string; [key: string]: unknown }[]> {
  const supabase = await createClient();

  // Single round-trip via FK shorthand. Only student name is shown ('assignee').
  type Row = {
    id: string;
    session_type: string;
    amount_usd: number;
    status: string;
    created_at: string;
    student: { full_name: string | null } | null;
  };

  const { data: bookings, error: bookingsErr } = await supabase
    .from("bookings")
    .select(
      "id, session_type, amount_usd, status, created_at, student:profiles!student_id(full_name)",
    )
    .order("created_at", { ascending: false })
    .limit(limit)
    .returns<Row[]>();
  if (bookingsErr) logError("dashboard-queries: admin recent bookings fetch failed", bookingsErr, { tag: "dashboard-queries" });

  if (!bookings || bookings.length === 0) return [];

  return bookings.map((b) => ({
    id: b.id.slice(0, 6).toUpperCase(),
    subject: b.session_type ?? "—",
    date: formatDate(b.created_at, lang),
    progress:
      b.status === "completed"
        ? 100
        : b.status === "confirmed"
          ? 60
          : b.status === "pending"
            ? 30
            : 0,
    assignee: b.student?.full_name ?? "—",
    view: "view",
  }));
}


/**
 * Recitation-standard roster summary for the teacher dashboard.
 *
 * Groups the teacher's students by the qira'a tradition each is
 * studying (hafs / warsh / qalon / al_duri / shu_ba). Source of
 * truth: the most recent student_progress.recitation_standard for
 * each student under this teacher.
 *
 * Returns one row per (standard, count). Students who don't have
 * a recitation_standard set anywhere in their progress show up
 * under "unspecified" — surfacing the gap so the teacher can
 * record it next session.
 *
 * For single-tradition teachers this validates ("all 5 students on
 * hafs"); for multi-tradition teachers this is the at-a-glance
 * split they need before context-switching between students.
 */
export async function getTeacherRecitationStandardRoster(
  supabase: ServerClient,
  teacherId: string,
): Promise<{ standard: string; count: number }[]> {
  // Get the teacher's distinct students with the most recent
  // recitation_standard per student. Two-step: fetch all progress
  // rows for this teacher (sorted recent-first), then dedupe by
  // student_id taking the first standard we see.
  const result = await supabase
    .from("student_progress")
    .select("student_id, recitation_standard")
    .eq("teacher_id", teacherId)
    .order("created_at", { ascending: false })
    .returns<{ student_id: string; recitation_standard: string | null }[]>();
  if (result.error) throw result.error;

  const rows = result.data ?? [];
  if (rows.length === 0) return [];

  const perStudent: Record<string, string | null> = {};
  for (const r of rows) {
    if (!(r.student_id in perStudent)) {
      perStudent[r.student_id] = r.recitation_standard;
    }
  }

  const counts: Record<string, number> = {};
  for (const std of Object.values(perStudent)) {
    const key = std ?? "unspecified";
    counts[key] = (counts[key] ?? 0) + 1;
  }

  return Object.entries(counts)
    .sort((a, b) => b[1] - a[1])
    .map(([standard, count]) => ({ standard, count }));
}

