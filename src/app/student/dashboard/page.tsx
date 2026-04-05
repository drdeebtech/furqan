import type { Metadata } from "next";
import { redirect } from "next/navigation";
import Link from "next/link";
import { Calendar, CheckCircle, Clock, Search, Star, TrendingUp, Video } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { SESSION_TYPE_AR } from "@/lib/constants";
import type { BookingStatus, SessionType } from "@/types/database";

export const metadata: Metadata = { title: "لوحتي" };

export default async function StudentDashboardPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const monthStart = new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString();

  const [profileRes, nextBookingRes, totalRes, monthRes, pendingRes, recentRes] = await Promise.all([
    supabase.from("profiles").select("full_name").eq("id", user.id).single<{ full_name: string | null }>(),
    supabase.from("bookings")
      .select("id, teacher_id, scheduled_at, duration_min, session_type, status")
      .eq("student_id", user.id).eq("status", "confirmed")
      .gt("scheduled_at", new Date().toISOString())
      .order("scheduled_at", { ascending: true }).limit(1)
      .returns<{ id: string; teacher_id: string; scheduled_at: string; duration_min: number; session_type: SessionType; status: BookingStatus }[]>(),
    supabase.from("bookings").select("id", { count: "exact", head: true }).eq("student_id", user.id).eq("status", "completed"),
    supabase.from("bookings").select("id", { count: "exact", head: true }).eq("student_id", user.id).eq("status", "completed").gte("created_at", monthStart),
    supabase.from("bookings").select("id", { count: "exact", head: true }).eq("student_id", user.id).eq("status", "pending"),
    supabase.from("bookings")
      .select("id, teacher_id, scheduled_at, duration_min, session_type")
      .eq("student_id", user.id).eq("status", "completed")
      .order("scheduled_at", { ascending: false }).limit(5)
      .returns<{ id: string; teacher_id: string; scheduled_at: string; duration_min: number; session_type: SessionType }[]>(),
  ]);

  const fullName = profileRes.data?.full_name;
  const nextBooking = (nextBookingRes.data ?? [])[0] ?? null;
  const totalSessions = totalRes.count ?? 0;
  const monthSessions = monthRes.count ?? 0;
  const pendingBookings = pendingRes.count ?? 0;
  const recent = recentRes.data ?? [];

  // Fetch teacher names for next booking + recent
  const allTeacherIds = [...new Set([nextBooking?.teacher_id, ...recent.map(r => r.teacher_id)].filter(Boolean) as string[])];
  let nameMap: Record<string, string> = {};
  if (allTeacherIds.length > 0) {
    const { data: profiles } = await supabase.from("profiles").select("id, full_name").in("id", allTeacherIds).returns<{ id: string; full_name: string | null }[]>();
    if (profiles) nameMap = Object.fromEntries(profiles.map(p => [p.id, p.full_name ?? "معلم"]));
  }

  // Fetch session for next booking
  let roomUrl: string | null = null;
  let sessionId: string | null = null;
  if (nextBooking) {
    const { data: session } = await supabase.from("sessions").select("id, room_url").eq("booking_id", nextBooking.id).single<{ id: string; room_url: string }>();
    roomUrl = session?.room_url ?? null;
    sessionId = session?.id ?? null;
  }

  // Countdown calc
  let countdown = "";
  let countdownColor = "text-muted";
  if (nextBooking) {
    const diff = new Date(nextBooking.scheduled_at).getTime() - Date.now();
    const mins = Math.floor(diff / 60000);
    const hours = Math.floor(mins / 60);
    const days = Math.floor(hours / 24);
    if (mins < 60) { countdown = `بعد ${mins} دقيقة`; countdownColor = "text-red-400"; }
    else if (hours < 24) { countdown = `بعد ${hours} ساعة`; countdownColor = "text-amber-400"; }
    else { countdown = `بعد ${days} يوم`; }
  }

  const canJoin = !!nextBooking && !!roomUrl;

  return (
    <>
      <div className="h-0.5 bg-gradient-to-l from-gold/0 via-gold/30 to-gold/0" />
      <div dir="rtl" className="mx-auto max-w-4xl px-4 py-8">
        <h1 className="text-2xl font-bold">أهلاً{fullName ? ` ${fullName}` : ""}</h1>
        <p className="mt-1 text-sm text-muted">Welcome to your dashboard</p>

        {/* Next Session Widget */}
        {nextBooking ? (
          <div className="mt-8 rounded-2xl border border-gold/30 bg-card p-8">
            <p className="mb-2 text-sm font-bold text-gold"><Star size={14} className="inline text-gold" /> جلستك القادمة</p>
            <p className="text-lg font-bold">مع {nameMap[nextBooking.teacher_id] ?? "معلم"}</p>
            <p className="mt-1 text-sm text-muted">
              {SESSION_TYPE_AR[nextBooking.session_type]} · {nextBooking.duration_min} دقيقة
            </p>
            <p dir="ltr" className="mt-2 text-left text-sm text-muted">
              {new Date(nextBooking.scheduled_at).toLocaleDateString("ar-SA", { weekday: "long", year: "numeric", month: "long", day: "numeric" })}
              {" · "}
              {new Date(nextBooking.scheduled_at).toLocaleTimeString("ar-SA", { hour: "2-digit", minute: "2-digit" })}
            </p>
            <p className={`mt-2 text-sm font-medium ${countdownColor}`}>{countdown}</p>
            <div className="mt-4 flex flex-wrap gap-3">
              {sessionId && (
                <Link
                  href={`/student/sessions/${sessionId}`}
                  className="flex items-center gap-2 rounded-lg bg-green-600 px-6 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-green-700"
                >
                  <Video size={16} /> انضم للجلسة
                </Link>
              )}
              <Link href={`/student/sessions`} className="rounded-lg border border-card-border px-4 py-2.5 text-sm text-muted transition-colors hover:border-gold/40 hover:text-gold">
                تفاصيل الحجز
              </Link>
            </div>
          </div>
        ) : (
          <div className="mt-8 rounded-2xl border-2 border-dashed border-card-border p-8 text-center">
            <Calendar size={28} className="mx-auto mb-3 text-muted" />
            <p className="text-muted">لا توجد جلسات قادمة</p>
            <p className="mt-1 text-sm text-muted">احجز جلستك الأولى مع معلم مؤهل</p>
            <Link href="/student/teachers" className="mt-4 inline-flex items-center gap-2 rounded-lg bg-gold px-6 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-gold-hover">
              <Search size={16} /> احجز جلسة الآن
            </Link>
          </div>
        )}

        {/* Stats */}
        <div className="mt-8 grid grid-cols-2 gap-3 md:grid-cols-4">
          {[
            { v: totalSessions, l: "إجمالي الجلسات", icon: CheckCircle },
            { v: monthSessions, l: "جلسات هذا الشهر", icon: Calendar },
            { v: pendingBookings, l: "حجوزات معلّقة", icon: Clock },
          ].map(s => (
            <div key={s.l} className="rounded-xl border border-card-border bg-card p-4">
              <s.icon size={16} className="mb-1 text-gold" />
              <p className="text-2xl font-bold text-gold">{s.v}</p>
              <p className="text-xs text-muted">{s.l}</p>
            </div>
          ))}
          <Link href="/student/progress" className="rounded-xl border border-gold/20 bg-gold/5 p-4 transition-colors hover:border-gold/40">
            <TrendingUp size={16} className="mb-1 text-gold" />
            <p className="text-sm font-bold text-gold">تقدمي</p>
            <p className="text-xs text-muted">عرض رحلتي مع القرآن</p>
          </Link>
        </div>

        {/* Recent Sessions */}
        {recent.length > 0 && (
          <div className="mt-8">
            <div className="mb-4 flex items-center justify-between">
              <h2 className="flex items-center gap-2 text-lg font-semibold"><CheckCircle size={18} className="text-gold" /> آخر الجلسات</h2>
              <Link href="/student/bookings" className="text-sm text-gold hover:text-gold-hover">عرض الكل ←</Link>
            </div>
            <div className="space-y-2">
              {recent.map(r => (
                <Link key={r.id} href="/student/sessions" className="flex items-center gap-3 rounded-lg border border-card-border bg-card px-4 py-3 transition-colors hover:border-gold/30">
                  <CheckCircle size={16} className="shrink-0 text-gold" />
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium">{nameMap[r.teacher_id] ?? "معلم"}</p>
                    <p className="text-xs text-muted">{SESSION_TYPE_AR[r.session_type]} · {r.duration_min} د</p>
                  </div>
                  <p className="text-xs text-muted">{new Date(r.scheduled_at).toLocaleDateString("ar-SA")}</p>
                  <span className="text-xs text-gold">←</span>
                </Link>
              ))}
            </div>
          </div>
        )}
      </div>
    </>
  );
}
