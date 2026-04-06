import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { fetchNameMap } from "@/lib/supabase/helpers";
import { AdminDashboardContent } from "./dashboard-content";

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

  const [studentsRes, teachersRes, bookingsMonthRes, revenueMonthRes, pendingCountRes, pendingListRes, newStudentsRes, todayBookingsRes, activeSessionsRes] = await Promise.all([
    supabase.from("profiles").select("id", { count: "exact", head: true }).eq("role", "student"),
    supabase.from("teacher_profiles").select("teacher_id, hourly_rate, rating_avg, total_sessions, is_accepting, is_archived").order("is_archived", { ascending: true }).order("total_sessions", { ascending: false }).returns<TeacherRow[]>(),
    supabase.from("bookings").select("id", { count: "exact", head: true }).gte("created_at", startOfMonth),
    supabase.from("bookings").select("amount_usd").eq("status", "completed").gte("created_at", startOfMonth).returns<RevenueRow[]>(),
    supabase.from("bookings").select("id", { count: "exact", head: true }).eq("status", "pending"),
    supabase.from("bookings").select("id, student_id, teacher_id, scheduled_at, session_type, created_at").eq("status", "pending").order("created_at", { ascending: false }).limit(5).returns<PendingBookingRow[]>(),
    supabase.from("profiles").select("id", { count: "exact", head: true }).eq("role", "student").gte("created_at", sevenDaysAgo.toISOString()),
    supabase.from("bookings").select("id, student_id, teacher_id, scheduled_at, session_type, status, duration_min").gte("scheduled_at", todayStart).lte("scheduled_at", todayEnd).order("scheduled_at", { ascending: true }).returns<TodayBookingRow[]>(),
    supabase.from("sessions").select("id", { count: "exact", head: true }).not("started_at", "is", null).is("ended_at", null),
  ]);

  const teacherList = teachersRes.data ?? [];
  const pendingBookings = pendingListRes.data ?? [];
  const todayBookings = todayBookingsRes.data ?? [];

  const allIds = new Set<string>();
  for (const t of teacherList) allIds.add(t.teacher_id);
  for (const b of pendingBookings) { allIds.add(b.student_id); allIds.add(b.teacher_id); }
  for (const b of todayBookings) { allIds.add(b.student_id); allIds.add(b.teacher_id); }

  const nameMap = await fetchNameMap(supabase, Array.from(allIds));

  return (
    <AdminDashboardContent
      data={{
        studentCount: studentsRes.count ?? 0,
        teacherList,
        bookingsMonth: bookingsMonthRes.count ?? 0,
        revenueMonth: (revenueMonthRes.data ?? []).reduce((sum, b) => sum + Number(b.amount_usd), 0),
        pendingCount: pendingCountRes.count ?? 0,
        pendingBookings,
        newStudentCount: newStudentsRes.count ?? 0,
        todayBookings,
        activeSessionCount: activeSessionsRes.count ?? 0,
        nameMap,
      }}
    />
  );
}
