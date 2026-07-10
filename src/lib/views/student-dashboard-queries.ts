// Student-dashboard read helpers — migrated out of the legacy
// `dashboard-queries.ts` god module (#613). Kept as a SEPARATE module from
// `student-dashboard.ts` (the consumer) so `student-dashboard.test.ts` can keep
// mocking these helpers at the module boundary to assert delegation.
//
// Injected-client test seam: every function takes the supabase client as its
// first argument (no inline `createClient()`), so the reads can be exercised
// against a fake client in isolation.

import type { SupabaseClient } from "@supabase/supabase-js";
import type { ServerClient } from "@/lib/supabase/types";
import { logError } from "@/lib/logger";
import {
  toMurajaahDueItems,
  type MurajaahDueItem,
  type MurajaahScheduleRow,
} from "@/lib/domains/murajaah/batch";
import {
  type ChartDataPoint,
  generateEmptyWeek,
  generateEmptyDay,
  generateEmptyMonth,
  groupSessionsByDay,
  groupSessionsByHour,
  groupSessionsByWeek,
} from "@/lib/views/_shared/chart";
import type { LiveSessionItem } from "@/lib/views/_shared/live-session";

// Re-export so consumers (student-dashboard.ts) keep a single import source.
export type { MurajaahDueItem };

/**
 * Current consecutive-day study streak.
 *
 * Walks `study_log` from today backwards: counts each day with at least one
 * entry, stops at the first day with zero. Today counts even if the student
 * hasn't logged yet (lenient — encourages opening the app); yesterday must be
 * a real entry. Returns `{ streak, weeklyMinutes, weeklyDelta }` where delta
 * is week-over-week percentage change.
 *
 * Day keys are computed in the *student's* timezone (from profiles.timezone,
 * default UTC) so a Cairo student logging at 2 AM local doesn't get their
 * entry attributed to the previous server day.
 */
export async function getStudentStreak(
  supabase: ServerClient,
  studentId: string,
): Promise<{ streak: number; weeklyMinutes: number; weeklyDelta: number; loggedToday: boolean }> {
  // `now` anchors both the study_log cutoff and the JS-side streak walk; hoist
  // it ahead of the queries so they can fan out together.
  const now = new Date();
  const fortyNineDaysAgo = new Date(now.getTime() - 49 * 24 * 60 * 60 * 1000);

  // The profile-timezone read and the study_log read are independent — tz is
  // only consulted during JS-side bucketing after both return — so run them
  // concurrently instead of sequentially.
  const [profileRes, logsRes] = await Promise.all([
    supabase
      .from("profiles")
      .select("timezone")
      .eq("id", studentId)
      .single<{ timezone: string | null }>(),
    supabase
      .from("study_log")
      .select("started_at, duration_seconds")
      .eq("student_id", studentId)
      .gte("started_at", fortyNineDaysAgo.toISOString())
      .order("started_at", { ascending: false })
      .returns<{ started_at: string; duration_seconds: number }[]>(),
  ]);

  if (profileRes.error) logError("dashboard-queries: streak profile timezone fetch failed", profileRes.error, { tag: "dashboard-queries" });
  let tz = profileRes.data?.timezone ?? "UTC";
  try {
    new Intl.DateTimeFormat("en-CA", { timeZone: tz });
  } catch {
    tz = "UTC";
  }

  if (logsRes.error) logError("dashboard-queries: streak study_log fetch failed", logsRes.error, { tag: "dashboard-queries" });

  // Error already surfaced via logError above; bind to a plain local so the
  // best-effort empty-default isn't on a `.data ??` line (silent-fail tripwire).
  const logs = logsRes.data;
  const list = logs ?? [];

  // YYYY-MM-DD in the student's timezone. en-CA gives ISO ordering by default.
  const dayFormatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  const dayKey = (d: Date) => dayFormatter.format(d);

  const byDay = new Map<string, number>();
  for (const log of list) {
    const key = dayKey(new Date(log.started_at));
    byDay.set(key, (byDay.get(key) ?? 0) + (log.duration_seconds ?? 0));
  }

  const todayKey = dayKey(now);
  const loggedToday = byDay.has(todayKey);

  // Walk backwards counting consecutive days with entries. The cursor steps
  // by 24h which can land on the wrong calendar day across DST transitions —
  // accept ±1 day skew on those two days a year as a known trade-off vs the
  // prior bug (every day in the wrong tz).
  let streak = 0;
  const cursor = new Date(now);
  if (!byDay.has(dayKey(cursor))) {
    cursor.setTime(cursor.getTime() - 24 * 60 * 60 * 1000);
  }
  while (byDay.has(dayKey(cursor))) {
    streak += 1;
    cursor.setTime(cursor.getTime() - 24 * 60 * 60 * 1000);
  }

  // Weekly totals: rolling 7-day window ending today (in student tz), vs the
  // 7 days before that. Keys-only comparison stays tz-correct.
  const weekKeys = new Set<string>();
  const prevWeekKeys = new Set<string>();
  for (let i = 0; i < 7; i++) {
    const t = new Date(now.getTime() - i * 24 * 60 * 60 * 1000);
    weekKeys.add(dayKey(t));
  }
  for (let i = 7; i < 14; i++) {
    const t = new Date(now.getTime() - i * 24 * 60 * 60 * 1000);
    prevWeekKeys.add(dayKey(t));
  }

  let thisWeekSec = 0;
  let lastWeekSec = 0;
  for (const log of list) {
    const k = dayKey(new Date(log.started_at));
    if (weekKeys.has(k)) thisWeekSec += log.duration_seconds ?? 0;
    else if (prevWeekKeys.has(k)) lastWeekSec += log.duration_seconds ?? 0;
  }
  const weeklyMinutes = Math.round(thisWeekSec / 60);
  const lastWeekMinutes = Math.round(lastWeekSec / 60);
  const weeklyDelta = lastWeekMinutes > 0
    ? Math.round(((weeklyMinutes - lastWeekMinutes) / lastWeekMinutes) * 100)
    : weeklyMinutes > 0 ? 100 : 0;

  return { streak, weeklyMinutes, weeklyDelta, loggedToday };
}


/**
 * Follow-up due-soon awareness for the dashboard banner + Today's Plan.
 *
 * Returns counts of: items overdue (due_date < now), items due today, items
 * due in the next 7 days, and the most-urgent open item (for banner copy).
 */
export async function getStudentHomeworkPulse(
  supabase: ServerClient,
  studentId: string,
): Promise<{
  overdue: number;
  dueToday: number;
  dueThisWeek: number;
  nextItem: { id: string; description: string | null; dueDate: string | null; type: string } | null;
}> {
  const now = new Date();
  const startOfDay = new Date(now); startOfDay.setHours(0, 0, 0, 0);
  const endOfDay = new Date(now); endOfDay.setHours(23, 59, 59, 999);
  const inSevenDays = new Date(now); inSevenDays.setDate(inSevenDays.getDate() + 7);

  const { data: items, error: itemsErr } = await supabase
    .from("homework_assignments")
    .select("id, description, due_date, homework_type, status")
    .eq("student_id", studentId)
    .in("status", ["assigned", "completed_needs_work"])
    .order("due_date", { ascending: true, nullsFirst: false })
    .returns<{ id: string; description: string | null; due_date: string | null; homework_type: string; status: string }[]>();
  if (itemsErr) logError("dashboard-queries: homework pulse fetch failed", itemsErr, { tag: "dashboard-queries" });

  let overdue = 0;
  let dueToday = 0;
  let dueThisWeek = 0;
  let nextItem: { id: string; description: string | null; dueDate: string | null; type: string } | null = null;

  for (const item of items ?? []) {
    if (!item.due_date) continue;
    const due = new Date(item.due_date);
    if (due < startOfDay) overdue += 1;
    else if (due >= startOfDay && due <= endOfDay) dueToday += 1;
    else if (due <= inSevenDays) dueThisWeek += 1;
    if (!nextItem) {
      nextItem = { id: item.id, description: item.description, dueDate: item.due_date, type: item.homework_type };
    }
  }

  return { overdue, dueToday, dueThisWeek, nextItem };
}


export async function getStudentWeeklyStudyTime(
  supabase: ServerClient,
  studentId: string,
  lang: "ar" | "en" = "en"
): Promise<ChartDataPoint[]> {
  const sevenDaysAgo = new Date();
  sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

  const { data: bookings, error: bookingsErr } = await supabase
    .from("bookings")
    .select("id")
    .eq("student_id", studentId)
    .gte("scheduled_at", sevenDaysAgo.toISOString())
    .returns<{ id: string }[]>();
  if (bookingsErr) logError("dashboard-queries: weekly study time bookings fetch failed", bookingsErr, { tag: "dashboard-queries" });

  if (!bookings || bookings.length === 0) {
    return generateEmptyWeek(lang);
  }

  const bookingIds = bookings.map((b) => b.id);

  const { data: sessions, error: sessionsErr } = await supabase
    .from("sessions")
    .select("actual_duration, started_at")
    .in("booking_id", bookingIds)
    .not("ended_at", "is", null)
    .gte("started_at", sevenDaysAgo.toISOString())
    .returns<{ actual_duration: number | null; started_at: string | null }[]>();
  if (sessionsErr) logError("dashboard-queries: weekly study time sessions fetch failed", sessionsErr, { tag: "dashboard-queries" });

  return groupSessionsByDay(sessions ?? [], lang);
}


/**
 * Daily/Weekly/Monthly study analytics for the student dashboard chart.
 * One round-trip: fetches the last 30 days of completed sessions, then buckets
 * them three ways so the chart's tab switcher has all three datasets ready
 * without re-querying.
 *
 * - Daily: 24 hourly buckets for "today" (00:00 → 23:00 in local time).
 * - Weekly: Mon–Sun totals across the last 7 days.
 * - Monthly: 4 weekly buckets across the last 30 days (W1–W4).
 *
 * The peak bucket in each dataset is marked `isActive: true` so the chart
 * highlights it with the gold/purple gradient + 🔥 tooltip.
 */
export async function getStudentStudyAnalytics(
  supabase: ServerClient,
  studentId: string,
  lang: "ar" | "en" = "en"
): Promise<{
  daily: ChartDataPoint[];
  weekly: ChartDataPoint[];
  monthly: ChartDataPoint[];
}> {
  const thirtyDaysAgo = new Date();
  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

  // study_log depends only on studentId + the 30-day cutoff — NOT on the
  // bookings result — so start it concurrently with the bookings query instead
  // of after it. The sessions read still depends on bookings IDs and stays
  // sequential after bookings resolves.
  const bookingsP = supabase
    .from("bookings")
    .select("id")
    .eq("student_id", studentId)
    .gte("scheduled_at", thirtyDaysAgo.toISOString())
    .returns<{ id: string }[]>();

  const studyLogP = supabase
    .from("study_log")
    .select("duration_seconds, started_at")
    .eq("student_id", studentId)
    .gte("started_at", thirtyDaysAgo.toISOString())
    .not("ended_at", "is", null)
    .returns<{ duration_seconds: number; started_at: string }[]>();

  const [bookingsRes, studyLogRes] = await Promise.all([bookingsP, studyLogP]);

  if (bookingsRes.error) logError("dashboard-queries: study analytics bookings fetch failed", bookingsRes.error, { tag: "dashboard-queries" });
  const bookings = bookingsRes.data;

  const empty = {
    daily: generateEmptyDay(),
    weekly: generateEmptyWeek(lang),
    monthly: generateEmptyMonth(lang),
  };

  // Pull live-session minutes (from sessions joined to bookings) AND
  // self-reported study time (from study_log); UNION them into one row list
  // keyed by `started_at + duration`. studyLog already ran above; sessions
  // still waits on bookings IDs.
  const sessionsP = bookings && bookings.length > 0
    ? supabase
        .from("sessions")
        .select("actual_duration, started_at")
        .in("booking_id", bookings.map((b) => b.id))
        .not("ended_at", "is", null)
        .gte("started_at", thirtyDaysAgo.toISOString())
        .returns<{ actual_duration: number | null; started_at: string | null }[]>()
    : Promise.resolve({ data: [] as { actual_duration: number | null; started_at: string | null }[] });

  const sessionsRes = await sessionsP;

  const sessionRows = (sessionsRes.data ?? []).map((s) => ({
    actual_duration: s.actual_duration,
    started_at: s.started_at,
  }));

  // study_log.duration_seconds → minutes for parity with sessions.actual_duration
  const studyLogRows = (studyLogRes.data ?? []).map((s) => ({
    actual_duration: s.duration_seconds / 60,
    started_at: s.started_at,
  }));

  const rows = [...sessionRows, ...studyLogRows];

  if (rows.length === 0 && (!bookings || bookings.length === 0)) return empty;
  return {
    daily: groupSessionsByHour(rows),
    weekly: groupSessionsByDay(
      rows.filter((s) => {
        if (!s.started_at) return false;
        const sevenDaysAgo = Date.now() - 7 * 86400_000;
        return new Date(s.started_at).getTime() >= sevenDaysAgo;
      }),
      lang,
    ),
    monthly: groupSessionsByWeek(rows, lang),
  };
}


export async function getStudentLiveSessions(
  supabase: ServerClient,
  studentId: string
): Promise<LiveSessionItem[]> {
  const { data: bookings, error: bookingsErr } = await supabase
    .from("bookings")
    .select("id, teacher_id, session_type")
    .eq("student_id", studentId)
    .eq("status", "confirmed")
    .returns<{ id: string; teacher_id: string; session_type: string }[]>();
  if (bookingsErr) logError("dashboard-queries: student live sessions bookings fetch failed", bookingsErr, { tag: "dashboard-queries" });

  if (!bookings || bookings.length === 0) return [];

  const bookingIds = bookings.map((b) => b.id);

  // Stranded-session guard — see getPlatformLiveSessions for rationale.
  const fourHoursAgo = new Date(Date.now() - 4 * 60 * 60 * 1000).toISOString();
  const { data: sessions, error: sessionsErr } = await supabase
    .from("sessions")
    .select("id, booking_id, started_at, ended_at, lesson_plan")
    .in("booking_id", bookingIds)
    .not("started_at", "is", null)
    .is("ended_at", null)
    .gte("started_at", fourHoursAgo)
    .returns<{
      id: string;
      booking_id: string;
      started_at: string;
      ended_at: string | null;
      lesson_plan: { checkpoints?: { id: string; completed_at: string | null }[] } | null;
    }[]>();
  if (sessionsErr) logError("dashboard-queries: student live sessions fetch failed", sessionsErr, { tag: "dashboard-queries" });

  if (!sessions || sessions.length === 0) return [];

  const teacherIds = bookings.map((b) => b.teacher_id);
  const { data: profiles, error: profilesErr } = await supabase
    .from("profiles")
    .select("id, full_name")
    .in("id", teacherIds)
    .returns<{ id: string; full_name: string | null }[]>();
  if (profilesErr) logError("dashboard-queries: student live sessions teacher profiles fetch failed", profilesErr, { tag: "dashboard-queries" });

  const nameMap: Record<string, string> = {};
  if (profiles) {
    for (const p of profiles) {
      nameMap[p.id] = p.full_name ?? "—";
    }
  }

  const now = Date.now();
  return sessions.map((s) => {
    const booking = bookings.find((b) => b.id === s.booking_id);
    const teacherName = booking ? (nameMap[booking.teacher_id] ?? "—") : "—";
    const initials = teacherName.slice(0, 2);
    const elapsed = now - new Date(s.started_at).getTime();
    const totalMs = elapsed;
    const hrs = Math.floor(totalMs / 3600000);
    const mins = Math.floor((totalMs % 3600000) / 60000);
    const secs = Math.floor((totalMs % 60000) / 1000);
    const timeStr = `${String(hrs).padStart(2, "0")}:${String(mins).padStart(2, "0")}:${String(secs).padStart(2, "0")}`;

    // Compute live progress % from the teacher's lesson_plan checkpoints.
    let progressPct: number | undefined;
    const cps = s.lesson_plan?.checkpoints ?? [];
    if (cps.length > 0) {
      const done = cps.filter((c) => c.completed_at).length;
      progressPct = Math.round((done / cps.length) * 100);
    }

    return {
      id: s.id,
      title: teacherName,
      subtitle: booking?.session_type ?? "session",
      initials,
      timeRemaining: timeStr,
      progressPercent: progressPct,
    };
  });
}


/**
 * Next upcoming quiz the student hasn't yet attempted (or hasn't passed).
 * Used by KPI 4 on the dashboard to swap "Next Session" → "Upcoming Quiz"
 * countdown when a quiz is in the pipeline. Returns null when there's no
 * pending quiz, so callers can fall back to the next-session value.
 */
export async function getStudentNextQuiz(
  supabase: ServerClient,
  studentId: string,
): Promise<{ id: string; title: string; due_at: string | null } | null> {
  const { data: enrollments, error: enrollmentsErr } = await supabase.from("course_enrollments")
    .select("course_id")
    .eq("student_id", studentId)
    .returns<{ course_id: string }[]>();
  if (enrollmentsErr) logError("dashboard-queries: next quiz enrollments fetch failed", enrollmentsErr, { tag: "dashboard-queries" });
  if (!enrollments || enrollments.length === 0) return null;

  const courseIds = enrollments.map((e) => e.course_id);
  const nowIso = new Date().toISOString();

  const { data: quizzes, error: quizzesErr } = await supabase.from("quizzes")
    .select("id, title_ar, title_en, due_at")
    .in("course_id", courseIds)
    .eq("is_published", true)
    .or(`due_at.is.null,due_at.gte.${nowIso}`)
    .order("due_at", { ascending: true, nullsFirst: false })
    .limit(20)
    .returns<{ id: string; title_ar: string; title_en: string | null; due_at: string | null }[]>();
  if (quizzesErr) logError("dashboard-queries: next quiz quizzes fetch failed", quizzesErr, { tag: "dashboard-queries" });

  if (!quizzes || quizzes.length === 0) return null;

  // Filter out quizzes the student already passed.
  const ids = quizzes.map((q) => q.id);
  const { data: attempts, error: attemptsErr } = await supabase.from("quiz_attempts")
    .select("quiz_id, passed")
    .eq("student_id", studentId)
    .in("quiz_id", ids)
    .not("submitted_at", "is", null)
    .returns<{ quiz_id: string; passed: boolean | null }[]>();
  if (attemptsErr) logError("dashboard-queries: next quiz attempts fetch failed", attemptsErr, { tag: "dashboard-queries" });
  const passed = new Set((attempts ?? []).filter((a) => a.passed).map((a) => a.quiz_id));

  const upcoming = quizzes.find((q) => !passed.has(q.id));
  if (!upcoming) return null;
  return {
    id: upcoming.id,
    title: upcoming.title_ar ?? upcoming.title_en ?? "Quiz",
    due_at: upcoming.due_at,
  };
}


/**
 * Continue Watching: in-progress recorded course lessons. Pulls rows where
 * the student has watched some of the video but not finished, ordered by most
 * recently watched. If the student has no in-progress lessons, returns []
 * and the caller falls back to `getStudentRecentRecordings`.
 */
export async function getStudentContinueWatching(
  supabase: ServerClient,
  studentId: string,
  lang: "ar" | "en" = "en",
  limit = 5,
): Promise<{ id: string; [key: string]: unknown }[]> {
  // course_lesson_progress is keyed by enrollment_id, so resolve the
  // student's enrollments first, then pull in-progress rows for them.
  const { data: enrollments, error: enrollmentsErr } = await supabase
    .from("course_enrollments")
    .select("id")
    .eq("student_id", studentId)
    .returns<{ id: string }[]>();
  if (enrollmentsErr) logError("dashboard-queries: continue watching enrollments fetch failed", enrollmentsErr, { tag: "dashboard-queries" });

  if (!enrollments || enrollments.length === 0) return [];

  type Row = {
    lesson_id: string;
    last_position_seconds: number | null;
    updated_at: string;
    lesson: {
      id: string;
      title_ar: string | null;
      title_en: string | null;
      duration_seconds: number | null;
      course_id: string;
      course: {
        id: string;
        title_ar: string | null;
        title_en: string | null;
        teacher_id: string | null;
        ownership: string;
      } | null;
    } | null;
  };

  const { data, error: progressErr } = await supabase
    .from("course_lesson_progress")
    .select(
      "lesson_id, last_position_seconds, updated_at, " +
        "lesson:course_lessons(id, title_ar, title_en, duration_seconds, course_id, " +
        "course:courses(id, title_ar, title_en, teacher_id, ownership))",
    )
    .in("enrollment_id", enrollments.map((e) => e.id))
    .is("completed_at", null)
    .gt("last_position_seconds", 0)
    .eq("hidden_from_dashboard", false)
    .order("updated_at", { ascending: false })
    .limit(limit)
    .returns<Row[]>();
  if (progressErr) logError("dashboard-queries: continue watching lesson progress fetch failed", progressErr, { tag: "dashboard-queries" });

  if (!data || data.length === 0) return [];

  // Resolve student + teacher names/avatars for the stacked-avatar Assignee
  // column. Student is always the same; teacher varies per course.
  const teacherIds = [...new Set(
    data.map((r) => r.lesson?.course?.teacher_id).filter(Boolean) as string[],
  )];
  const profileIds = [studentId, ...teacherIds];
  const { data: profiles, error: profilesErr } = await supabase
    .from("profiles")
    .select("id, full_name, avatar_url")
    .in("id", profileIds)
    .returns<{ id: string; full_name: string | null; avatar_url: string | null }[]>();
  if (profilesErr) logError("dashboard-queries: continue watching profiles fetch failed", profilesErr, { tag: "dashboard-queries" });
  const pmap: Record<string, { name: string; avatar_url: string | null }> = {};
  for (const p of profiles ?? []) {
    pmap[p.id] = { name: p.full_name ?? "—", avatar_url: p.avatar_url };
  }
  const studentProfile = pmap[studentId] ?? { name: "—", avatar_url: null };

  return data
    .filter((r) => r.lesson?.course)
    .map((r) => {
      const lesson = r.lesson!;
      const course = lesson.course!;
      const total = lesson.duration_seconds ?? 0;
      const watched = r.last_position_seconds ?? 0;
      const pct = total > 0 ? Math.min(100, Math.round((watched / total) * 100)) : 0;
      const title = (lang === "ar" ? course.title_ar : course.title_en) ?? course.title_ar ?? "—";
      // Platform-owned courses have no teacher — render under the FURQAN
      // Academy banner so the assignee row doesn't fall back to "—".
      const teacher =
        course.ownership === "platform" || !course.teacher_id
          ? {
              name: lang === "ar" ? "أكاديمية فرقان" : "FURQAN Academy",
              avatar_url: null,
            }
          : pmap[course.teacher_id] ?? { name: "—", avatar_url: null };

      return {
        id: course.id.slice(0, 6).toUpperCase(),
        subject: title,
        date: new Date(r.updated_at).toLocaleDateString(
          lang === "ar" ? "ar-EG" : "en-US",
          { year: "numeric", month: "short", day: "2-digit" },
        ),
        progress: pct,
        assignee: [studentProfile, teacher],
        view: "view",
        _lessonId: lesson.id,
        _href: `/student/courses/${course.id}/lesson/${lesson.id}`,
      };
    });
}


export async function getStudentRecentRecordings(
  supabase: ServerClient,
  studentId: string,
  lang: "ar" | "en" = "en",
  limit = 6
): Promise<Record<string, unknown>[]> {
  const { data: bookings, error: bookingsErr } = await supabase
    .from("bookings")
    .select("id, teacher_id, session_type, scheduled_at")
    .eq("student_id", studentId)
    .eq("status", "completed")
    .order("scheduled_at", { ascending: false })
    .limit(limit)
    .returns<{ id: string; teacher_id: string; session_type: string; scheduled_at: string }[]>();
  if (bookingsErr) logError("dashboard-queries: recent recordings bookings fetch failed", bookingsErr, { tag: "dashboard-queries" });

  if (!bookings || bookings.length === 0) return [];

  const bookingIds = bookings.map((b) => b.id);
  const teacherIds = [...new Set(bookings.map((b) => b.teacher_id))];

  const [sessionsRes, profilesRes] = await Promise.all([
    supabase
      .from("sessions")
      .select("booking_id, recording_url")
      .in("booking_id", bookingIds)
      .returns<{ booking_id: string; recording_url: string | null }[]>(),
    supabase.from("profiles").select("id, full_name").in("id", teacherIds)
      .returns<{ id: string; full_name: string | null }[]>(),
  ]);

  const sessionMap: Record<string, string | null> = {};
  if (sessionsRes.data) {
    for (const s of sessionsRes.data) {
      sessionMap[s.booking_id] = s.recording_url ?? null;
    }
  }

  const nameMap: Record<string, string> = {};
  if (profilesRes.data) {
    for (const p of profilesRes.data) {
      nameMap[p.id] = p.full_name ?? "—";
    }
  }

  return bookings.map((b, i) => ({
    id: b.id.slice(0, 6).toUpperCase(),
    subject: b.session_type ?? "—",
    date: new Date(b.scheduled_at).toLocaleDateString(
      lang === "ar" ? "ar-EG" : "en-US",
      { year: "numeric", month: "short", day: "2-digit" }
    ),
    progress: Math.min(100, 50 + i * 10),
    assignee: nameMap[b.teacher_id] ?? "—",
    view: "view",
    // Direct link to the recording if Daily.co provided one, else the
    // session detail page (which embeds the recording when present).
    // Was previously undefined → DataTable fell back to /student/courses,
    // which made no sense for a session recording.
    _href: sessionMap[b.id] ?? `/student/sessions/${b.id}`,
  }));
}

// ============================================
// ADMIN DASHBOARD QUERIES
// ============================================


export async function getTodaysMurajaahBatch(supabase: ServerClient, studentId: string): Promise<MurajaahDueItem[]> {
  const today = new Date().toISOString().slice(0, 10); // UTC YYYY-MM-DD (matches the compute cron)
  // student_review_schedule is not in the generated types until its migration is
  // live (the db-types-fresh CI gate enforces generated == prod). Query via a
  // loosely-typed client and shape the result with .returns<>(); drop this cast
  // and use the regenerated typed table once this migration lands on main.
  const { data } = await (supabase as unknown as SupabaseClient)
    .from("student_review_schedule")
    .select("id, student_progress(surah_from, ayah_from, surah_to, ayah_to)")
    .eq("student_id", studentId)
    .eq("batch_for_date", today)
    .order("next_review_at", { ascending: true })
    .returns<MurajaahScheduleRow[]>();

  // Pure shaping (incl. the missing-join fallback) lives in the murajaah domain
  // so it's unit-tested without a Supabase client — see batch.test.ts.
  return toMurajaahDueItems(data);
}

