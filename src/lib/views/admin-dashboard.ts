// Admin dashboard reads — migrated out of the legacy dashboard-queries.ts god
// module (#613). These use createClient() internally (not an injected seam),
// matching their original shape.

import { createClient } from "@/lib/supabase/server";
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

