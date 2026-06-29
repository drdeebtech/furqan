import type { ServerClient } from "@/lib/supabase/types";
import { buildNameMap } from "@/lib/admin/name-map";
import { loadOrFail, countOrFail, helperOrFail } from "@/lib/supabase/load-or-fail";
import { logError } from "@/lib/logger";
import { getTeacherTimeToGrade } from "@/lib/views/teacher-insights";
import type { PendingBooking, SessionData } from "@/app/teacher/dashboard/types";

/**
 * Deep read module for the teacher dashboard screen.
 *
 * Owns the full read-assembly for `/teacher/dashboard` behind one interface
 * so the page component becomes a thin HTTP-boundary + render shell.
 * The injected `supabase` client is the test seam — tests can pass a
 * stub/fake without a live server client.
 *
 * Behavior-preserving: pure reads-only refactor. All query logic, the
 * Kuwait timezone anchor, batch structure, and error accumulation are
 * identical to the page implementation this replaces.
 */

const ROUTE = "teacher-dashboard";

// Kuwait operator timezone — the page's original comment explains why
// this is hard-coded (no DST, static +03:00 offset is safe).
const TZ_OFFSET = "+03:00";
const TZ = "Asia/Kuwait";

type SessionRow = {
  id: string;
  booking_id: string;
  room_url: string;
  expires_at: string | null;
  started_at: string | null;
  ended_at: string | null;
};

export interface TeacherDashboardData {
  fullName: string | null;
  cvStatus: "draft" | "pending_review" | "approved" | "rejected";
  hasProfile: boolean;
  hasBio: boolean;
  hasAvailability: boolean;
  uniqueStudents: number;
  monthSessions: number;
  pendingCount: number;
  ratingAvg: number;
  todaySessions: PendingBooking[];
  pending: PendingBooking[];
  sessionDataMap: Record<string, SessionData>;
  nameMap: Record<string, string>;
  weeklyHours: Awaited<ReturnType<typeof getTeacherWeeklyHours>>;
  liveSessions: Awaited<ReturnType<typeof getTeacherLiveSessions>>;
  sessionBreakdown: Awaited<ReturnType<typeof getTeacherSessionTypeBreakdown>>;
  recentStudents: Awaited<ReturnType<typeof getTeacherRecentStudents>>;
  actionQueue: {
    pendingGrading: number;
    overdueEvals: number;
    unreadMessages: number;
    todaySessionCount: number;
    lowAvailability: boolean;
  };
  timeToGrade: Awaited<ReturnType<typeof getTeacherTimeToGrade>>;
}

export interface TeacherDashboardViewResult {
  data: TeacherDashboardData;
  /** True if ANY read on the page failed — drives the DataLoadBanner. */
  anyFailed: boolean;
}

/**
 * Assemble the full read bundle for the teacher dashboard.
 *
 * @param supabase   Injected server client (the test seam — page passes the real one).
 * @param teacherId  The authenticated teacher's user id.
 */
export async function teacherDashboardView(
  supabase: ServerClient,
  teacherId: string,
): Promise<TeacherDashboardViewResult> {
  // Anchor "today" to Asia/Kuwait (operator timezone) — same logic as the
  // original page. Kuwait has no DST so the static +03:00 offset is safe.
  const dateParts = new Intl.DateTimeFormat("en-CA", {
    timeZone: TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
  const todayStart = new Date(`${dateParts}T00:00:00${TZ_OFFSET}`);
  const todayEnd = new Date(`${dateParts}T23:59:59.999${TZ_OFFSET}`);
  const monthParts = new Intl.DateTimeFormat("en-CA", {
    timeZone: TZ,
    year: "numeric",
    month: "2-digit",
  }).format(new Date());
  const monthStart = new Date(`${monthParts}-01T00:00:00${TZ_OFFSET}`).toISOString();

  // ── Batch 1: all queries that depend only on teacherId ──────────────────
  const [
    profileRes, tpRes, pendingRes, todayRes, monthRes, allStudentsRes, availRes,
    gradingRes, convosRes,
    weeklyHoursLoad, liveSessionsLoad, sessionBreakdownLoad, recentStudentsLoad, timeToGradeLoad,
    overdueEvalsRes,
  ] = await Promise.all([
    supabase.from("profiles").select("full_name, phone, avatar_url").eq("id", teacherId)
      .single<{ full_name: string | null; phone: string | null; avatar_url: string | null }>(),
    supabase.from("teacher_profiles").select("total_sessions, rating_avg, cv_status, bio").eq("teacher_id", teacherId)
      .single<{ total_sessions: number; rating_avg: number; cv_status: string; bio: string | null }>(),
    supabase.from("bookings").select("id, scheduled_at, duration_min, session_type, amount_usd, student_id")
      .eq("teacher_id", teacherId).eq("status", "pending").order("scheduled_at", { ascending: true })
      .returns<PendingBooking[]>(),
    supabase.from("bookings").select("id, scheduled_at, duration_min, session_type, student_id")
      .eq("teacher_id", teacherId).eq("status", "confirmed")
      .gte("scheduled_at", todayStart.toISOString()).lte("scheduled_at", todayEnd.toISOString())
      .order("scheduled_at", { ascending: true }).returns<PendingBooking[]>(),
    supabase.from("bookings").select("id", { count: "exact", head: true })
      .eq("teacher_id", teacherId).eq("status", "completed").gte("created_at", monthStart),
    supabase.rpc("teacher_distinct_students" as never, { p_teacher_id: teacherId } as never)
      .returns<{ student_id: string }[]>(),
    supabase.from("teacher_availability").select("id", { count: "exact", head: true })
      .eq("teacher_id", teacherId).eq("is_active", true),
    supabase.from("homework_assignments").select("id", { count: "exact", head: true })
      .eq("teacher_id", teacherId).eq("status", "student_ready"),
    supabase.from("conversations").select("id").eq("teacher_id", teacherId).returns<{ id: string }[]>(),
    helperOrFail(
      () => getTeacherWeeklyHours(supabase, teacherId),
      [],
      { route: ROUTE, widget: "weekly-hours" },
    ),
    helperOrFail(
      () => getTeacherLiveSessions(supabase, teacherId),
      [],
      { route: ROUTE, widget: "live-sessions" },
    ),
    helperOrFail(
      () => getTeacherSessionTypeBreakdown(supabase, teacherId),
      [],
      { route: ROUTE, widget: "session-breakdown" },
    ),
    helperOrFail(
      () => getTeacherRecentStudents(supabase, teacherId),
      [],
      { route: ROUTE, widget: "recent-students" },
    ),
    helperOrFail(
      () => getTeacherTimeToGrade(supabase, teacherId),
      { medianHours: null, p90Hours: null, sampleSize: 0 },
      { route: ROUTE, widget: "time-to-grade" },
    ),
    supabase.rpc(
      "get_teacher_overdue_eval_count" as never,
      { p_teacher_id: teacherId } as never,
    ) as unknown as Promise<{ data: number | null; error: { message: string; code?: string } | null }>,
  ]);

  const profileLoad = loadOrFail(profileRes, { full_name: null, phone: null, avatar_url: null }, { route: ROUTE, widget: "profile" });
  const tpLoad = loadOrFail(tpRes, { total_sessions: 0, rating_avg: 0, cv_status: "draft", bio: null }, { route: ROUTE, widget: "teacher-profile" });
  const pendingLoad = loadOrFail(pendingRes, [] as PendingBooking[], { route: ROUTE, widget: "pending-bookings" });
  const todayLoad = loadOrFail(todayRes, [] as PendingBooking[], { route: ROUTE, widget: "today-sessions" });
  const allStudentsLoad = loadOrFail(allStudentsRes, [] as { student_id: string }[], { route: ROUTE, widget: "all-students" });
  const convosLoad = loadOrFail(convosRes, [] as { id: string }[], { route: ROUTE, widget: "conversations" });
  const monthLoad = countOrFail(monthRes, { route: ROUTE, widget: "month-sessions" });
  const availLoad = countOrFail(availRes, { route: ROUTE, widget: "active-availability" });
  const gradingLoad = countOrFail(gradingRes, { route: ROUTE, widget: "pending-grading" });

  let anyFailed = profileLoad.failed || tpLoad.failed || pendingLoad.failed
    || todayLoad.failed || allStudentsLoad.failed || convosLoad.failed
    || monthLoad.failed || availLoad.failed || gradingLoad.failed
    || weeklyHoursLoad.failed || liveSessionsLoad.failed
    || sessionBreakdownLoad.failed || recentStudentsLoad.failed || timeToGradeLoad.failed;

  if (overdueEvalsRes.error) {
    logError("teacher-dashboard.overdue-evals rpc failed", overdueEvalsRes.error, {
      tag: "data-load",
      severity: "warning",
      route: ROUTE,
      metadata: { widget: "overdue-evals" },
    });
    anyFailed = true;
  }
  const overdueEvalsCount = (overdueEvalsRes.data as number | null) ?? 0;

  // ── Batch 2: reads that depend on batch-1 results ──────────────────────
  const convIds = convosLoad.data.map(c => c.id);
  const todayBookingIds = todayLoad.data.map(b => b.id);
  const [messagesRes, sessionsRes] = await Promise.all([
    supabase.from("messages").select("id", { count: "exact", head: true })
      .in("conversation_id", convIds)
      .neq("sender_id", teacherId)
      .eq("is_read", false),
    supabase.from("sessions")
      .select("id, booking_id, room_url, expires_at, started_at, ended_at")
      .in("booking_id", todayBookingIds)
      .returns<SessionRow[]>(),
  ]);

  const messagesLoad = countOrFail(messagesRes, { route: ROUTE, widget: "unread-messages" });
  const sessionsLoad = loadOrFail(sessionsRes, [] as SessionRow[], { route: ROUTE, widget: "today-session-data" });
  anyFailed = anyFailed || messagesLoad.failed || sessionsLoad.failed;

  // ── Derived values ──────────────────────────────────────────────────────
  const pending = pendingLoad.data;
  const todaySessions = todayLoad.data;
  const hasAvailability = availLoad.count > 0;

  const sessionDataMap: Record<string, SessionData> = sessionsLoad.data.length > 0
    ? Object.fromEntries(sessionsLoad.data.map(({ booking_id, ...rest }) => [booking_id, rest]))
    : {};

  const allStudentIds = [...new Set([...pending.map(b => b.student_id), ...todaySessions.map(b => b.student_id)])];
  const nameMap = await buildNameMap(supabase, allStudentIds);

  return {
    data: {
      fullName: profileLoad.data.full_name,
      cvStatus: (tpLoad.data.cv_status ?? "draft") as "draft" | "pending_review" | "approved" | "rejected",
      hasProfile: !!(profileLoad.data.full_name && profileLoad.data.phone && profileLoad.data.avatar_url),
      hasBio: !!(tpLoad.data.bio),
      hasAvailability,
      uniqueStudents: new Set(allStudentsLoad.data.map(s => s.student_id)).size,
      monthSessions: monthLoad.count,
      pendingCount: pending.length,
      ratingAvg: Number(tpLoad.data.rating_avg ?? 0),
      todaySessions,
      pending,
      sessionDataMap,
      nameMap,
      weeklyHours: weeklyHoursLoad.data,
      liveSessions: liveSessionsLoad.data,
      sessionBreakdown: sessionBreakdownLoad.data,
      recentStudents: recentStudentsLoad.data,
      actionQueue: {
        pendingGrading: gradingLoad.count,
        overdueEvals: overdueEvalsCount,
        unreadMessages: messagesLoad.count,
        todaySessionCount: todaySessions.length,
        lowAvailability: !hasAvailability,
      },
      timeToGrade: timeToGradeLoad.data,
    },
    anyFailed,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Relocated from src/lib/dashboard-queries.ts (issue #560). These are the
// 4 teacher-facing reads the dashboard page calls; each takes the injected
// supabase client (the test seam). The private helpers below are local
// copies of the ones that lived in dashboard-queries.ts so this module is
// self-contained. Query shapes are preserved; the relocation is NOT
// byte-for-byte identical — getTeacherWeeklyHours now throws on DB error
// (instead of silently returning an empty week) and getTeacherRecentStudents'
// session count is no longer scaled ×10 (see the note in its return mapping).
// ─────────────────────────────────────────────────────────────────────────────

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
  // Bucket by Kuwait day-of-week (the page's TZ anchor) so a session
  // starting near midnight doesn't hop into the previous/next server-local
  // day. Mirrors the Intl.DateTimeFormat pattern used for "today"/"month"
  // above: format the instant into Asia/Kuwait YYYY-MM-DD, then read the
  // weekday in UTC off that constructed calendar date.
  const tzDayFmt = new Intl.DateTimeFormat("en-CA", {
    timeZone: TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  const buckets: Record<number, number> = {};
  for (const s of sessions) {
    if (!s.started_at) continue;
    const dateStr = tzDayFmt.format(new Date(s.started_at));
    const dayIndex = new Date(`${dateStr}T00:00:00Z`).getUTCDay();
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

export async function getTeacherWeeklyHours(
  supabase: ServerClient,
  teacherId: string,
  lang: "ar" | "en" = "en"
): Promise<ChartDataPoint[]> {
  const sevenDaysAgo = new Date();
  sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

  // Throw on supabase error so helperOrFail at the call site can surface
  // it — previously this swallowed errors and returned an empty week,
  // making a real DB failure look identical to "no sessions yet."
  const bookingsRes = await supabase
    .from("bookings")
    .select("id")
    .eq("teacher_id", teacherId)
    .gte("scheduled_at", sevenDaysAgo.toISOString())
    .returns<{ id: string }[]>();
  if (bookingsRes.error) throw bookingsRes.error;
  const bookings = bookingsRes.data;

  if (!bookings || bookings.length === 0) return generateEmptyWeek(lang);

  const bookingIds = bookings.map((b) => b.id);

  const sessionsRes = await supabase
    .from("sessions")
    .select("actual_duration, started_at")
    .in("booking_id", bookingIds)
    .not("ended_at", "is", null)
    .gte("started_at", sevenDaysAgo.toISOString())
    .returns<{ actual_duration: number | null; started_at: string | null }[]>();
  if (sessionsRes.error) throw sessionsRes.error;

  return groupSessionsByDay(sessionsRes.data ?? [], lang);
}

export async function getTeacherLiveSessions(
  supabase: ServerClient,
  teacherId: string
): Promise<LiveSessionItem[]> {
  // Throw on supabase errors so helperOrFail at the call site can surface
  // them — empty-array returns are reserved for genuinely-zero-rows.
  const bookingsRes = await supabase
    .from("bookings")
    .select("id, student_id, session_type")
    .eq("teacher_id", teacherId)
    .eq("status", "confirmed")
    .returns<{ id: string; student_id: string; session_type: string }[]>();
  if (bookingsRes.error) throw bookingsRes.error;
  const bookings = bookingsRes.data;

  if (!bookings || bookings.length === 0) return [];

  const bookingIds = bookings.map((b) => b.id);

  // Stranded-session guard — see getPlatformLiveSessions for rationale.
  const fourHoursAgo = new Date(Date.now() - 4 * 60 * 60 * 1000).toISOString();
  const sessionsRes = await supabase
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
  if (sessionsRes.error) throw sessionsRes.error;
  const sessions = sessionsRes.data;

  if (!sessions || sessions.length === 0) return [];

  const studentIds = [...new Set(bookings.map((b) => b.student_id))];
  const profilesRes = await supabase
    .from("profiles")
    .select("id, full_name")
    .in("id", studentIds)
    .returns<{ id: string; full_name: string | null }[]>();
  if (profilesRes.error) throw profilesRes.error;
  const profiles = profilesRes.data;

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
  supabase: ServerClient,
  teacherId: string
): Promise<{ label: string; value: number; color: string }[]> {
  const thirtyDaysAgo = new Date();
  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

  const bookingsRes = await supabase
    .from("bookings")
    .select("session_type")
    .eq("teacher_id", teacherId)
    .eq("status", "completed")
    .gte("created_at", thirtyDaysAgo.toISOString())
    .returns<{ session_type: string }[]>();
  if (bookingsRes.error) throw bookingsRes.error;
  const bookings = bookingsRes.data;

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
  supabase: ServerClient,
  teacherId: string,
  limit = 6
): Promise<{ id: string; [key: string]: unknown }[]> {
  // Bounded best-effort scan: page through recent completed bookings,
  // de-duplicating by student, so a single student dominating the recent-
  // booking feed doesn't crowd others out of a short feed. Bounded means at
  // most PAGE_SIZE rows per round trip and at most MAX_PAGES round trips
  // (≤ PAGE_SIZE*MAX_PAGES rows total). Trade-off: in the pathological case
  // where the first PAGE_SIZE*MAX_PAGES bookings are one student, this returns
  // FEWER than `limit` unique students rather than scanning unboundedly. That
  // is acceptable for a dashboard widget; raise MAX_PAGES if the contract ever
  // needs to always fill `limit`.
  const PAGE_SIZE = Math.max(limit * 3, 1);
  const MAX_PAGES = 5;

  type RecentBooking = {
    id: string;
    student_id: string;
    session_type: string;
    scheduled_at: string;
  };

  const seenStudents = new Set<string>();
  const uniqueBookings: RecentBooking[] = [];

  for (let page = 0; page < MAX_PAGES && uniqueBookings.length < limit; page++) {
    const from = page * PAGE_SIZE;
    const to = from + PAGE_SIZE - 1;
    const bookingsRes = await supabase
      .from("bookings")
      .select("id, student_id, session_type, scheduled_at")
      .eq("teacher_id", teacherId)
      .eq("status", "completed")
      .order("scheduled_at", { ascending: false })
      .range(from, to)
      .returns<RecentBooking[]>();
    if (bookingsRes.error) throw bookingsRes.error;
    const rows = bookingsRes.data;
    if (!rows || rows.length === 0) break; // source exhausted

    for (const b of rows) {
      if (!seenStudents.has(b.student_id)) {
        seenStudents.add(b.student_id);
        uniqueBookings.push(b);
        if (uniqueBookings.length >= limit) break;
      }
    }
    if (rows.length < PAGE_SIZE) break; // final page — source exhausted
  }

  if (uniqueBookings.length === 0) return [];

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
  if (profilesRes.error) throw profilesRes.error;
  if (sessionCountsRes.error) throw sessionCountsRes.error;

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


// ── Migrated from dashboard-queries.ts (#613, teacher roster) ──

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

