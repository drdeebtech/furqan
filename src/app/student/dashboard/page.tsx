import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import type { SessionType } from "@/types/database";
import { StudentDashboardContent } from "./dashboard-content";
import {
  getStudentWeeklyStudyTime,
  getStudentLiveSessions,
  getStudentRecentRecordings,
} from "@/lib/dashboard-queries";

export const metadata: Metadata = { title: "لوحتي" };

export default async function StudentDashboardPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const monthStart = new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString();

  const [profileRes, nextBookingRes, totalRes, monthRes, pendingRes, recentRes, evalsRes] = await Promise.all([
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
    supabase.from("bookings")
      .select("id, teacher_id, scheduled_at, duration_min, session_type")
      .eq("student_id", user.id).eq("status", "completed")
      .order("scheduled_at", { ascending: false }).limit(5)
      .returns<{ id: string; teacher_id: string; scheduled_at: string; duration_min: number; session_type: SessionType }[]>(),
    supabase.from("session_evaluations")
      .select("id, teacher_id, evaluation_type, overall_score, hifz_score, tajweed_score, strengths, weaknesses, recommendations, created_at")
      .eq("student_id", user.id)
      .order("created_at", { ascending: false }).limit(3)
      .returns<{ id: string; teacher_id: string; evaluation_type: string; overall_score: number; hifz_score: number | null; tajweed_score: number | null; strengths: string | null; weaknesses: string | null; recommendations: string | null; created_at: string }[]>(),
  ]);

  const fullName = profileRes.data?.full_name ?? null;
  const nextBooking = (nextBookingRes.data ?? [])[0] ?? null;
  const totalSessions = totalRes.count ?? 0;
  const monthSessions = monthRes.count ?? 0;
  const pendingBookings = pendingRes.count ?? 0;
  const recent = recentRes.data ?? [];
  const evaluations = evalsRes.data ?? [];

  // New students with no activity → guide them to teachers page
  if (totalSessions === 0 && pendingBookings === 0 && !nextBooking) {
    redirect("/student/teachers?new=1");
  }

  const allTeacherIds = [...new Set([
    nextBooking?.teacher_id,
    ...recent.map(r => r.teacher_id),
    ...evaluations.map(e => e.teacher_id),
  ].filter(Boolean) as string[])];
  let nameMap: Record<string, string> = {};
  if (allTeacherIds.length > 0) {
    const { data: profiles } = await supabase.from("profiles").select("id, full_name").in("id", allTeacherIds).returns<{ id: string; full_name: string | null }[]>();
    if (profiles) nameMap = Object.fromEntries(profiles.map(p => [p.id, p.full_name ?? "—"]));
  }

  let notesMap: Record<string, { post_session_notes: string | null; homework: string | null }> = {};
  if (recent.length > 0) {
    const { data } = await supabase.from("sessions")
      .select("booking_id, post_session_notes, homework")
      .in("booking_id", recent.map(r => r.id))
      .returns<{ booking_id: string; post_session_notes: string | null; homework: string | null }[]>();
    if (data) notesMap = Object.fromEntries(data.map(s => [s.booking_id, s]));
  }

  let sessionId: string | null = null;
  if (nextBooking) {
    const { data: session } = await supabase.from("sessions").select("id").eq("booking_id", nextBooking.id).single<{ id: string }>();
    sessionId = session?.id ?? null;
  }

  // Homework counts by status
  const { data: hwRaw } = await supabase
    .from("homework_assignments")
    .select("status")
    .eq("student_id", user.id)
    .returns<{ status: string }[]>();
  const hwCounts: Record<string, number> = {};
  for (const h of hwRaw ?? []) {
    hwCounts[h.status] = (hwCounts[h.status] ?? 0) + 1;
  }

  const [weeklyData, liveSessions, recentRecordings] = await Promise.all([
    getStudentWeeklyStudyTime(user.id),
    getStudentLiveSessions(user.id),
    getStudentRecentRecordings(user.id),
  ]);

  return (
    <StudentDashboardContent
      data={{
        fullName,
        nextBooking,
        sessionId,
        totalSessions,
        monthSessions,
        pendingBookings,
        recent,
        evaluations,
        nameMap,
        notesMap,
        weeklyData,
        liveSessions,
        recentRecordings,
        hwCounts,
      }}
    />
  );
}
