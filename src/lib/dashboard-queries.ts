import { createClient } from "@/lib/supabase/server";

interface ChartDataPoint {
  day: string;
  value: number;
  isActive: boolean;
}

interface LiveSessionItem {
  id: string;
  title: string;
  subtitle: string;
  initials: string;
  timeRemaining?: string;
  progressPercent?: number;
}

const EN_DAYS = ["Sun", "Mon", "Tues", "Wed", "Thurs", "Fri", "Sat"];
const AR_DAYS = ["أحد", "إثنين", "ثلاثاء", "أربعاء", "خميس", "جمعة", "سبت"];

function generateEmptyWeek(lang: "ar" | "en" = "en"): ChartDataPoint[] {
  const days = lang === "ar" ? AR_DAYS : EN_DAYS;
  // Start from Monday
  const order = [1, 2, 3, 4, 5, 6, 0];
  return order.map((i) => ({ day: days[i], value: 0, isActive: false }));
}

function groupSessionsByDay(
  sessions: { actual_duration: number | null; started_at: string | null }[],
  lang: "ar" | "en" = "en"
): ChartDataPoint[] {
  const days = lang === "ar" ? AR_DAYS : EN_DAYS;
  const order = [1, 2, 3, 4, 5, 6, 0]; // Mon–Sun
  const buckets: Record<number, number> = {};
  for (const s of sessions) {
    if (!s.started_at) continue;
    const dayIndex = new Date(s.started_at).getDay();
    const hours = (s.actual_duration ?? 0) / 60;
    buckets[dayIndex] = (buckets[dayIndex] ?? 0) + hours;
  }

  const result = order.map((i) => ({
    day: days[i],
    value: Math.round((buckets[i] ?? 0) * 10) / 10,
    isActive: false,
  }));

  // Mark highest value day as active
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
  studentId: string,
): Promise<{ streak: number; weeklyMinutes: number; weeklyDelta: number; loggedToday: boolean }> {
  const supabase = await createClient();

  // Resolve the student's preferred timezone — defaults to UTC if missing or
  // if Intl rejects the value. Using the student's tz aligns "today" with
  // their local midnight, not the Vercel region's.
  const { data: prof } = await supabase
    .from("profiles")
    .select("timezone")
    .eq("id", studentId)
    .single<{ timezone: string | null }>();
  let tz = prof?.timezone ?? "UTC";
  try {
    new Intl.DateTimeFormat("en-CA", { timeZone: tz });
  } catch {
    tz = "UTC";
  }

  const now = new Date();
  const fortyNineDaysAgo = new Date(now.getTime() - 49 * 24 * 60 * 60 * 1000);

  const { data: logs } = await supabase
    .from("study_log")
    .select("started_at, duration_seconds")
    .eq("student_id", studentId)
    .gte("started_at", fortyNineDaysAgo.toISOString())
    .order("started_at", { ascending: false })
    .returns<{ started_at: string; duration_seconds: number }[]>();

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
 * Homework due-soon awareness for the dashboard banner + Today's Plan.
 *
 * Returns counts of: items overdue (due_date < now), items due today, items
 * due in the next 7 days, and the most-urgent open item (for banner copy).
 */
export async function getStudentHomeworkPulse(
  studentId: string,
): Promise<{
  overdue: number;
  dueToday: number;
  dueThisWeek: number;
  nextItem: { id: string; description: string | null; dueDate: string | null; type: string } | null;
}> {
  const supabase = await createClient();
  const now = new Date();
  const startOfDay = new Date(now); startOfDay.setHours(0, 0, 0, 0);
  const endOfDay = new Date(now); endOfDay.setHours(23, 59, 59, 999);
  const inSevenDays = new Date(now); inSevenDays.setDate(inSevenDays.getDate() + 7);

  const { data: items } = await supabase
    .from("homework_assignments")
    .select("id, description, due_date, homework_type, status")
    .eq("student_id", studentId)
    .in("status", ["assigned", "completed_needs_work"])
    .order("due_date", { ascending: true, nullsFirst: false })
    .returns<{ id: string; description: string | null; due_date: string | null; homework_type: string; status: string }[]>();

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
  studentId: string,
  lang: "ar" | "en" = "en"
): Promise<ChartDataPoint[]> {
  const supabase = await createClient();
  const sevenDaysAgo = new Date();
  sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

  const { data: bookings } = await supabase
    .from("bookings")
    .select("id")
    .eq("student_id", studentId)
    .gte("scheduled_at", sevenDaysAgo.toISOString())
    .returns<{ id: string }[]>();

  if (!bookings || bookings.length === 0) {
    return generateEmptyWeek(lang);
  }

  const bookingIds = bookings.map((b) => b.id);

  const { data: sessions } = await supabase
    .from("sessions")
    .select("actual_duration, started_at")
    .in("booking_id", bookingIds)
    .not("ended_at", "is", null)
    .gte("started_at", sevenDaysAgo.toISOString())
    .returns<{ actual_duration: number | null; started_at: string | null }[]>();

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
  studentId: string,
  lang: "ar" | "en" = "en"
): Promise<{
  daily: ChartDataPoint[];
  weekly: ChartDataPoint[];
  monthly: ChartDataPoint[];
}> {
  const supabase = await createClient();
  const thirtyDaysAgo = new Date();
  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

  const { data: bookings } = await supabase
    .from("bookings")
    .select("id")
    .eq("student_id", studentId)
    .gte("scheduled_at", thirtyDaysAgo.toISOString())
    .returns<{ id: string }[]>();

  const empty = {
    daily: generateEmptyDay(),
    weekly: generateEmptyWeek(lang),
    monthly: generateEmptyMonth(lang),
  };

  // Pull live-session minutes (from sessions joined to bookings) AND
  // self-reported study time (from study_log) in parallel; UNION them
  // into one row list keyed by `started_at + duration`.
  const sessionsP = bookings && bookings.length > 0
    ? supabase
        .from("sessions")
        .select("actual_duration, started_at")
        .in("booking_id", bookings.map((b) => b.id))
        .not("ended_at", "is", null)
        .gte("started_at", thirtyDaysAgo.toISOString())
        .returns<{ actual_duration: number | null; started_at: string | null }[]>()
    : Promise.resolve({ data: [] as { actual_duration: number | null; started_at: string | null }[] });

  const studyLogP = supabase
    .from("study_log")
    .select("duration_seconds, started_at")
    .eq("student_id", studentId)
    .gte("started_at", thirtyDaysAgo.toISOString())
    .not("ended_at", "is", null)
    .returns<{ duration_seconds: number; started_at: string }[]>();

  const [sessionsRes, studyLogRes] = await Promise.all([sessionsP, studyLogP]);

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

function generateEmptyDay(): ChartDataPoint[] {
  // 8 buckets covering waking hours 8am–10pm in 2h steps; matches typical
  // study-session granularity better than 24 buckets and keeps bar widths
  // legible on mobile.
  const labels = ["8a", "10a", "12p", "2p", "4p", "6p", "8p", "10p"];
  return labels.map((day) => ({ day, value: 0, isActive: false }));
}

function generateEmptyMonth(lang: "ar" | "en"): ChartDataPoint[] {
  const labels = lang === "ar"
    ? ["أ1", "أ2", "أ3", "أ4"]
    : ["W1", "W2", "W3", "W4"];
  return labels.map((day) => ({ day, value: 0, isActive: false }));
}

function groupSessionsByHour(
  sessions: { actual_duration: number | null; started_at: string | null }[],
): ChartDataPoint[] {
  const labels = ["8a", "10a", "12p", "2p", "4p", "6p", "8p", "10p"];
  const buckets = labels.map(() => 0);

  // Only count "today" sessions
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const tomorrow = new Date(today);
  tomorrow.setDate(tomorrow.getDate() + 1);

  for (const s of sessions) {
    if (!s.started_at) continue;
    const d = new Date(s.started_at);
    if (d < today || d >= tomorrow) continue;
    const hour = d.getHours();
    // Bucket into the closest 2h slot starting at 8am
    const slot = Math.max(0, Math.min(7, Math.floor((hour - 8) / 2)));
    buckets[slot] += (s.actual_duration ?? 0) / 60;
  }

  const result = buckets.map((value, i) => ({
    day: labels[i],
    value: Math.round(value * 10) / 10,
    isActive: false,
  }));
  markPeak(result);
  return result;
}

function groupSessionsByWeek(
  sessions: { actual_duration: number | null; started_at: string | null }[],
  lang: "ar" | "en",
): ChartDataPoint[] {
  const labels = lang === "ar"
    ? ["أ1", "أ2", "أ3", "أ4"]
    : ["W1", "W2", "W3", "W4"];
  const buckets = [0, 0, 0, 0];
  const now = Date.now();

  for (const s of sessions) {
    if (!s.started_at) continue;
    const ageDays = (now - new Date(s.started_at).getTime()) / 86400_000;
    if (ageDays < 0 || ageDays >= 28) continue;
    const week = Math.min(3, Math.floor(ageDays / 7)); // 0=this week, 3=4 weeks ago
    // Reverse so W1 is oldest, W4 is newest
    buckets[3 - week] += (s.actual_duration ?? 0) / 60;
  }

  const result = buckets.map((value, i) => ({
    day: labels[i],
    value: Math.round(value * 10) / 10,
    isActive: false,
  }));
  markPeak(result);
  return result;
}

function markPeak(rows: ChartDataPoint[]): void {
  let maxVal = 0;
  let maxIdx = -1;
  for (let i = 0; i < rows.length; i++) {
    if (rows[i].value > maxVal) {
      maxVal = rows[i].value;
      maxIdx = i;
    }
  }
  if (maxIdx >= 0) rows[maxIdx].isActive = true;
}

export async function getStudentLiveSessions(
  studentId: string
): Promise<LiveSessionItem[]> {
  const supabase = await createClient();

  const { data: bookings } = await supabase
    .from("bookings")
    .select("id, teacher_id, session_type")
    .eq("student_id", studentId)
    .eq("status", "confirmed")
    .returns<{ id: string; teacher_id: string; session_type: string }[]>();

  if (!bookings || bookings.length === 0) return [];

  const bookingIds = bookings.map((b) => b.id);

  // Stranded-session guard — see getAdminLiveSessions for rationale.
  const fourHoursAgo = new Date(Date.now() - 4 * 60 * 60 * 1000).toISOString();
  const { data: sessions } = await supabase
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

  if (!sessions || sessions.length === 0) return [];

  const teacherIds = bookings.map((b) => b.teacher_id);
  const { data: profiles } = await supabase
    .from("profiles")
    .select("id, full_name")
    .in("id", teacherIds)
    .returns<{ id: string; full_name: string | null }[]>();

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
  studentId: string,
): Promise<{ id: string; title: string; due_at: string | null } | null> {
  const supabase = await createClient();
  const { data: enrollments } = await supabase.from("course_enrollments")
    .select("course_id")
    .eq("student_id", studentId)
    .returns<{ course_id: string }[]>();
  if (!enrollments || enrollments.length === 0) return null;

  const courseIds = enrollments.map((e) => e.course_id);
  const nowIso = new Date().toISOString();

  const { data: quizzes } = await supabase.from("quizzes")
    .select("id, title_ar, title_en, due_at")
    .in("course_id", courseIds)
    .eq("is_published", true)
    .or(`due_at.is.null,due_at.gte.${nowIso}`)
    .order("due_at", { ascending: true, nullsFirst: false })
    .limit(20)
    .returns<{ id: string; title_ar: string; title_en: string | null; due_at: string | null }[]>();

  if (!quizzes || quizzes.length === 0) return null;

  // Filter out quizzes the student already passed.
  const ids = quizzes.map((q) => q.id);
  const { data: attempts } = await supabase.from("quiz_attempts")
    .select("quiz_id, passed")
    .eq("student_id", studentId)
    .in("quiz_id", ids)
    .not("submitted_at", "is", null)
    .returns<{ quiz_id: string; passed: boolean | null }[]>();
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
 * Murajaah daily plan for the student dashboard.
 *
 * Surfaces the most recently memorized portion in three trailing windows so
 * the student gets a daily review prompt scaffolded by the classical
 * memorize-then-revisit pattern (the heart of hifz):
 *
 *   - yesterday   = entries with progress_type='new' from the past 24h
 *   - lastWeek    = entries with progress_type='new' from 2-7 days ago
 *   - lastMonth   = entries with progress_type='new' from 8-30 days ago
 *
 * `reviewedToday` is true when the student has already logged a study_log
 * entry today with kind='review' OR a student_progress row today with
 * progress_type='muraja'. The dashboard hides the Murajaah prompt when
 * either condition holds — its job is done for the day.
 *
 * Cadence chosen with the user (Phase B kickoff): always show all three
 * windows. Three review touches > one adaptive prompt the student can't
 * predict.
 */
export type MurajaahWindow = {
  progressId: string;
  surahFrom: number | null;
  surahTo: number | null;
  ayahFrom: number | null;
  ayahTo: number | null;
  loggedAt: string; // ISO
};

export async function getStudentMurajaahPlan(
  studentId: string,
): Promise<{
  yesterday: MurajaahWindow | null;
  lastWeek: MurajaahWindow | null;
  lastMonth: MurajaahWindow | null;
  reviewedToday: boolean;
}> {
  const supabase = await createClient();
  const now = Date.now();
  const dayMs = 86400_000;

  // Window boundaries (lower-inclusive, upper-exclusive of now-N*day).
  const yesterdayStart = new Date(now - 1 * dayMs).toISOString();
  const lastWeekStart = new Date(now - 7 * dayMs).toISOString();
  const lastWeekEnd = new Date(now - 1 * dayMs).toISOString(); // back through 24h ago
  const lastMonthStart = new Date(now - 30 * dayMs).toISOString();
  const lastMonthEnd = new Date(now - 7 * dayMs).toISOString();

  // Today's start in local time, used for the "reviewed today" check.
  const todayStart = new Date(now);
  todayStart.setHours(0, 0, 0, 0);
  const todayStartIso = todayStart.toISOString();

  type Row = {
    id: string;
    surah_from: number | null;
    surah_to: number | null;
    ayah_from: number | null;
    ayah_to: number | null;
    created_at: string;
  };

  const select = "id, surah_from, surah_to, ayah_from, ayah_to, created_at";

  const [yesterdayRes, lastWeekRes, lastMonthRes, reviewedProgressRes, reviewedStudyRes] =
    await Promise.all([
      supabase
        .from("student_progress")
        .select(select)
        .eq("student_id", studentId)
        .eq("progress_type", "new")
        .gte("created_at", yesterdayStart)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle<Row>(),
      supabase
        .from("student_progress")
        .select(select)
        .eq("student_id", studentId)
        .eq("progress_type", "new")
        .gte("created_at", lastWeekStart)
        .lt("created_at", lastWeekEnd)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle<Row>(),
      supabase
        .from("student_progress")
        .select(select)
        .eq("student_id", studentId)
        .eq("progress_type", "new")
        .gte("created_at", lastMonthStart)
        .lt("created_at", lastMonthEnd)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle<Row>(),
      supabase
        .from("student_progress")
        .select("id", { count: "exact", head: true })
        .eq("student_id", studentId)
        .eq("progress_type", "muraja")
        .gte("created_at", todayStartIso),
      supabase
        .from("study_log")
        .select("id", { count: "exact", head: true })
        .eq("student_id", studentId)
        .eq("kind", "review")
        .gte("started_at", todayStartIso),
    ]);

  const toWindow = (r: Row | null): MurajaahWindow | null =>
    r
      ? {
          progressId: r.id,
          surahFrom: r.surah_from,
          surahTo: r.surah_to,
          ayahFrom: r.ayah_from,
          ayahTo: r.ayah_to,
          loggedAt: r.created_at,
        }
      : null;

  const reviewedToday =
    (reviewedProgressRes.count ?? 0) > 0 || (reviewedStudyRes.count ?? 0) > 0;

  return {
    yesterday: toWindow(yesterdayRes.data ?? null),
    lastWeek: toWindow(lastWeekRes.data ?? null),
    lastMonth: toWindow(lastMonthRes.data ?? null),
    reviewedToday,
  };
}

/**
 * Calendar events for /student/calendar — combines bookings, homework due
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
  studentId: string,
  monthStart: Date,
  monthEnd: Date,
): Promise<CalendarEvent[]> {
  const supabase = await createClient();
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
      href: "/student/packages",
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
 * Continue Watching: in-progress recorded course lessons. Pulls rows where
 * the student has watched some of the video but not finished, ordered by most
 * recently watched. If the student has no in-progress lessons, returns []
 * and the caller falls back to `getStudentRecentRecordings`.
 */
export async function getStudentContinueWatching(
  studentId: string,
  lang: "ar" | "en" = "en",
  limit = 5,
): Promise<{ id: string; [key: string]: unknown }[]> {
  const supabase = await createClient();

  // course_lesson_progress is keyed by enrollment_id, so resolve the
  // student's enrollments first, then pull in-progress rows for them.
  const { data: enrollments } = await supabase
    .from("course_enrollments")
    .select("id")
    .eq("student_id", studentId)
    .returns<{ id: string }[]>();

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

  const { data } = await supabase
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

  if (!data || data.length === 0) return [];

  // Resolve student + teacher names/avatars for the stacked-avatar Assignee
  // column. Student is always the same; teacher varies per course.
  const teacherIds = [...new Set(
    data.map((r) => r.lesson?.course?.teacher_id).filter(Boolean) as string[],
  )];
  const profileIds = [studentId, ...teacherIds];
  const { data: profiles } = await supabase
    .from("profiles")
    .select("id, full_name, avatar_url")
    .in("id", profileIds)
    .returns<{ id: string; full_name: string | null; avatar_url: string | null }[]>();
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
          lang === "ar" ? "ar" : "en-US",
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
  studentId: string,
  lang: "ar" | "en" = "en",
  limit = 6
): Promise<Record<string, unknown>[]> {
  const supabase = await createClient();

  const { data: bookings } = await supabase
    .from("bookings")
    .select("id, teacher_id, session_type, scheduled_at")
    .eq("student_id", studentId)
    .eq("status", "completed")
    .order("scheduled_at", { ascending: false })
    .limit(limit)
    .returns<{ id: string; teacher_id: string; session_type: string; scheduled_at: string }[]>();

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
      lang === "ar" ? "ar" : "en-US",
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
// TEACHER DASHBOARD QUERIES
// ============================================

export async function getTeacherWeeklyHours(
  teacherId: string,
  lang: "ar" | "en" = "en"
): Promise<ChartDataPoint[]> {
  const supabase = await createClient();
  const sevenDaysAgo = new Date();
  sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

  const { data: bookings } = await supabase
    .from("bookings")
    .select("id")
    .eq("teacher_id", teacherId)
    .gte("scheduled_at", sevenDaysAgo.toISOString())
    .returns<{ id: string }[]>();

  if (!bookings || bookings.length === 0) return generateEmptyWeek(lang);

  const bookingIds = bookings.map((b) => b.id);

  const { data: sessions } = await supabase
    .from("sessions")
    .select("actual_duration, started_at")
    .in("booking_id", bookingIds)
    .not("ended_at", "is", null)
    .gte("started_at", sevenDaysAgo.toISOString())
    .returns<{ actual_duration: number | null; started_at: string | null }[]>();

  return groupSessionsByDay(sessions ?? [], lang);
}

export async function getTeacherLiveSessions(
  teacherId: string
): Promise<LiveSessionItem[]> {
  const supabase = await createClient();

  const { data: bookings } = await supabase
    .from("bookings")
    .select("id, student_id, session_type")
    .eq("teacher_id", teacherId)
    .eq("status", "confirmed")
    .returns<{ id: string; student_id: string; session_type: string }[]>();

  if (!bookings || bookings.length === 0) return [];

  const bookingIds = bookings.map((b) => b.id);

  // Stranded-session guard — see getAdminLiveSessions for rationale.
  const fourHoursAgo = new Date(Date.now() - 4 * 60 * 60 * 1000).toISOString();
  const { data: sessions } = await supabase
    .from("sessions")
    .select("id, booking_id, started_at, ended_at")
    .in("booking_id", bookingIds)
    .not("started_at", "is", null)
    .is("ended_at", null)
    .gte("started_at", fourHoursAgo)
    .returns<{
      id: string;
      booking_id: string;
      started_at: string;
      ended_at: string | null;
    }[]>();

  if (!sessions || sessions.length === 0) return [];

  const studentIds = [...new Set(bookings.map((b) => b.student_id))];
  const { data: profiles } = await supabase
    .from("profiles")
    .select("id, full_name")
    .in("id", studentIds)
    .returns<{ id: string; full_name: string | null }[]>();

  const nameMap: Record<string, string> = {};
  if (profiles) {
    for (const p of profiles) {
      nameMap[p.id] = p.full_name ?? "—";
    }
  }

  const now = Date.now();
  return sessions.map((s) => {
    const booking = bookings.find((b) => b.id === s.booking_id);
    const studentName = booking ? (nameMap[booking.student_id] ?? "—") : "—";
    const initials = studentName.slice(0, 2);
    const elapsed = now - new Date(s.started_at).getTime();
    const hrs = Math.floor(elapsed / 3600000);
    const mins = Math.floor((elapsed % 3600000) / 60000);
    const secs = Math.floor((elapsed % 60000) / 1000);
    const timeStr = `${String(hrs).padStart(2, "0")}:${String(mins).padStart(2, "0")}:${String(secs).padStart(2, "0")}`;

    return {
      id: s.id,
      title: studentName,
      subtitle: booking?.session_type ?? "session",
      initials,
      timeRemaining: timeStr,
      progressPercent: undefined,
    };
  });
}

const BREAKDOWN_COLORS: Record<
  string,
  { label: string; color: string }
> = {
  hifz: { label: "Memorization", color: "#7C5CFF" },
  muraja: { label: "Review", color: "#22C55E" },
  tajweed: { label: "Tajweed", color: "#F59E0B" },
  tilawa: { label: "Recitation", color: "#3B82F6" },
  qiraat: { label: "Qira'at", color: "#EC4899" },
  tafsir: { label: "Tafsir", color: "#14B8A6" },
  combined: { label: "Combined", color: "#A855F7" },
  other: { label: "Other", color: "#9CA3AF" },
};

export async function getTeacherSessionTypeBreakdown(
  teacherId: string
): Promise<{ label: string; value: number; color: string }[]> {
  const supabase = await createClient();
  const thirtyDaysAgo = new Date();
  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

  const { data: bookings } = await supabase
    .from("bookings")
    .select("session_type")
    .eq("teacher_id", teacherId)
    .eq("status", "completed")
    .gte("created_at", thirtyDaysAgo.toISOString())
    .returns<{ session_type: string }[]>();

  if (!bookings || bookings.length === 0) return [];

  const counts: Record<string, number> = {};
  for (const b of bookings) {
    const type = b.session_type ?? "other";
    counts[type] = (counts[type] ?? 0) + 1;
  }

  return Object.entries(counts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 4)
    .map(([type, count]) => {
      const meta = BREAKDOWN_COLORS[type] ?? BREAKDOWN_COLORS.other;
      return { label: meta.label, value: count, color: meta.color };
    });
}

export async function getTeacherRecentStudents(
  teacherId: string,
  limit = 6
): Promise<{ id: string; [key: string]: unknown }[]> {
  const supabase = await createClient();

  const { data: bookings } = await supabase
    .from("bookings")
    .select("id, student_id, session_type, scheduled_at")
    .eq("teacher_id", teacherId)
    .eq("status", "completed")
    .order("scheduled_at", { ascending: false })
    .limit(limit * 3)
    .returns<{
      id: string;
      student_id: string;
      session_type: string;
      scheduled_at: string;
    }[]>();

  if (!bookings || bookings.length === 0) return [];

  const seenStudents = new Set<string>();
  const uniqueBookings: typeof bookings = [];
  for (const b of bookings) {
    if (!seenStudents.has(b.student_id)) {
      seenStudents.add(b.student_id);
      uniqueBookings.push(b);
      if (uniqueBookings.length >= limit) break;
    }
  }

  const studentIds = [...new Set(uniqueBookings.map((b) => b.student_id))];

  const [profilesRes, sessionCountsRes] = await Promise.all([
    supabase
      .from("profiles")
      .select("id, full_name")
      .in("id", studentIds)
      .returns<{ id: string; full_name: string | null }[]>(),
    supabase
      .from("bookings")
      .select("student_id")
      .eq("teacher_id", teacherId)
      .eq("status", "completed")
      .in("student_id", studentIds)
      .returns<{ student_id: string }[]>(),
  ]);

  const nameMap: Record<string, string> = {};
  if (profilesRes.data) {
    for (const p of profilesRes.data) {
      nameMap[p.id] = p.full_name ?? "—";
    }
  }

  const countMap: Record<string, number> = {};
  if (sessionCountsRes.data) {
    for (const b of sessionCountsRes.data) {
      countMap[b.student_id] = (countMap[b.student_id] ?? 0) + 1;
    }
  }

  return uniqueBookings.map((b) => ({
    id: b.student_id.slice(0, 6).toUpperCase(),
    subject: b.session_type ?? "—",
    date: new Date(b.scheduled_at).toLocaleDateString("en-US", {
      year: "numeric",
      month: "short",
      day: "2-digit",
    }),
    // Raw completed-session count with this teacher. The column header
    // ("الحصص" / "Sessions") already implies a count — previously this
    // was multiplied by 10 and rendered as a percentage, which read as
    // "10% progress" toward an undefined goal. Now matches the label.
    sessions: countMap[b.student_id] ?? 0,
    assignee: nameMap[b.student_id] ?? "—",
    view: "view",
  }));
}

// ============================================
// ADMIN DASHBOARD QUERIES
// ============================================

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

  const { data: bookings } = await supabase
    .from("bookings")
    .select("amount_usd, created_at")
    .eq("status", "completed")
    .gte("created_at", sevenDaysAgo.toISOString())
    .returns<{ amount_usd: number; created_at: string }[]>();

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

export async function getAdminLiveSessions(): Promise<LiveSessionItem[]> {
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
  const { data: sessions } = await supabase
    .from("sessions")
    .select(
      "id, started_at, booking:bookings(session_type, student:profiles!student_id(full_name), teacher:profiles!teacher_id(full_name))",
    )
    .not("started_at", "is", null)
    .is("ended_at", null)
    .gte("started_at", fourHoursAgo)
    .returns<Row[]>();

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

const BOOKING_STATUS_COLORS: Record<string, { label: string; color: string }> =
  {
    completed: { label: "Completed", color: "#22C55E" },
    confirmed: { label: "Confirmed", color: "#7C5CFF" },
    pending: { label: "Pending", color: "#F59E0B" },
    cancelled: { label: "Cancelled", color: "#EF4444" },
    no_show: { label: "No Show", color: "#9CA3AF" },
  };

export async function getAdminBookingStatusBreakdown(): Promise<
  { label: string; value: number; color: string }[]
> {
  const supabase = await createClient();
  const thirtyDaysAgo = new Date();
  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

  const { data: bookings } = await supabase
    .from("bookings")
    .select("status")
    .gte("created_at", thirtyDaysAgo.toISOString())
    .returns<{ status: string }[]>();

  if (!bookings || bookings.length === 0) return [];

  const counts: Record<string, number> = {};
  for (const b of bookings) {
    counts[b.status] = (counts[b.status] ?? 0) + 1;
  }

  return Object.entries(counts)
    .sort((a, b) => b[1] - a[1])
    .map(([status, count]) => {
      const meta = BOOKING_STATUS_COLORS[status] ?? {
        label: status,
        color: "#9CA3AF",
      };
      return { label: meta.label, value: count, color: meta.color };
    });
}

export async function getAdminRecentBookings(
  limit = 6
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

  const { data: bookings } = await supabase
    .from("bookings")
    .select(
      "id, session_type, amount_usd, status, created_at, student:profiles!student_id(full_name)",
    )
    .order("created_at", { ascending: false })
    .limit(limit)
    .returns<Row[]>();

  if (!bookings || bookings.length === 0) return [];

  return bookings.map((b) => ({
    id: b.id.slice(0, 6).toUpperCase(),
    subject: b.session_type ?? "—",
    date: new Date(b.created_at).toLocaleDateString("en-US", {
      year: "numeric",
      month: "short",
      day: "2-digit",
    }),
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

// ============================================
// MODERATOR DASHBOARD QUERIES
// ============================================

export async function getModeratorWeeklyCVActivity(
  lang: "ar" | "en" = "en"
): Promise<ChartDataPoint[]> {
  const supabase = await createClient();
  const sevenDaysAgo = new Date();
  sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
  sevenDaysAgo.setHours(0, 0, 0, 0);

  const { data: submissions } = await supabase
    .from("teacher_profiles")
    .select("cv_submitted_at")
    .not("cv_submitted_at", "is", null)
    .gte("cv_submitted_at", sevenDaysAgo.toISOString())
    .returns<{ cv_submitted_at: string | null }[]>();

  const days = lang === "ar" ? AR_DAYS : EN_DAYS;
  const order = [1, 2, 3, 4, 5, 6, 0]; // Mon–Sun
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const todayDow = (today.getDay() + 6) % 7; // Mon=0..Sun=6

  const buckets = order.map((_, i) => ({
    day: days[order[i]],
    value: 0,
    isActive: i === todayDow,
  }));

  if (submissions) {
    for (const s of submissions) {
      if (!s.cv_submitted_at) continue;
      const d = new Date(s.cv_submitted_at);
      d.setHours(0, 0, 0, 0);
      const dow = (d.getDay() + 6) % 7;
      if (dow >= 0 && dow < 7) buckets[dow].value += 1;
    }
  }

  return buckets;
}

const RATING_COLORS: Record<string, string> = {
  "5": "#22C55E",
  "4": "#7C5CFF",
  "3": "#F59E0B",
  "2": "#EF6820",
  "1": "#EF4444",
};

export async function getModeratorRatingDistribution(): Promise<
  { label: string; value: number; color: string }[]
> {
  const supabase = await createClient();
  const thirtyDaysAgo = new Date();
  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

  const { data: evals } = await supabase
    .from("session_evaluations")
    .select("overall_score")
    .not("overall_score", "is", null)
    .gte("created_at", thirtyDaysAgo.toISOString())
    .returns<{ overall_score: number }[]>();

  if (!evals || evals.length === 0) return [];

  const buckets: Record<string, number> = {};
  for (const e of evals) {
    const score = Math.round(Number(e.overall_score));
    if (score >= 1 && score <= 5) {
      buckets[String(score)] = (buckets[String(score)] ?? 0) + 1;
    }
  }

  return Object.entries(buckets)
    .filter(([, count]) => count > 0)
    .sort((a, b) => Number(b[0]) - Number(a[0]))
    .map(([score, count]) => ({
      label: `${score}★`,
      value: count,
      color: RATING_COLORS[score] ?? "#9CA3AF",
    }));
}

export async function getModeratorFlaggedEvaluations(
  limit = 6
): Promise<{ id: string; [key: string]: unknown }[]> {
  const supabase = await createClient();
  const sevenDaysAgo = new Date();
  sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

  const { data: evals } = await supabase
    .from("session_evaluations")
    .select("id, student_id, teacher_id, overall_score, evaluation_type, created_at")
    .lte("overall_score", 3)
    .gte("created_at", sevenDaysAgo.toISOString())
    .order("overall_score", { ascending: true })
    .limit(limit)
    .returns<{
      id: string;
      student_id: string;
      teacher_id: string;
      overall_score: number;
      evaluation_type: string;
      created_at: string;
    }[]>();

  if (!evals || evals.length === 0) return [];

  const allIds = new Set<string>();
  for (const e of evals) {
    allIds.add(e.student_id);
    allIds.add(e.teacher_id);
  }

  const { data: profiles } = await supabase
    .from("profiles")
    .select("id, full_name")
    .in("id", Array.from(allIds))
    .returns<{ id: string; full_name: string | null }[]>();

  const nameMap: Record<string, string> = {};
  if (profiles) {
    for (const p of profiles) {
      nameMap[p.id] = p.full_name ?? "—";
    }
  }

  return evals.map((e) => ({
    id: e.id.slice(0, 6).toUpperCase(),
    subject: e.evaluation_type ?? "—",
    date: new Date(e.created_at).toLocaleDateString("en-US", {
      year: "numeric",
      month: "short",
      day: "2-digit",
    }),
    progress: Math.round((Number(e.overall_score) / 5) * 100),
    assignee: nameMap[e.teacher_id] ?? "—",
    view: "view",
  }));
}

/**
 * Time-to-grade discipline KPI for the teacher dashboard.
 *
 * Returns the median + 90th-percentile time (in hours) the teacher took
 * to grade a student's follow-up after the student marked it ready
 * (`ready_at` → `completed_at`), over the last 30 days, alongside the
 * sample size.
 *
 * The point is to give teachers a public-to-themselves discipline
 * number — the same kind of accountability the eval-discipline gate
 * enforces, but for grading. Returns nulls when the sample is too
 * small to draw conclusions (< 3 graded items in 30 days).
 *
 * Used by the teacher dashboard KPI strip; thresholds for color-coding
 * (green ≤ 24h, amber ≤ 72h, red beyond) live in the rendering
 * component, not here, since they're a UX choice.
 */
export async function getTeacherTimeToGrade(
  teacherId: string,
): Promise<{ medianHours: number | null; p90Hours: number | null; sampleSize: number }> {
  const supabase = await createClient();
  const thirtyDaysAgoIso = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();

  // Only graded follow-ups (any of the 4 completed_* statuses) where both
  // timestamps are present. ready_at can be null for grandfathered rows
  // pre-Sprint 2.3, so filter explicitly.
  const { data } = await supabase
    .from("homework_assignments")
    .select("ready_at, completed_at")
    .eq("teacher_id", teacherId)
    .in("status", [
      "completed_excellent",
      "completed_good",
      "completed_needs_work",
      "completed_not_done",
    ])
    .not("ready_at", "is", null)
    .not("completed_at", "is", null)
    .gte("completed_at", thirtyDaysAgoIso)
    .returns<{ ready_at: string; completed_at: string }[]>();

  const rows = data ?? [];
  if (rows.length < 3) {
    return { medianHours: null, p90Hours: null, sampleSize: rows.length };
  }

  const hours = rows
    .map(r => (new Date(r.completed_at).getTime() - new Date(r.ready_at).getTime()) / (1000 * 60 * 60))
    .filter(h => h >= 0) // defensive: ignore impossible negative durations
    .sort((a, b) => a - b);

  if (hours.length < 3) {
    return { medianHours: null, p90Hours: null, sampleSize: hours.length };
  }

  const median = hours[Math.floor(hours.length / 2)];
  const p90Index = Math.min(hours.length - 1, Math.floor(hours.length * 0.9));
  const p90 = hours[p90Index];

  return {
    medianHours: Math.round(median * 10) / 10,
    p90Hours: Math.round(p90 * 10) / 10,
    sampleSize: hours.length,
  };
}

/**
 * Roster-wide recitation-error pulse for the teacher dashboard.
 *
 * Aggregates `recitation_errors` across all of this teacher's students'
 * progress rows over the last 30 days, returning the top categories so
 * the teacher can see "what does my whole class need work on this
 * month" — the kind of insight a department head would normally
 * compile by hand.
 *
 * Filters OUT the no-errors-observed sentinel rows (Sprint 2.2)
 * because they exist only to flip the per-session banner green and
 * would otherwise inflate the `other` bucket.
 *
 * Returns at most 3 categories, sorted by count desc. An empty array
 * means either no errors logged or the teacher has no progress rows
 * with logged errors yet.
 */
export type RecitationErrorCategory = "makharij" | "sifat" | "madd" | "waqf" | "ghunna" | "other";

export async function getTeacherRosterErrorPulse(
  teacherId: string,
): Promise<{ category: RecitationErrorCategory; count: number }[]> {
  const supabase = await createClient();
  const thirtyDaysAgoIso = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();

  // Step 1: this teacher's progress rows (last 30 days). recitation_errors
  // is keyed by progress_id (FK), not teacher_id, so we resolve via the
  // progress table.
  const { data: progressRows } = await supabase
    .from("student_progress")
    .select("id")
    .eq("teacher_id", teacherId)
    .gte("created_at", thirtyDaysAgoIso)
    .returns<{ id: string }[]>();

  if (!progressRows || progressRows.length === 0) return [];

  // Step 2: errors against those progress IDs. Excluding the sentinel
  // keeps the data honest — those rows aren't tajweed errors.
  const { data: errors } = await supabase
    .from("recitation_errors")
    .select("error_type, note")
    .in("progress_id", progressRows.map(p => p.id))
    .gte("created_at", thirtyDaysAgoIso)
    .returns<{ error_type: string; note: string | null }[]>();

  if (!errors || errors.length === 0) return [];

  const counts: Record<RecitationErrorCategory, number> = {
    makharij: 0, sifat: 0, madd: 0, waqf: 0, ghunna: 0, other: 0,
  };
  for (const e of errors) {
    if (e.note === "__no_errors_observed_sentinel__") continue;
    if (e.error_type in counts) counts[e.error_type as RecitationErrorCategory] += 1;
    else counts.other += 1;
  }

  return (Object.entries(counts) as [RecitationErrorCategory, number][])
    .filter(([, c]) => c > 0)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([category, count]) => ({ category, count }));
}

/**
 * Talqeen inbox for the teacher dashboard — Sprint Improvement #2 (2026-05-05).
 *
 * Talqeen audio submissions land in `homework_assignments` with
 * `homework_type='recitation'` (Sprint 2.3). Today they merge into the
 * generic grading count, making the platform's most pedagogically
 * distinctive workflow invisible. This helper isolates them so they
 * can be shown as their own dedicated inbox.
 *
 * Returns the total count + the 5 most-recent submissions awaiting
 * grading (status='student_ready'), with student name resolved.
 */
export async function getTeacherTalqeenInbox(
  teacherId: string,
): Promise<{
  totalCount: number;
  recent: Array<{
    id: string;
    title: string;
    studentName: string;
    audioDurationSeconds: number | null;
    readyAt: string | null;
  }>;
}> {
  const supabase = await createClient();

  // Count + recent rows in one fetch — limited to 5 for rendering speed.
  // We get the total count by selecting with count exact head:false (count
  // returns the total, data is paginated by .limit).
  const { data, count } = await supabase
    .from("homework_assignments")
    .select("id, title, student_id, audio_duration_seconds, ready_at", { count: "exact" })
    .eq("teacher_id", teacherId)
    .eq("homework_type", "recitation")
    .eq("status", "student_ready")
    .order("ready_at", { ascending: false, nullsFirst: false })
    .limit(5)
    .returns<{
      id: string;
      title: string;
      student_id: string;
      audio_duration_seconds: number | null;
      ready_at: string | null;
    }[]>();

  const rows = data ?? [];
  if (rows.length === 0) {
    return { totalCount: count ?? 0, recent: [] };
  }

  const studentIds = [...new Set(rows.map(r => r.student_id))];
  const { data: profiles } = await supabase
    .from("profiles")
    .select("id, full_name")
    .in("id", studentIds)
    .returns<{ id: string; full_name: string | null }[]>();
  const nameMap: Record<string, string> = {};
  for (const p of profiles ?? []) nameMap[p.id] = p.full_name ?? "—";

  return {
    totalCount: count ?? rows.length,
    recent: rows.map(r => ({
      id: r.id,
      title: r.title,
      studentName: nameMap[r.student_id] ?? "—",
      audioDurationSeconds: r.audio_duration_seconds,
      readyAt: r.ready_at,
    })),
  };
}
