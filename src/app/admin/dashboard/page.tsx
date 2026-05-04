import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { fetchNameMap } from "@/lib/supabase/helpers";
import { withTimeout } from "@/lib/promise-utils";
import { AdminDashboardContent } from "./dashboard-content";
import {
  getAdminDailyRevenue,
  getAdminLiveSessions,
  getAdminBookingStatusBreakdown,
  getAdminRecentBookings,
  getAdminMonthlyRevenueTrend,
} from "@/lib/dashboard-queries";

// Per-query timeout for the dashboard fan-out. If any single query hangs
// (slow Postgres plan, RLS recursion, hot lock), the page renders with that
// widget's empty state instead of holding the whole render hostage forever.
// Sentry sees the timeout under tag `query-timeout` so we can root-cause.
const DASHBOARD_QUERY_TIMEOUT_MS = 5000;

export const metadata: Metadata = { title: "لوحة الإدارة" };

interface TeacherRow { teacher_id: string; hourly_rate: number; rating_avg: number; total_sessions: number; is_accepting: boolean; is_archived: boolean }
interface PendingBookingRow { id: string; student_id: string; teacher_id: string; scheduled_at: string; session_type: string; created_at: string }
interface TodayBookingRow { id: string; student_id: string; teacher_id: string; scheduled_at: string; session_type: string; status: string; duration_min: number }
interface RevenueRow { amount_usd: number }


export default async function AdminDashboardPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const now = new Date();
  const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();
  const sevenDaysAgo = new Date(now); sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString();
  const todayEnd = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59, 999).toISOString();

  // Single fan-out: all 14 independent queries race from t=0. Previously the
  // 5 helper queries (dailyRevenue, liveSessions, breakdown, recent, trend)
  // waited for the first batch + fetchNameMap to finish — none of them
  // actually depended on that data. Merging shaves the slowest-of-9 +
  // slowest-of-5 cost down to slowest-of-14.
  //
  // Each query is wrapped in `withTimeout` so a single hung query can no
  // longer hold the whole page render hostage (incident 2026-05-04: post-auth
  // /admin/dashboard hung for 1+ user). On timeout/error each entry resolves
  // to its empty fallback; the existing `?? 0` / `?? []` null-coalescing in
  // the render call below keeps the page intact, just with that widget empty.
  const [
    studentsRes,
    teachersRes,
    bookingsMonthRes,
    revenueMonthRes,
    pendingCountRes,
    pendingListRes,
    newStudentsRes,
    todayBookingsRes,
    activeSessionsRes,
    dailyRevenue,
    adminLiveSessions,
    bookingBreakdown,
    recentBookings,
    revenueTrend,
  ] = await Promise.all([
    withTimeout(supabase.from("profiles").select("id", { count: "exact", head: true }).eq("role", "student"), DASHBOARD_QUERY_TIMEOUT_MS, { count: 0 } as never, "studentsRes"),
    withTimeout(supabase.from("teacher_profiles").select("teacher_id, hourly_rate, rating_avg, total_sessions, is_accepting, is_archived").order("is_archived", { ascending: true }).order("total_sessions", { ascending: false }).returns<TeacherRow[]>(), DASHBOARD_QUERY_TIMEOUT_MS, { data: [] } as never, "teachersRes"),
    withTimeout(supabase.from("bookings").select("id", { count: "exact", head: true }).gte("created_at", startOfMonth), DASHBOARD_QUERY_TIMEOUT_MS, { count: 0 } as never, "bookingsMonthRes"),
    withTimeout(supabase.from("bookings").select("amount_usd").eq("status", "completed").gte("created_at", startOfMonth).returns<RevenueRow[]>(), DASHBOARD_QUERY_TIMEOUT_MS, { data: [] } as never, "revenueMonthRes"),
    withTimeout(supabase.from("bookings").select("id", { count: "exact", head: true }).eq("status", "pending"), DASHBOARD_QUERY_TIMEOUT_MS, { count: 0 } as never, "pendingCountRes"),
    withTimeout(supabase.from("bookings").select("id, student_id, teacher_id, scheduled_at, session_type, created_at").eq("status", "pending").order("created_at", { ascending: false }).limit(5).returns<PendingBookingRow[]>(), DASHBOARD_QUERY_TIMEOUT_MS, { data: [] } as never, "pendingListRes"),
    withTimeout(supabase.from("profiles").select("id", { count: "exact", head: true }).eq("role", "student").gte("created_at", sevenDaysAgo.toISOString()), DASHBOARD_QUERY_TIMEOUT_MS, { count: 0 } as never, "newStudentsRes"),
    withTimeout(supabase.from("bookings").select("id, student_id, teacher_id, scheduled_at, session_type, status, duration_min").gte("scheduled_at", todayStart).lte("scheduled_at", todayEnd).order("scheduled_at", { ascending: true }).returns<TodayBookingRow[]>(), DASHBOARD_QUERY_TIMEOUT_MS, { data: [] } as never, "todayBookingsRes"),
    withTimeout(supabase.from("sessions").select("id", { count: "exact", head: true }).not("started_at", "is", null).is("ended_at", null), DASHBOARD_QUERY_TIMEOUT_MS, { count: 0 } as never, "activeSessionsRes"),
    withTimeout(getAdminDailyRevenue(), DASHBOARD_QUERY_TIMEOUT_MS, [], "dailyRevenue"),
    withTimeout(getAdminLiveSessions(), DASHBOARD_QUERY_TIMEOUT_MS, [], "adminLiveSessions"),
    withTimeout(getAdminBookingStatusBreakdown(), DASHBOARD_QUERY_TIMEOUT_MS, [], "bookingBreakdown"),
    withTimeout(getAdminRecentBookings(), DASHBOARD_QUERY_TIMEOUT_MS, [], "recentBookings"),
    withTimeout(getAdminMonthlyRevenueTrend(), DASHBOARD_QUERY_TIMEOUT_MS, { currentMonthUsd: 0, previousMonthUsd: 0, changePct: 0 }, "revenueTrend"),
  ]);

  const teacherList = teachersRes.data ?? [];
  const pendingBookings = pendingListRes.data ?? [];
  const todayBookings = todayBookingsRes.data ?? [];

  const allIds = new Set<string>();
  for (const t of teacherList) allIds.add(t.teacher_id);
  for (const b of pendingBookings) { allIds.add(b.student_id); allIds.add(b.teacher_id); }
  for (const b of todayBookings) { allIds.add(b.student_id); allIds.add(b.teacher_id); }

  // nameMap genuinely depends on the IDs above — kept sequential. Wrapped
  // in withTimeout for the same reason as the fan-out: a hung name lookup
  // shouldn't block the page.
  const nameMap = await withTimeout(
    fetchNameMap(supabase, Array.from(allIds)),
    DASHBOARD_QUERY_TIMEOUT_MS,
    {} as Awaited<ReturnType<typeof fetchNameMap>>,
    "nameMap",
  );

  return (
    <AdminDashboardContent
      data={{
        studentCount: studentsRes.count ?? 0,
        teacherList,
        bookingsMonth: bookingsMonthRes.count ?? 0,
        revenueMonth: (revenueMonthRes.data ?? []).reduce((sum, b) => sum + Number(b.amount_usd), 0),
        revenueTrend,
        pendingCount: pendingCountRes.count ?? 0,
        pendingBookings,
        newStudentCount: newStudentsRes.count ?? 0,
        todayBookings,
        activeSessionCount: activeSessionsRes.count ?? 0,
        renderedAtMs: now.getTime(),
        nameMap,
        dailyRevenue,
        adminLiveSessions,
        bookingBreakdown,
        recentBookings,
      }}
    />
  );
}
