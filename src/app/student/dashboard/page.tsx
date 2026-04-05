import type { Metadata } from "next";
import { redirect } from "next/navigation";
import Link from "next/link";
import { Calendar, CheckCircle, Clock, Search, Star, TrendingUp, Video, BookOpen, FileText, AlertTriangle } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { SESSION_TYPE_AR } from "@/lib/constants";
import type { SessionType } from "@/types/database";
import { GuidanceBanner } from "./guidance-banner";
import { QuickActions } from "./quick-actions";

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
    // Fetch latest evaluations for this student
    supabase.from("session_evaluations")
      .select("id, teacher_id, evaluation_type, overall_score, hifz_score, tajweed_score, strengths, weaknesses, recommendations, created_at")
      .eq("student_id", user.id)
      .order("created_at", { ascending: false })
      .limit(3)
      .returns<{ id: string; teacher_id: string; evaluation_type: string; overall_score: number; hifz_score: number | null; tajweed_score: number | null; strengths: string | null; weaknesses: string | null; recommendations: string | null; created_at: string }[]>(),
  ]);

  const fullName = profileRes.data?.full_name;
  const nextBooking = (nextBookingRes.data ?? [])[0] ?? null;
  const totalSessions = totalRes.count ?? 0;
  const monthSessions = monthRes.count ?? 0;
  const pendingBookings = pendingRes.count ?? 0;
  const recent = recentRes.data ?? [];
  const evaluations = evalsRes.data ?? [];

  // Fetch teacher names
  const allTeacherIds = [...new Set([
    nextBooking?.teacher_id,
    ...recent.map(r => r.teacher_id),
    ...evaluations.map(e => e.teacher_id),
  ].filter(Boolean) as string[])];
  let nameMap: Record<string, string> = {};
  if (allTeacherIds.length > 0) {
    const { data: profiles } = await supabase.from("profiles").select("id, full_name").in("id", allTeacherIds).returns<{ id: string; full_name: string | null }[]>();
    if (profiles) nameMap = Object.fromEntries(profiles.map(p => [p.id, p.full_name ?? "معلم"]));
  }

  // Fetch session + notes for recent bookings
  let sessionNotes: { booking_id: string; post_session_notes: string | null; homework: string | null }[] = [];
  if (recent.length > 0) {
    const bIds = recent.map(r => r.id);
    const { data } = await supabase.from("sessions")
      .select("booking_id, post_session_notes, homework")
      .in("booking_id", bIds)
      .returns<typeof sessionNotes>();
    sessionNotes = data ?? [];
  }
  const notesMap = Object.fromEntries(sessionNotes.map(s => [s.booking_id, s]));

  // Fetch session for next booking
  let sessionId: string | null = null;
  if (nextBooking) {
    const { data: session } = await supabase.from("sessions").select("id").eq("booking_id", nextBooking.id).single<{ id: string }>();
    sessionId = session?.id ?? null;
  }

  // Pending homework (from recent sessions)
  const pendingHomework = sessionNotes.filter(s => s.homework);

  // Countdown
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

  return (
    <>
      <div className="h-0.5 bg-gradient-to-l from-gold/0 via-gold/30 to-gold/0" />
      <div dir="rtl" className="mx-auto max-w-4xl px-4 py-8">
        {/* ── Section 1: Greeting + Guidance ── */}
        <h1 className="text-2xl font-bold">أهلاً{fullName ? ` ${fullName}` : ""}</h1>
        <p className="mt-1 text-sm text-muted">مرحباً بك في أكاديمية فُرقان</p>

        {totalSessions === 0 && !nextBooking && <GuidanceBanner />}

        {/* ── Section 2: Next Session Hero ── */}
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
            <div className="mt-4 flex flex-wrap items-center gap-3">
              {sessionId && (
                <Link
                  href={`/student/sessions/${sessionId}`}
                  className="flex items-center gap-2 rounded-lg bg-green-600 px-6 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-green-700"
                >
                  <Video size={16} /> انضم للجلسة
                </Link>
              )}
              <Link href="/student/teachers" className="text-sm text-gold hover:text-gold-hover">
                احجز جلسة أخرى ←
              </Link>
            </div>
          </div>
        ) : totalSessions > 0 ? (
          <div className="mt-8 rounded-2xl border-2 border-dashed border-card-border p-8 text-center">
            <Calendar size={28} className="mx-auto mb-3 text-muted" />
            <p className="text-muted">لا توجد جلسات قادمة</p>
            <Link href="/student/teachers" className="mt-4 inline-flex items-center gap-2 rounded-lg bg-gold px-6 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-gold-hover">
              <Search size={16} /> احجز جلسة الآن
            </Link>
          </div>
        ) : null}

        {/* ── Section 3: Quick Actions ── */}
        <QuickActions />

        {/* ── Section 4: Stats (clickable) ── */}
        <div className="mt-6 grid grid-cols-2 gap-3 md:grid-cols-4">
          <Link href="/student/sessions" className="rounded-xl border border-card-border bg-card p-4 transition-colors hover:border-gold/40">
            <CheckCircle size={16} className="mb-1 text-gold" />
            <p className="text-2xl font-bold text-gold">{totalSessions}</p>
            <p className="text-xs text-muted">إجمالي الجلسات</p>
          </Link>
          <Link href="/student/sessions" className="rounded-xl border border-card-border bg-card p-4 transition-colors hover:border-gold/40">
            <Calendar size={16} className="mb-1 text-gold" />
            <p className="text-2xl font-bold text-gold">{monthSessions}</p>
            <p className="text-xs text-muted">جلسات هذا الشهر</p>
          </Link>
          <Link href="/student/bookings" className="rounded-xl border border-card-border bg-card p-4 transition-colors hover:border-gold/40">
            <Clock size={16} className="mb-1 text-gold" />
            <p className="text-2xl font-bold text-gold">{pendingBookings}</p>
            <p className="text-xs text-muted">حجوزات معلّقة</p>
          </Link>
          <Link href="/student/progress" className="rounded-xl border border-gold/20 bg-gold/5 p-4 transition-colors hover:border-gold/40">
            <TrendingUp size={16} className="mb-1 text-gold" />
            <p className="text-sm font-bold text-gold">تقدمي</p>
            <p className="text-xs text-muted">عرض رحلتي مع القرآن</p>
          </Link>
        </div>

        {/* ── Section 5: Homework (if any) ── */}
        {pendingHomework.length > 0 && (
          <div className="mt-8">
            <h2 className="mb-4 flex items-center gap-2 text-lg font-semibold">
              <BookOpen size={18} className="text-gold" /> الواجبات المنزلية
            </h2>
            <div className="space-y-2">
              {pendingHomework.map(h => {
                const booking = recent.find(r => r.id === h.booking_id);
                return (
                  <div key={h.booking_id} className="rounded-xl border border-blue-500/20 bg-blue-500/5 p-4">
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <p className="text-sm font-medium">{booking ? nameMap[booking.teacher_id] ?? "معلم" : "معلم"}</p>
                        <p className="mt-1 text-sm">{h.homework}</p>
                      </div>
                      {booking && (
                        <p className="shrink-0 text-xs text-muted">{new Date(booking.scheduled_at).toLocaleDateString("ar-SA")}</p>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* ── Section 6: Latest Evaluations from Teachers ── */}
        {evaluations.length > 0 && (
          <div className="mt-8">
            <h2 className="mb-4 flex items-center gap-2 text-lg font-semibold">
              <Star size={18} className="text-gold" /> تقييمات معلمك
            </h2>
            <div className="space-y-3">
              {evaluations.map(ev => (
                <div key={ev.id} className="rounded-xl border border-card-border bg-card p-4">
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <p className="text-sm font-medium">{nameMap[ev.teacher_id] ?? "معلم"}</p>
                      <p className="mt-0.5 text-xs text-muted">{ev.evaluation_type}</p>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className={`rounded-full border px-3 py-1 text-sm font-bold ${
                        ev.overall_score >= 8 ? "border-green-500/30 text-green-400" :
                        ev.overall_score >= 5 ? "border-amber-500/30 text-amber-400" :
                        "border-red-500/30 text-red-400"
                      }`}>
                        {ev.overall_score}/10
                      </span>
                    </div>
                  </div>
                  {/* Score breakdown */}
                  <div className="mt-3 flex flex-wrap gap-3 text-xs">
                    {ev.hifz_score && <span className="rounded border border-card-border px-2 py-0.5">حفظ: {ev.hifz_score}/10</span>}
                    {ev.tajweed_score && <span className="rounded border border-card-border px-2 py-0.5">تجويد: {ev.tajweed_score}/10</span>}
                  </div>
                  {/* Feedback */}
                  {ev.strengths && (
                    <p className="mt-2 text-xs"><span className="text-green-400">نقاط القوة:</span> {ev.strengths}</p>
                  )}
                  {ev.weaknesses && (
                    <p className="mt-1 text-xs"><span className="text-amber-400">نقاط الضعف:</span> {ev.weaknesses}</p>
                  )}
                  {ev.recommendations && (
                    <p className="mt-1 text-xs"><span className="text-gold">توصيات:</span> {ev.recommendations}</p>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

        {/* ── Section 7: Recent Sessions with Notes ── */}
        {recent.length > 0 && (
          <div className="mt-8">
            <div className="mb-4 flex items-center justify-between">
              <h2 className="flex items-center gap-2 text-lg font-semibold"><FileText size={18} className="text-gold" /> آخر الجلسات</h2>
              <Link href="/student/sessions" className="text-sm text-gold hover:text-gold-hover">عرض الكل ←</Link>
            </div>
            <div className="space-y-3">
              {recent.map(r => {
                const note = notesMap[r.id];
                return (
                  <div key={r.id} className="rounded-xl border border-card-border bg-card p-4">
                    <div className="flex items-center justify-between">
                      <div>
                        <p className="text-sm font-medium">{nameMap[r.teacher_id] ?? "معلم"}</p>
                        <p className="text-xs text-muted">{SESSION_TYPE_AR[r.session_type]} · {r.duration_min} د</p>
                      </div>
                      <p className="text-xs text-muted">{new Date(r.scheduled_at).toLocaleDateString("ar-SA")}</p>
                    </div>
                    {note?.post_session_notes && (
                      <div className="mt-2 rounded-lg border border-gold/20 bg-gold/5 p-2">
                        <p className="text-xs font-medium text-gold"><FileText size={10} className="inline" /> ملاحظات المعلم:</p>
                        <p className="mt-0.5 text-xs text-muted">{note.post_session_notes.length > 120 ? note.post_session_notes.slice(0, 120) + "…" : note.post_session_notes}</p>
                      </div>
                    )}
                    {note?.homework && (
                      <div className="mt-1 rounded-lg border border-blue-500/20 bg-blue-500/5 p-2">
                        <p className="text-xs font-medium text-blue-400"><BookOpen size={10} className="inline" /> واجب:</p>
                        <p className="mt-0.5 text-xs text-muted">{note.homework.length > 100 ? note.homework.slice(0, 100) + "…" : note.homework}</p>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>
    </>
  );
}
