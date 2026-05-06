import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { loadOrFail, countOrFail } from "@/lib/supabase/load-or-fail";
import type { SessionType } from "@/types/database";
import { StudentDashboardContent } from "./dashboard-content";
import { DataLoadBanner } from "@/components/shared/data-load-banner";
import {
  getStudentStudyAnalytics,
  getStudentLiveSessions,
  getStudentRecentRecordings,
  getStudentContinueWatching,
  getStudentNextQuiz,
  getStudentStreak,
  getStudentHomeworkPulse,
  getStudentMurajaahPlan,
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

  // loadOrFail: pipe failed reads through Sentry with the dashboard route
  // tagged, so we know WHICH widget tripped (vs Sprint 1.1 which only sees
  // the URL). anyFailed accumulates across the whole page so the banner
  // surfaces even when only one of the loads broke.
  const profileLoad = loadOrFail(profileRes, { full_name: null }, { route: "student-dashboard", widget: "profile" });
  const nextBookingLoad = loadOrFail(nextBookingRes, [], { route: "student-dashboard", widget: "next-booking" });
  const totalLoad = loadOrFail(totalRes, null, { route: "student-dashboard", widget: "total-sessions" });
  const monthLoad = loadOrFail(monthRes, null, { route: "student-dashboard", widget: "month-sessions" });
  const pendingLoad = loadOrFail(pendingRes, null, { route: "student-dashboard", widget: "pending-bookings" });
  let anyFailed = profileLoad.failed || nextBookingLoad.failed || totalLoad.failed || monthLoad.failed || pendingLoad.failed;

  const fullName = profileLoad.data?.full_name ?? null;
  const nextBooking = nextBookingLoad.data[0] ?? null;
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
    // .maybeSingle() — sessions row only exists once the teacher actually
    // starts the call. For a confirmed-but-not-yet-started booking the row
    // is legitimately absent, so 0 rows is a normal "no session yet" state,
    // not an error. .single() throws PGRST116 here (Sentry E4-1A); the
    // surrounding `session?.id ?? null` already expects nullable.
    const { data: session } = await supabase.from("sessions").select("id").eq("booking_id", nextBooking.id).maybeSingle<{ id: string }>();
    sessionId = session?.id ?? null;
  }

  // Parallel: packages + follow-up + dashboard widgets + most-recent learning
  // waypoint (drives the surah breadcrumb above the KPI grid) + streak +
  // follow-up pulse (drives the smart NextActionBanner).
  // Homework status counts via 6 parallel HEAD queries (one per enum value)
  // — replaces an unbounded SELECT-all-rows that scaled with student
  // history. Each count uses a covering index on (student_id, status).
  const HW_STATUSES = [
    "assigned",
    "student_ready",
    "completed_excellent",
    "completed_good",
    "completed_needs_work",
    "completed_not_done",
  ] as const;
  const hwCountsP = Promise.all(
    HW_STATUSES.map(s =>
      supabase.from("homework_assignments")
        .select("id", { count: "exact", head: true })
        .eq("student_id", user.id).eq("status", s)
    )
  );

  const [
    packagesRes, hwCountsRaw, studyAnalytics, liveSessions, continueWatching,
    recentRecordings, nextQuiz, lastProgressRes, streakInfo, homeworkPulse,
    latestEvalRes, murajaahPlan,
  ] = await Promise.all([
    supabase.from("student_packages")
      .select("id, sessions_total, sessions_used, status, expires_at")
      .eq("student_id", user.id).eq("status", "active")
      .returns<{ id: string; sessions_total: number; sessions_used: number; status: string; expires_at: string | null }[]>(),
    hwCountsP,
    getStudentStudyAnalytics(user.id),
    getStudentLiveSessions(user.id),
    getStudentContinueWatching(user.id),
    getStudentRecentRecordings(user.id),
    getStudentNextQuiz(user.id),
    supabase.from("student_progress")
      .select("surah_to, ayah_to, surah_from, ayah_from, level, recitation_standard, created_at")
      .eq("student_id", user.id)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle<{ surah_to: number | null; ayah_to: number | null; surah_from: number | null; ayah_from: number | null; level: string; recitation_standard: string | null; created_at: string }>(),
    getStudentStreak(user.id),
    getStudentHomeworkPulse(user.id),
    // Latest evaluation's next_goals text — drives the "Your focus this
    // week" card. Only next_goals + meta are needed; the full
    // strengths/areas_for_improvement live on /student/progress to avoid duplication.
    supabase.from("session_evaluations")
      .select("next_goals, evaluation_type, created_at")
      .eq("student_id", user.id)
      .not("next_goals", "is", null)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle<{ next_goals: string | null; evaluation_type: string; created_at: string }>(),
    getStudentMurajaahPlan(user.id),
  ]);
  const packagesLoad = loadOrFail(packagesRes, [], { route: "student-dashboard", widget: "active-packages" });
  const lastProgressLoad = loadOrFail(lastProgressRes, null, { route: "student-dashboard", widget: "last-progress" });
  const latestEvalLoad = loadOrFail(latestEvalRes, null, { route: "student-dashboard", widget: "latest-evaluation" });

  // Per-status counts with their own Sentry widget tags — Sentry now reads
  // "student-dashboard.homework-completed_excellent failed" not just
  // "homework-counts failed", so a flaky enum branch surfaces directly.
  const hwCounts: Record<string, number> = {};
  let hwCountsFailed = false;
  HW_STATUSES.forEach((s, i) => {
    const r = countOrFail(hwCountsRaw[i], { route: "student-dashboard", widget: `homework-${s}` });
    hwCounts[s] = r.count;
    if (r.failed) hwCountsFailed = true;
  });

  anyFailed = anyFailed || packagesLoad.failed || hwCountsFailed || lastProgressLoad.failed || latestEvalLoad.failed;

  const activePackages = packagesLoad.data;
  // Continue Watching prefers in-progress course lessons; falls back to recent
  // session recordings so the table is never empty for active students. The
  // boolean lets the client component title the section honestly — calling
  // session recordings "Pick up where you left off" was the source of the
  // /student/courses confusion the audit flagged (P2-3).
  const continueIsLessons = continueWatching.length > 0;
  const watchingRows = continueIsLessons ? continueWatching : recentRecordings;
  const lastProgress = lastProgressLoad.data;
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

  // Today's plan items — sessions today + follow-up due today + quiz due today.
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

  const todaySessionsLoad = loadOrFail(todaySessionsRes, [], { route: "student-dashboard", widget: "today-sessions" });
  const todayHomeworkLoad = loadOrFail(todayHomeworkRes, [], { route: "student-dashboard", widget: "today-homework" });
  anyFailed = anyFailed || todaySessionsLoad.failed || todayHomeworkLoad.failed;
  const todaySessions = todaySessionsLoad.data;
  const todayHomework = todayHomeworkLoad.data;

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
    <>
      <DataLoadBanner failed={anyFailed} />
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
        continueIsLessons,
        hwCounts,
        activePackages: activePackages ?? [],
        nextQuiz,
        lastProgress,
        resumeLesson,
        streakInfo,
        homeworkPulse,
        todaySessions,
        todayHomework,
        latestEvaluation: latestEvalLoad.data,
        murajaahPlan,
        renderedAtMs: now.getTime(),
      }}
    />
    </>
  );
}
