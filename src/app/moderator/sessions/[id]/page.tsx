import type { Metadata } from "next";
import { redirect, notFound } from "next/navigation";
import Link from "next/link";
import { ArrowRight, Video, User, GraduationCap, Clock, Eye } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { SessionStatus } from "@/components/shared/session-status";

export const metadata: Metadata = { title: "تفاصيل الجلسة" };

interface SessionRow {
  id: string; booking_id: string; room_name: string; room_url: string; expires_at: string | null;
  created_via: string; started_at: string | null; ended_at: string | null; actual_duration: number | null;
  teacher_joined: boolean; student_joined: boolean; post_session_notes: string | null;
  is_observable: boolean; created_at: string;
}
interface BookingRow { id: string; student_id: string; teacher_id: string; scheduled_at: string; duration_min: number; session_type: string; status: string; }

export default async function ModeratorSessionDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: session } = await supabase.from("sessions")
    .select("id, booking_id, room_name, room_url, expires_at, created_via, started_at, ended_at, actual_duration, teacher_joined, student_joined, post_session_notes, is_observable, created_at")
    .eq("id", id).single().then(r => ({ data: r.data as SessionRow | null }));
  if (!session) notFound();

  const { data: booking } = await supabase.from("bookings")
    .select("id, student_id, teacher_id, scheduled_at, duration_min, session_type, status")
    .eq("id", session.booking_id).single().then(r => ({ data: r.data as BookingRow | null }));

  let nameMap: Record<string, string> = {};
  if (booking) {
    const { data: profiles } = await supabase.from("profiles").select("id, full_name")
      .in("id", [booking.student_id, booking.teacher_id]).returns<{ id: string; full_name: string | null }[]>();
    if (profiles) nameMap = Object.fromEntries(profiles.map(p => [p.id, p.full_name ?? "—"]));
  }

  const isActive = !!session.started_at && !session.ended_at;
  const formatDT = (d: string | null) => d ? new Date(d).toLocaleString("ar-SA") : "—";

  return (
    <div dir="rtl" className="mx-auto max-w-4xl px-4 py-8">
      <div className="mb-6 flex items-center gap-3">
        <Link href="/moderator/sessions" className="rounded-lg border border-card-border p-2 text-muted transition-colors hover:bg-surface-alt">
          <ArrowRight size={16} />
        </Link>
        <h1 className="flex items-center gap-2 text-2xl font-bold"><Video size={24} className="text-gold" /> تفاصيل الجلسة</h1>
        {booking && <SessionStatus scheduledAt={booking.scheduled_at} durationMin={booking.duration_min} expiresAt={session.expires_at} endedAt={session.ended_at} size="md" />}
      </div>

      {isActive && session.is_observable && (
        <Link href={`/moderator/sessions/${id}/observe`}
          className="mb-6 flex items-center justify-center gap-2 rounded-xl border border-gold/30 bg-gold/10 px-6 py-3 text-sm font-medium text-gold transition-colors hover:bg-gold/20">
          <Eye size={16} /> مراقبة الجلسة
        </Link>
      )}

      <div className="rounded-2xl border border-card-border bg-card p-6">
        <h2 className="mb-4 text-lg font-semibold">معلومات الجلسة</h2>
        <div className="grid gap-4 sm:grid-cols-2">
          <div><p className="text-xs text-muted">معرف الجلسة</p><p className="mt-0.5 text-sm font-mono" dir="ltr">{session.id}</p></div>
          <div><p className="text-xs text-muted">طريقة الإنشاء</p><p className="mt-0.5 text-sm">{session.created_via}</p></div>
          <div><p className="text-xs text-muted">المدة الفعلية</p><p className="mt-0.5 text-sm">{session.actual_duration ? `${session.actual_duration} دقيقة` : "—"}</p></div>
          <div><p className="text-xs text-muted">تاريخ الإنشاء</p><p className="mt-0.5 text-sm">{formatDT(session.created_at)}</p></div>
        </div>
      </div>

      {booking && (
        <div className="mt-4 rounded-2xl border border-card-border bg-card p-6">
          <h2 className="mb-4 text-lg font-semibold">معلومات الحجز</h2>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="flex items-center gap-2"><User size={14} className="text-muted" /><div><p className="text-xs text-muted">الطالب</p><p className="mt-0.5 text-sm font-medium">{nameMap[booking.student_id] ?? "—"}</p></div></div>
            <div className="flex items-center gap-2"><GraduationCap size={14} className="text-muted" /><div><p className="text-xs text-muted">المعلم</p><p className="mt-0.5 text-sm font-medium">{nameMap[booking.teacher_id] ?? "—"}</p></div></div>
            <div><p className="text-xs text-muted">الموعد</p><p className="mt-0.5 text-sm">{formatDT(booking.scheduled_at)}</p></div>
            <div><p className="text-xs text-muted">المدة المحددة</p><p className="mt-0.5 text-sm">{booking.duration_min} دقيقة</p></div>
          </div>
        </div>
      )}

      <div className="mt-4 rounded-2xl border border-card-border bg-card p-6">
        <h2 className="mb-4 flex items-center gap-2 text-lg font-semibold"><Clock size={18} className="text-gold" /> الجدول الزمني</h2>
        <div className="space-y-3">
          {[
            { label: "إنشاء الجلسة", time: session.created_at, active: true },
            { label: "بدء الجلسة", time: session.started_at, active: !!session.started_at },
            { label: "انضمام المعلم", time: session.teacher_joined ? session.started_at : null, active: session.teacher_joined },
            { label: "انضمام الطالب", time: session.student_joined ? session.started_at : null, active: session.student_joined },
            { label: "انتهاء الجلسة", time: session.ended_at, active: !!session.ended_at },
          ].map((step, i) => (
            <div key={i} className="flex items-center gap-3">
              <div className={`h-3 w-3 rounded-full ${step.active ? "bg-emerald-400" : "bg-muted/30"}`} />
              <p className={`text-sm ${step.active ? "font-medium" : "text-muted"}`}>{step.label}</p>
              <p className="mr-auto text-xs text-muted">{step.time ? formatDT(step.time) : "—"}</p>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
