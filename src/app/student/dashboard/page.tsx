import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import type { SessionType } from "@/types/database";
import { StudentDashboardContent } from "./dashboard-content";
import {
  getStudentStudyAnalytics,
  getStudentLiveSessions,
  getStudentRecentRecordings,
  getStudentContinueWatching,
} from "@/lib/dashboard-queries";

export const metadata: Metadata = { title: "لوحتي" };

export default async function StudentDashboardPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const monthStart = new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString();

  // Slim KPI queries — recent-sessions + evaluations tables moved off the
  // dashboard (they live at /student/sessions and /student/progress).
  const [profileRes, nextBookingRes, totalRes, monthRes, pendingRes] = await Promise.all([
    supabase.from("profiles").select("full_name").eq("id", user.id).single<{ full_name: string | null }>(),
    supabase.from("bookings")
      .select("id, teacher_id, scheduled_at, duration_min, session_type, status")
      .eq("student_id", user.id).eq("status", "confirmed")
      .gt("scheduled_at", new Date().toISOString())
      .order("scheduled_at", { ascending: true }).limit(1)
      .returns<{ id: string; teacher_id: string; scheduled_at: string; duration_min: number; session_type: SessionType }[]>(),
    supabase.from("bookings").select("id", { count: "exact", head: true }).eq("student_id", user.id).eq("status", "completed"),
    supabase.from("bookings").select("id", { count: "exact", head: true }).eq("student_id", user.id).eq("status", "completed").gte("created_at", monthStart),
    supabase.from("bookings").select("id", { count: "exact", head: true }).eq("student_id", user.id).eq("status", "pending"),
  ]);

  const fullName = profileRes.data?.full_name ?? null;
  const nextBooking = (nextBookingRes.data ?? [])[0] ?? null;
  const totalSessions = totalRes.count ?? 0;
  const monthSessions = monthRes.count ?? 0;
  const pendingBookings = pendingRes.count ?? 0;

  // New students with no activity → guide them to teachers page
  if (totalSessions === 0 && pendingBookings === 0 && !nextBooking) {
    redirect("/student/teachers?new=1");
  }

  // Only the next-session teacher name is shown above the fold; trim the
  // teacher-name fan-out that the old recent + evaluations tables required.
  const nameMap: Record<string, string> = {};
  if (nextBooking?.teacher_id) {
    const { data: profile } = await supabase.from("profiles")
      .select("full_name").eq("id", nextBooking.teacher_id)
      .single<{ full_name: string | null }>();
    if (profile?.full_name) nameMap[nextBooking.teacher_id] = profile.full_name;
  }

  let sessionId: string | null = null;
  if (nextBooking) {
    const { data: session } = await supabase.from("sessions").select("id").eq("booking_id", nextBooking.id).single<{ id: string }>();
    sessionId = session?.id ?? null;
  }

  // Parallel: packages + homework + dashboard widgets (all independent)
  const [packagesRes, hwRawRes, studyAnalytics, liveSessions, continueWatching, recentRecordings] = await Promise.all([
    supabase.from("student_packages")
      .select("id, sessions_total, sessions_used, status, expires_at")
      .eq("student_id", user.id).eq("status", "active")
      .returns<{ id: string; sessions_total: number; sessions_used: number; status: string; expires_at: string | null }[]>(),
    supabase.from("homework_assignments")
      .select("status").eq("student_id", user.id)
      .returns<{ status: string }[]>(),
    getStudentStudyAnalytics(user.id),
    getStudentLiveSessions(user.id),
    getStudentContinueWatching(user.id),
    getStudentRecentRecordings(user.id),
  ]);
  const activePackages = packagesRes.data ?? [];
  const hwCounts: Record<string, number> = {};
  for (const h of hwRawRes.data ?? []) {
    hwCounts[h.status] = (hwCounts[h.status] ?? 0) + 1;
  }
  // Continue Watching prefers in-progress course lessons; falls back to recent
  // session recordings so the table is never empty for active students.
  const watchingRows = continueWatching.length > 0 ? continueWatching : recentRecordings;

  return (
    <StudentDashboardContent
      data={{
        fullName,
        nextBooking,
        sessionId,
        totalSessions,
        monthSessions,
        pendingBookings,
        nameMap,
        studyAnalytics,
        liveSessions,
        watchingRows,
        hwCounts,
        activePackages: activePackages ?? [],
      }}
    />
  );
}
