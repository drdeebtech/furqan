import type { Metadata } from "next";
import { redirect } from "next/navigation";
import Link from "next/link";
import { Calendar, Clock, Hourglass, Star, Users } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { BookingActions } from "./booking-actions";
import { TeacherSessionCard } from "./teacher-session-card";
import { TeacherGuidanceBanner } from "./guidance-banner";
import { TeacherQuickActions } from "./quick-actions";
import { SESSION_TYPE_AR } from "@/lib/constants";
import type { SessionType } from "@/types/database";

export const metadata: Metadata = { title: "لوحة المعلم" };

interface PendingBooking { id: string; scheduled_at: string; duration_min: number; session_type: SessionType; amount_usd: number; student_id: string; }

export default async function TeacherDashboardPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const todayStart = new Date(); todayStart.setHours(0, 0, 0, 0);
  const todayEnd = new Date(); todayEnd.setHours(23, 59, 59, 999);
  const monthStart = new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString();

  const [profileRes, tpRes, pendingRes, todayRes, monthRes, allStudentsRes] = await Promise.all([
    supabase.from("profiles").select("full_name").eq("id", user.id).single<{ full_name: string | null }>(),
    supabase.from("teacher_profiles").select("total_sessions, rating_avg, cv_status").eq("teacher_id", user.id)
      .single<{ total_sessions: number; rating_avg: number; cv_status: string }>(),
    supabase.from("bookings").select("id, scheduled_at, duration_min, session_type, amount_usd, student_id")
      .eq("teacher_id", user.id).eq("status", "pending").order("scheduled_at", { ascending: true }).returns<PendingBooking[]>(),
    supabase.from("bookings").select("id, scheduled_at, duration_min, session_type, student_id")
      .eq("teacher_id", user.id).eq("status", "confirmed")
      .gte("scheduled_at", todayStart.toISOString()).lte("scheduled_at", todayEnd.toISOString())
      .order("scheduled_at", { ascending: true }).returns<PendingBooking[]>(),
    supabase.from("bookings").select("id", { count: "exact", head: true }).eq("teacher_id", user.id).eq("status", "completed").gte("created_at", monthStart),
    supabase.from("bookings").select("student_id").eq("teacher_id", user.id).eq("status", "completed").returns<{ student_id: string }[]>(),
  ]);

  const fullName = profileRes.data?.full_name;
  const ratingAvg = Number(tpRes.data?.rating_avg ?? 0);
  const cvStatus = (tpRes.data?.cv_status ?? "draft") as "draft" | "pending_review" | "approved" | "rejected";
  const pending = pendingRes.data ?? [];
  const todaySessions = todayRes.data ?? [];
  const monthSessions = monthRes.count ?? 0;
  const uniqueStudents = new Set((allStudentsRes.data ?? []).map(s => s.student_id)).size;
  const pendingCount = pending.length;

  // Session data for today
  let sessionDataMap: Record<string, { id: string; room_url: string; expires_at: string | null; started_at: string | null; ended_at: string | null }> = {};
  if (todaySessions.length > 0) {
    const bIds = todaySessions.map(b => b.id);
    const { data: sessions } = await supabase.from("sessions").select("id, booking_id, room_url, expires_at, started_at, ended_at").in("booking_id", bIds).returns<{ id: string; booking_id: string; room_url: string; expires_at: string | null; started_at: string | null; ended_at: string | null }[]>();
    if (sessions) sessionDataMap = Object.fromEntries(sessions.map(s => [s.booking_id, s]));
  }

  // Student names
  const allStudentIds = [...new Set([...pending.map(b => b.student_id), ...todaySessions.map(b => b.student_id)])];
  let nameMap: Record<string, string> = {};
  if (allStudentIds.length > 0) {
    const ids = [...new Set(allStudentIds)];
    const { data: profiles } = await supabase.from("profiles").select("id, full_name").in("id", ids).returns<{ id: string; full_name: string | null }[]>();
    if (profiles) nameMap = Object.fromEntries(profiles.map(p => [p.id, p.full_name ?? "طالب"]));
  }

  return (
    <>
      <div className="h-0.5 bg-gradient-to-l from-gold/0 via-gold/30 to-gold/0" />
      <div dir="rtl" className="mx-auto max-w-4xl px-4 py-8">
        {/* ── Section 1: Greeting + Guidance ── */}
        <h1 className="text-2xl font-bold">أهلاً{fullName ? ` ${fullName}` : ""}</h1>
        <p className="mt-1 text-sm text-muted">مرحباً بك في لوحة المعلم</p>

        <TeacherGuidanceBanner cvStatus={cvStatus} hasStudents={uniqueStudents > 0} />

        {/* ── Section 2: Today's Sessions Hero ── */}
        {todaySessions.length > 0 && (
          <div className="mt-8">
            <h2 className="mb-4 flex items-center gap-2 text-lg font-semibold"><Calendar size={18} className="text-gold" /> جلسات اليوم</h2>
            <div className="space-y-3">
              {todaySessions.map(b => {
                const sess = sessionDataMap[b.id];
                return (
                  <TeacherSessionCard
                    key={b.id}
                    sessionId={sess?.id ?? null}
                    bookingId={b.id}
                    studentName={nameMap[b.student_id] ?? "طالب"}
                    sessionType={b.session_type}
                    scheduledAt={b.scheduled_at}
                    durationMin={b.duration_min}
                    roomUrl={sess?.room_url ?? null}
                    expiresAt={sess?.expires_at ?? null}
                    startedAt={sess?.started_at ?? null}
                    endedAt={sess?.ended_at ?? null}
                  />
                );
              })}
            </div>
          </div>
        )}

        {/* ── Section 3: Quick Actions ── */}
        <TeacherQuickActions
          students={Object.entries(nameMap).map(([id, name]) => ({ id, name }))}
        />

        {/* ── Section 4: Stats (clickable) ── */}
        <div className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Link href="/teacher/students" className="rounded-xl border border-card-border bg-card p-4 transition-colors hover:border-gold/40">
            <Users size={16} className="mb-1 text-gold" />
            <p className="text-2xl font-bold text-gold">{uniqueStudents}</p>
            <p className="text-xs text-muted">طلابي</p>
          </Link>
          <Link href="/teacher/sessions" className="rounded-xl border border-card-border bg-card p-4 transition-colors hover:border-gold/40">
            <Calendar size={16} className="mb-1 text-gold" />
            <p className="text-2xl font-bold text-gold">{monthSessions}</p>
            <p className="text-xs text-muted">جلسات هذا الشهر</p>
          </Link>
          <Link href="#pending" className="rounded-xl border border-card-border bg-card p-4 transition-colors hover:border-gold/40">
            <Hourglass size={16} className="mb-1 text-gold" />
            <p className="text-2xl font-bold text-gold">{pendingCount}</p>
            <p className="text-xs text-muted">طلبات معلّقة</p>
          </Link>
          <Link href="/teacher/evaluations" className="rounded-xl border border-card-border bg-card p-4 transition-colors hover:border-gold/40">
            <Star size={16} className="mb-1 text-gold" />
            <p className="text-2xl font-bold text-gold">{ratingAvg > 0 ? ratingAvg.toFixed(1) : "—"}</p>
            <p className="text-xs text-muted">التقييم</p>
          </Link>
        </div>

        {/* ── Section 5: Pending Bookings ── */}
        <div id="pending" className="mt-8">
          <h2 className="mb-4 flex items-center gap-2 text-lg font-semibold"><Clock size={18} className="text-gold" /> حجوزات بانتظار التأكيد</h2>
          {pending.length === 0 ? (
            <div className="rounded-xl border border-card-border bg-card p-8 text-center">
              <Clock size={24} className="mx-auto mb-2 text-muted" />
              <p className="text-sm text-muted">لا توجد حجوزات معلقة</p>
            </div>
          ) : (
            <div className="space-y-3">
              {pending.map(b => (
                <div key={b.id} className="rounded-xl border border-card-border bg-card p-4">
                  <div className="flex items-start justify-between gap-4">
                    <div className="min-w-0 flex-1">
                      <p className="font-medium">{nameMap[b.student_id] ?? "طالب"}</p>
                      <p className="mt-1 text-sm text-gold">{SESSION_TYPE_AR[b.session_type]} · {b.duration_min} دقيقة · ${b.amount_usd}</p>
                      <p dir="ltr" className="mt-1 text-left text-sm text-muted">
                        {new Date(b.scheduled_at).toLocaleDateString("ar-SA", { weekday: "long", year: "numeric", month: "long", day: "numeric" })}
                        {" · "}
                        {new Date(b.scheduled_at).toLocaleTimeString("ar-SA", { hour: "2-digit", minute: "2-digit" })}
                      </p>
                    </div>
                    <BookingActions bookingId={b.id} />
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </>
  );
}
