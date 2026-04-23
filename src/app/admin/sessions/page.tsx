import type { Metadata } from "next";
import { redirect } from "next/navigation";
import Link from "next/link";
import { Video, Inbox, Radio, BarChart3, Users, TrendingUp } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { SessionStatus } from "@/components/shared/session-status";
import { SessionRowActions } from "./session-row-actions";

export const metadata: Metadata = { title: "إدارة الجلسات" };

interface SessionRow {
  id: string;
  booking_id: string;
  room_url: string;
  room_name: string;
  expires_at: string | null;
  started_at: string | null;
  ended_at: string | null;
  actual_duration: number | null;
  teacher_joined: boolean;
  student_joined: boolean;
  created_at: string;
}

interface BookingInfo {
  id: string;
  student_id: string;
  teacher_id: string;
  scheduled_at: string;
  duration_min: number;
}

export default async function AdminSessionsPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  /* ── Parallel queries ──────────────────────────────────────────── */
  const [sessionsRes, activeCountRes] = await Promise.all([
    supabase
      .from("sessions")
      .select("id, booking_id, room_url, room_name, expires_at, started_at, ended_at, actual_duration, teacher_joined, student_joined, created_at")
      .order("created_at", { ascending: false })
      .limit(100)
      .returns<SessionRow[]>(),
    supabase
      .from("sessions")
      .select("id", { count: "exact", head: true })
      .not("started_at", "is", null)
      .is("ended_at", null),
  ]);

  const list = sessionsRes.data ?? [];
  const activeCount = activeCountRes.count ?? 0;

  /* ── Booking + name resolution ─────────────────────────────────── */
  let bookingMap: Record<string, BookingInfo> = {};
  let nameMap: Record<string, string> = {};

  if (list.length > 0) {
    const bIds = list.map((s) => s.booking_id);
    const { data: bookings } = await supabase
      .from("bookings")
      .select("id, student_id, teacher_id, scheduled_at, duration_min")
      .in("id", bIds)
      .returns<BookingInfo[]>();
    if (bookings) {
      bookingMap = Object.fromEntries(bookings.map((b) => [b.id, b]));
      const pIds = [...new Set([...bookings.map((b) => b.student_id), ...bookings.map((b) => b.teacher_id)])];
      const { data: profiles } = await supabase
        .from("profiles")
        .select("id, full_name")
        .in("id", pIds)
        .returns<{ id: string; full_name: string | null }[]>();
      if (profiles) nameMap = Object.fromEntries(profiles.map((p) => [p.id, p.full_name ?? "—"]));
    }
  }

  /* ── Compute metrics ───────────────────────────────────────────── */
  const totalSessions = list.length;

  const bothJoinedCount = list.filter((s) => s.teacher_joined && s.student_joined).length;
  const completedCount = list.filter((s) => s.ended_at).length;
  const attendanceRate = completedCount > 0
    ? Math.round((bothJoinedCount / completedCount) * 100)
    : 0;

  const sessionsWithDuration = list.filter(
    (s) => s.actual_duration && bookingMap[s.booking_id]?.duration_min,
  );
  const avgDurationRatio =
    sessionsWithDuration.length > 0
      ? Math.round(
          sessionsWithDuration.reduce((sum, s) => {
            const b = bookingMap[s.booking_id];
            return sum + (s.actual_duration! / b.duration_min) * 100;
          }, 0) / sessionsWithDuration.length,
        )
      : 0;

  // eslint-disable-next-line react-hooks/purity -- server component, Date.now() is fine
  const now = Date.now();

  return (
    <div dir="rtl" className="mx-auto max-w-6xl px-4 py-8">
      {/* Header */}
      <div className="mb-6 flex flex-wrap items-center gap-3">
        <h1 className="flex items-center gap-2 text-2xl font-bold">
          <Video size={24} className="text-gold" /> إدارة الجلسات
        </h1>
        <Link
          href="/admin/sessions/live"
          className="mr-auto inline-flex items-center gap-2 rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-4 py-2 text-sm font-medium text-emerald-400 transition-colors hover:bg-emerald-500/20"
        >
          <Radio size={14} className="animate-pulse" />
          المراقبة المباشرة
          {activeCount > 0 && (
            <span className="rounded-full bg-emerald-500/20 px-2 py-0.5 text-xs font-bold">
              {activeCount}
            </span>
          )}
        </Link>
      </div>

      {/* ── Metrics Summary ─────────────────────────────────────────── */}
      <div className="mb-6 grid grid-cols-2 gap-3 md:grid-cols-4">
        <div className="glass-card p-4">
          <div className="flex items-center gap-2 text-sm text-muted">
            <BarChart3 size={14} />
            إجمالي الجلسات
          </div>
          <p className="mt-1 text-2xl font-bold text-gold">{totalSessions}</p>
        </div>

        <Link
          href="/admin/sessions/live"
          className="rounded-2xl border border-emerald-500/30 bg-emerald-500/5 p-4 transition-colors hover:bg-emerald-500/10"
        >
          <div className="flex items-center gap-2 text-sm text-muted">
            <Radio size={14} className="text-emerald-400" />
            نشطة الآن
          </div>
          <p className="mt-1 text-2xl font-bold text-emerald-400">{activeCount}</p>
        </Link>

        <div className="glass-card p-4">
          <div className="flex items-center gap-2 text-sm text-muted">
            <Users size={14} />
            نسبة الحضور
          </div>
          <p className="mt-1 text-2xl font-bold text-gold">{attendanceRate}%</p>
        </div>

        <div className="glass-card p-4">
          <div className="flex items-center gap-2 text-sm text-muted">
            <TrendingUp size={14} />
            نسبة المدة
          </div>
          <p className="mt-1 text-2xl font-bold text-gold">{avgDurationRatio}%</p>
        </div>
      </div>

      {/* ── Sessions Table ──────────────────────────────────────────── */}
      {list.length === 0 ? (
        <div className="glass-card p-12 text-center">
          <Inbox size={32} className="mx-auto mb-3 text-muted" />
          <p className="text-muted">لا توجد جلسات</p>
        </div>
      ) : (
        <div className="overflow-x-auto rounded-2xl glass-card">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-white/10 bg-white/5">
                <th scope="col" className="px-3 py-3 text-right font-medium text-muted">الطالب</th>
                <th scope="col" className="px-3 py-3 text-right font-medium text-muted">المعلم</th>
                <th scope="col" className="px-3 py-3 text-right font-medium text-muted">الموعد</th>
                <th scope="col" className="px-3 py-3 text-right font-medium text-muted">الحالة</th>
                <th scope="col" className="px-3 py-3 text-right font-medium text-muted">المدة</th>
                <th scope="col" className="px-3 py-3 text-right font-medium text-muted">الحضور</th>
                <th scope="col" className="px-3 py-3 text-right font-medium text-muted">إجراءات</th>
              </tr>
            </thead>
            <tbody>
              {list.map((s) => {
                const b = bookingMap[s.booking_id];
                const isActive = !!s.started_at && !s.ended_at;
                const isExpired =
                  s.expires_at &&
                  new Date(s.expires_at).getTime() < now &&
                  !s.ended_at;

                return (
                  <tr key={s.id} className="border-b border-white/10 last:border-b-0 hover:bg-surface-alt/50">
                    <td className="px-3 py-3">
                      <Link href={`/admin/sessions/${s.id}`} className="text-gold hover:underline">
                        {b ? nameMap[b.student_id] ?? "—" : "—"}
                      </Link>
                    </td>
                    <td className="px-3 py-3">{b ? nameMap[b.teacher_id] ?? "—" : "—"}</td>
                    <td className="px-3 py-3 text-xs text-muted">
                      {b ? new Date(b.scheduled_at).toLocaleDateString("ar-SA") : "—"}
                    </td>
                    <td className="px-3 py-3">
                      {b ? (
                        <SessionStatus
                          scheduledAt={b.scheduled_at}
                          durationMin={b.duration_min}
                          expiresAt={s.expires_at}
                          endedAt={s.ended_at}
                        />
                      ) : (
                        <span className="text-xs text-muted">—</span>
                      )}
                    </td>
                    <td className="px-3 py-3 text-xs">
                      {s.actual_duration
                        ? `${s.actual_duration} د`
                        : s.ended_at
                          ? "—"
                          : s.started_at
                            ? <span className="text-emerald-400">جارية</span>
                            : "—"}
                    </td>
                    <td className="px-3 py-3 text-xs">
                      <span className={s.teacher_joined ? "text-emerald-400" : "text-red-400"}>
                        م{s.teacher_joined ? "✓" : "✗"}
                      </span>{" "}
                      <span className={s.student_joined ? "text-emerald-400" : "text-red-400"}>
                        ط{s.student_joined ? "✓" : "✗"}
                      </span>
                    </td>
                    <td className="px-3 py-3">
                      <SessionRowActions
                        sessionId={s.id}
                        isActive={isActive}
                        isExpired={!!isExpired}
                      />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
