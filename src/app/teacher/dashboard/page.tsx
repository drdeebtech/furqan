import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { fetchNameMap } from "@/lib/supabase/helpers";
import type { SessionType } from "@/types/database";
import { TeacherDashboardContent } from "./dashboard-content";
import { TeacherAtRiskStudents } from "./at-risk-students";
import {
  getTeacherWeeklyHours,
  getTeacherLiveSessions,
  getTeacherSessionTypeBreakdown,
  getTeacherRecentStudents,
} from "@/lib/dashboard-queries";

export const metadata: Metadata = { title: "لوحة المعلم" };

interface PendingBooking { id: string; scheduled_at: string; duration_min: number; session_type: SessionType; amount_usd: number; student_id: string; }

export default async function TeacherDashboardPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const todayStart = new Date(); todayStart.setHours(0, 0, 0, 0);
  const todayEnd = new Date(); todayEnd.setHours(23, 59, 59, 999);
  const monthStart = new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString();

  // One big parallel batch — every query below only depends on user.id, so we
  // collapse what was previously three sequential round-trips down to two.
  // The remaining sequential hop is the unread-messages count, which has a
  // legit dependency on the conversation ids returned by convosRes.
  const [
    profileRes, tpRes, pendingRes, todayRes, monthRes, allStudentsRes, availRes,
    gradingRes, convosRes,
    weeklyHours, liveSessions, sessionBreakdown, recentStudents,
  ] = await Promise.all([
    supabase.from("profiles").select("full_name, phone, avatar_url").eq("id", user.id).single<{ full_name: string | null; phone: string | null; avatar_url: string | null }>(),
    supabase.from("teacher_profiles").select("total_sessions, rating_avg, cv_status, bio").eq("teacher_id", user.id)
      .single<{ total_sessions: number; rating_avg: number; cv_status: string; bio: string | null }>(),
    supabase.from("bookings").select("id, scheduled_at, duration_min, session_type, amount_usd, student_id")
      .eq("teacher_id", user.id).eq("status", "pending").order("scheduled_at", { ascending: true }).returns<PendingBooking[]>(),
    supabase.from("bookings").select("id, scheduled_at, duration_min, session_type, student_id")
      .eq("teacher_id", user.id).eq("status", "confirmed")
      .gte("scheduled_at", todayStart.toISOString()).lte("scheduled_at", todayEnd.toISOString())
      .order("scheduled_at", { ascending: true }).returns<PendingBooking[]>(),
    supabase.from("bookings").select("id", { count: "exact", head: true }).eq("teacher_id", user.id).eq("status", "completed").gte("created_at", monthStart),
    supabase.from("bookings").select("student_id").eq("teacher_id", user.id).eq("status", "completed").returns<{ student_id: string }[]>(),
    supabase.from("teacher_availability").select("id", { count: "exact", head: true }).eq("teacher_id", user.id).eq("is_active", true),
    supabase.from("homework_assignments").select("id", { count: "exact", head: true }).eq("teacher_id", user.id).eq("status", "student_ready"),
    supabase.from("conversations").select("id").eq("teacher_id", user.id).returns<{id:string}[]>(),
    getTeacherWeeklyHours(user.id),
    getTeacherLiveSessions(user.id),
    getTeacherSessionTypeBreakdown(user.id),
    getTeacherRecentStudents(user.id),
  ]);

  const convIds = convosRes.data?.map(c => c.id) ?? [];
  let unreadMessages = 0;
  if (convIds.length > 0) {
    const { count } = await supabase.from("messages").select("id", { count: "exact", head: true })
      .in("conversation_id", convIds).neq("sender_id", user.id).eq("is_read", false);
    unreadMessages = count ?? 0;
  }
  const pendingGrading = gradingRes.count ?? 0;

  const fullName = profileRes.data?.full_name ?? null;
  const hasProfile = !!(profileRes.data?.full_name && profileRes.data?.phone && profileRes.data?.avatar_url);
  const hasBio = !!(tpRes.data?.bio);
  const hasAvailability = (availRes.count ?? 0) > 0;
  const ratingAvg = Number(tpRes.data?.rating_avg ?? 0);
  const cvStatus = (tpRes.data?.cv_status ?? "draft") as "draft" | "pending_review" | "approved" | "rejected";
  const pending = pendingRes.data ?? [];
  const todaySessions = todayRes.data ?? [];
  const monthSessions = monthRes.count ?? 0;
  const uniqueStudents = new Set((allStudentsRes.data ?? []).map(s => s.student_id)).size;

  let sessionDataMap: Record<string, { id: string; room_url: string; expires_at: string | null; started_at: string | null; ended_at: string | null }> = {};
  if (todaySessions.length > 0) {
    const bIds = todaySessions.map(b => b.id);
    const { data: sessions } = await supabase.from("sessions").select("id, booking_id, room_url, expires_at, started_at, ended_at").in("booking_id", bIds).returns<{ id: string; booking_id: string; room_url: string; expires_at: string | null; started_at: string | null; ended_at: string | null }[]>();
    if (sessions) sessionDataMap = Object.fromEntries(sessions.map(s => [s.booking_id, s]));
  }

  const allStudentIds = [...new Set([...pending.map(b => b.student_id), ...todaySessions.map(b => b.student_id)])];
  const nameMap = await fetchNameMap(supabase, allStudentIds);

  return (
    <main>
      <TeacherDashboardContent
        data={{
          fullName,
          cvStatus,
          hasProfile,
          hasBio,
          hasAvailability,
          uniqueStudents,
          monthSessions,
          pendingCount: pending.length,
          ratingAvg,
          todaySessions,
          pending,
          sessionDataMap,
          nameMap,
          weeklyHours,
          liveSessions,
          sessionBreakdown,
          recentStudents,
          actionQueue: {
            pendingGrading,
            overdueEvals: 0,
            unreadMessages,
            todaySessionCount: todaySessions.length,
            lowAvailability: !hasAvailability,
          },
        }}
      />
      {cvStatus === "approved" && (
        <div className="mx-auto max-w-6xl px-4 pb-8 sm:px-6">
          <TeacherAtRiskStudents teacherId={user.id} />
        </div>
      )}
    </main>
  );
}
