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
  getStudentNextQuiz,
  getStudentStreak,
  getStudentHomeworkPulse,
} from "@/lib/dashboard-queries";

export const metadata: Metadata = { title: "لوحتي" };

interface PageProps {
  searchParams: Promise<{ year?: string }>;
}

export default async function StudentDashboardPage({ searchParams }: PageProps) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const sp = await searchParams;
  const now = new Date();
  const currentYear = now.getFullYear();
  const selectedYear = Number(sp.year) || currentYear;
  const isCurrentYear = selectedYear === currentYear;

  // When the topbar year filter selects a non-current year, scope ALL counts
  // and the "this month" widget to that year (Jan 1 → Dec 31 of selectedYear).
  const yearStart = new Date(selectedYear, 0, 1).toISOString();
  const yearEnd = new Date(selectedYear, 11, 31, 23, 59, 59).toISOString();
  const monthStart = isCurrentYear
    ? new Date(currentYear, now.getMonth(), 1).toISOString()
    : yearStart;
  const monthEnd = isCurrentYear ? undefined : yearEnd;

  // Slim KPI queries — recent-sessions + evaluations tables moved off the
  // dashboard (they live at /student/sessions and /student/progress).
  const totalQ = supabase.from("bookings").select("id", { count: "exact", head: true })
    .eq("student_id", user.id).eq("status", "completed");
  const totalQScoped = isCurrentYear
    ? totalQ
    : totalQ.gte("created_at", yearStart).lte("created_at", yearEnd);

  let monthQ = supabase.from("bookings").select("id", { count: "exact", head: true })
    .eq("student_id", user.id).eq("status", "completed").gte("created_at", monthStart);
  if (monthEnd) monthQ = monthQ.lte("created_at", monthEnd);

  const [profileRes, nextBookingRes, totalRes, monthRes, pendingRes] = await Promise.all([
    supabase.from("profiles").select("full_name").eq("id", user.id).single<{ full_name: string | null }>(),
    supabase.from("bookings")
      .select("id, teacher_id, scheduled_at, duration_min, session_type, status")
      .eq("student_id", user.id).eq("status", "confirmed")
      .gt("scheduled_at", new Date().toISOString())
      .order("scheduled_at", { ascending: true }).limit(1)
      .returns<{ id: string; teacher_id: string; scheduled_at: string; duration_min: number; session_type: SessionType }[]>(),
    totalQScoped,
    monthQ,
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

  // Parallel: packages + homework + dashboard widgets + most-recent learning
  // waypoint (drives the surah breadcrumb above the KPI grid) + streak +
  // homework pulse (drives the smart NextActionBanner).
  const [
    packagesRes, hwRawRes, studyAnalytics, liveSessions, continueWatching,
    recentRecordings, nextQuiz, lastProgressRes, streakInfo, homeworkPulse,
  ] = await Promise.all([
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
    getStudentNextQuiz(user.id),
    supabase.from("student_progress")
      .select("surah_to, ayah_to, surah_from, ayah_from, level, created_at")
      .eq("student_id", user.id)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle<{ surah_to: number | null; ayah_to: number | null; surah_from: number | null; ayah_from: number | null; level: string; created_at: string }>(),
    getStudentStreak(user.id),
    getStudentHomeworkPulse(user.id),
  ]);
  const activePackages = packagesRes.data ?? [];
  const hwCounts: Record<string, number> = {};
  for (const h of hwRawRes.data ?? []) {
    hwCounts[h.status] = (hwCounts[h.status] ?? 0) + 1;
  }
  // Continue Watching prefers in-progress course lessons; falls back to recent
  // session recordings so the table is never empty for active students.
  const watchingRows = continueWatching.length > 0 ? continueWatching : recentRecordings;
  const lastProgress = lastProgressRes.data ?? null;
  const resumeLessonRow = continueWatching.find(r => r._lessonId && typeof r.progress === "number") as
    | { _lessonId: string; _href: string; subject: string; progress: number }
    | undefined;
  const resumeLesson = resumeLessonRow
    ? {
        lessonId: resumeLessonRow._lessonId,
        title: resumeLessonRow.subject,
        href: resumeLessonRow._href,
        progressPct: Math.round(resumeLessonRow.progress),
      }
    : null;

  // Today's plan items — sessions today + homework due today + quiz due today.
  // Built server-side so the widget never re-queries client-side.
  const todayStart = new Date(); todayStart.setHours(0, 0, 0, 0);
  const todayEnd = new Date(); todayEnd.setHours(23, 59, 59, 999);

  const [todaySessionsRes, todayHomeworkRes] = await Promise.all([
    supabase.from("bookings")
      .select("id, teacher_id, scheduled_at, duration_min, session_type, status")
      .eq("student_id", user.id).eq("status", "confirmed")
      .gte("scheduled_at", todayStart.toISOString()).lte("scheduled_at", todayEnd.toISOString())
      .order("scheduled_at", { ascending: true })
      .returns<{ id: string; teacher_id: string; scheduled_at: string; duration_min: number; session_type: string; status: string }[]>(),
    supabase.from("homework_assignments")
      .select("id, description, due_date, homework_type, status")
      .eq("student_id", user.id)
      .in("status", ["assigned", "completed_needs_work"])
      .gte("due_date", todayStart.toISOString()).lte("due_date", todayEnd.toISOString())
      .order("due_date", { ascending: true })
      .returns<{ id: string; description: string | null; due_date: string | null; homework_type: string; status: string }[]>(),
  ]);

  const todaySessions = todaySessionsRes.data ?? [];
  const todayHomework = todayHomeworkRes.data ?? [];

  // Resolve teacher names for today's sessions (only if not already in nameMap).
  const todayTeacherIds = todaySessions
    .map(s => s.teacher_id)
    .filter(id => !nameMap[id]);
  if (todayTeacherIds.length > 0) {
    const { data: teachers } = await supabase
      .from("profiles").select("id, full_name")
      .in("id", todayTeacherIds)
      .returns<{ id: string; full_name: string | null }[]>();
    for (const t of teachers ?? []) {
      if (t.full_name) nameMap[t.id] = t.full_name;
    }
  }

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
        nextQuiz,
        lastProgress,
        resumeLesson,
        streakInfo,
        homeworkPulse,
        todaySessions,
        todayHomework,
      }}
    />
  );
}
