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

  const { data: sessions } = await supabase
    .from("sessions")
    .select("id, booking_id, started_at, ended_at")
    .in("booking_id", bookingIds)
    .not("started_at", "is", null)
    .is("ended_at", null)
    .returns<{ id: string; booking_id: string; started_at: string; ended_at: string | null }[]>();

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

    return {
      id: s.id,
      title: teacherName,
      subtitle: booking?.session_type ?? "session",
      initials,
      timeRemaining: timeStr,
      progressPercent: undefined,
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
      lang === "ar" ? "ar-SA" : "en-US",
      { year: "numeric", month: "short", day: "2-digit" }
    ),
    progress: Math.min(100, 50 + i * 10),
    assignee: nameMap[b.teacher_id] ?? "—",
    view: "view",
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

  const { data: sessions } = await supabase
    .from("sessions")
    .select("id, booking_id, started_at, ended_at")
    .in("booking_id", bookingIds)
    .not("started_at", "is", null)
    .is("ended_at", null)
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
    progress: Math.min(100, (countMap[b.student_id] ?? 0) * 10),
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

  const { data: sessions } = await supabase
    .from("sessions")
    .select(
      "id, started_at, booking:bookings(session_type, student:profiles!student_id(full_name), teacher:profiles!teacher_id(full_name))",
    )
    .not("started_at", "is", null)
    .is("ended_at", null)
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
