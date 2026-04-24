import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getT } from "@/lib/i18n/server";
import { ProgressContent } from "./progress-content";

export const metadata: Metadata = { title: "تقدمي" };

// Map surah numbers to juz (simplified — surah start boundaries)
const SURAH_TO_JUZ: Record<number, number> = {
  1:1, 2:1, 3:3, 4:4, 5:6, 6:7, 7:8, 8:9, 9:10, 10:11,
  11:11, 12:12, 13:13, 14:13, 15:14, 16:14, 17:15, 18:15, 19:16, 20:16,
  21:17, 22:17, 23:18, 24:18, 25:18, 26:19, 27:19, 28:20, 29:20, 30:21,
  31:21, 32:21, 33:21, 34:22, 35:22, 36:22, 37:23, 38:23, 39:23, 40:24,
  41:24, 42:25, 43:25, 44:25, 45:25, 46:26, 47:26, 48:26, 49:26, 50:26,
  51:26, 52:27, 53:27, 54:27, 55:27, 56:27, 57:27, 58:28, 59:28, 60:28,
  61:28, 62:28, 63:28, 64:28, 65:28, 66:28, 67:29, 68:29, 69:29, 70:29,
  71:29, 72:29, 73:29, 74:29, 75:29, 76:29, 77:29, 78:30, 79:30, 80:30,
  81:30, 82:30, 83:30, 84:30, 85:30, 86:30, 87:30, 88:30, 89:30, 90:30,
  91:30, 92:30, 93:30, 94:30, 95:30, 96:30, 97:30, 98:30, 99:30, 100:30,
  101:30, 102:30, 103:30, 104:30, 105:30, 106:30, 107:30, 108:30, 109:30, 110:30,
  111:30, 112:30, 113:30, 114:30,
};

export default async function StudentProgressPage() {
  const { lang } = await getT();
  const locale = lang === "ar" ? "ar-SA" : "en-US";
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  // Parallel queries
  const [
    completedRes,
    progressRes,
    evalsRes,
    hwRes,
    totalHoursRes,
  ] = await Promise.all([
    // Completed sessions count
    supabase.from("bookings")
      .select("id", { count: "exact", head: true })
      .eq("student_id", user.id).eq("status", "completed"),
    // Student progress records
    supabase.from("student_progress")
      .select("id, surah_from, surah_to, ayah_from, ayah_to, quality_rating, level, progress_type, teacher_notes, created_at")
      .eq("student_id", user.id)
      .order("created_at", { ascending: false })
      .limit(50)
      .returns<{ id: string; surah_from: number | null; surah_to: number | null; ayah_from: number | null; ayah_to: number | null; quality_rating: number | null; level: string; progress_type: string; teacher_notes: string | null; created_at: string }[]>(),
    // Evaluations
    supabase.from("session_evaluations")
      .select("id, evaluation_type, hifz_score, tajweed_score, akhlaq_score, attendance_score, overall_score, strengths, weaknesses, recommendations, created_at")
      .eq("student_id", user.id)
      .order("created_at", { ascending: false })
      .limit(10)
      .returns<{ id: string; evaluation_type: string; hifz_score: number | null; tajweed_score: number | null; akhlaq_score: number | null; attendance_score: number | null; overall_score: number | null; strengths: string | null; weaknesses: string | null; recommendations: string | null; created_at: string }[]>(),
    // Homework stats
    supabase.from("homework_assignments")
      .select("status")
      .eq("student_id", user.id)
      .returns<{ status: string }[]>(),
    // Total study hours — filtered by student's bookings only
    supabase.from("bookings")
      .select("id, scheduled_at")
      .eq("student_id", user.id).eq("status", "completed")
      .returns<{ id: string; scheduled_at: string }[]>(),
  ]);

  const completedCount = completedRes.count ?? 0;
  const progressRecords = progressRes.data ?? [];
  const evaluations = evalsRes.data ?? [];
  const homeworkRaw = hwRes.data ?? [];

  // Get total study hours from student's completed sessions
  const completedBookingIds = (totalHoursRes.data ?? []).map(b => b.id);
  let totalMinutes = 0;
  if (completedBookingIds.length > 0) {
    const { data: sessionsData } = await supabase.from("sessions")
      .select("actual_duration").in("booking_id", completedBookingIds)
      .not("actual_duration", "is", null)
      .returns<{ actual_duration: number | null }[]>();
    totalMinutes = (sessionsData ?? []).reduce((sum, s) => sum + (s.actual_duration ?? 0), 0);
  }

  // Compute juz touched from progress records
  const juzTouched = new Set<number>();
  for (const p of progressRecords) {
    if (p.surah_from) {
      const juz = SURAH_TO_JUZ[p.surah_from];
      if (juz) juzTouched.add(juz);
    }
    if (p.surah_to) {
      const juz = SURAH_TO_JUZ[p.surah_to];
      if (juz) juzTouched.add(juz);
    }
  }

  // Compute quality average
  const ratings = progressRecords.filter(p => p.quality_rating != null).map(p => p.quality_rating!);
  const avgQuality = ratings.length > 0 ? (ratings.reduce((a, b) => a + b, 0) / ratings.length) : null;

  // Current level (most recent)
  const currentLevel = progressRecords[0]?.level ?? "beginner";

  // Homework stats
  const hwStats = { total: homeworkRaw.length, excellent: 0, good: 0, needsWork: 0, notDone: 0 };
  for (const h of homeworkRaw) {
    if (h.status === "completed_excellent") hwStats.excellent++;
    else if (h.status === "completed_good") hwStats.good++;
    else if (h.status === "completed_needs_work") hwStats.needsWork++;
    else if (h.status === "completed_not_done") hwStats.notDone++;
  }

  // Evaluation scores for chart (last 6, chronological)
  const evalScores = evaluations.slice(0, 6).reverse().map(e => ({
    date: new Date(e.created_at).toLocaleDateString(locale, { month: "short", day: "numeric" }),
    hifz: e.hifz_score,
    tajweed: e.tajweed_score,
    overall: e.overall_score,
  }));

  const totalHours = Math.round(totalMinutes / 60);

  return (
    <ProgressContent
      data={{
        completedCount,
        currentLevel,
        avgQuality,
        juzTouched: [...juzTouched],
        totalHours,
        evalScores,
        hwStats,
        latestEval: evaluations[0] ?? null,
        progressRecords: progressRecords.slice(0, 10),
      }}
    />
  );
}
