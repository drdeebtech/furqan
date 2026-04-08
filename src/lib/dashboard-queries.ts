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
