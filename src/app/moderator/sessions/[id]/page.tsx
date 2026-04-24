import type { Metadata } from "next";
import { redirect, notFound } from "next/navigation";
import Link from "next/link";
import { ArrowRight, Video, User, GraduationCap, Clock, Eye } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { SessionStatus } from "@/components/shared/session-status";
import { getT } from "@/lib/i18n/server";
import { riskBadgeClass, riskLabel } from "@/lib/retention/ui";

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
  const { t, dir, lang } = await getT();
  const locale = lang === "ar" ? "ar-SA" : "en-US";
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
  let studentRisk: number | null = null;
  if (booking) {
    const [profilesRes, retentionRes] = await Promise.all([
      supabase.from("profiles").select("id, full_name")
        .in("id", [booking.student_id, booking.teacher_id]).returns<{ id: string; full_name: string | null }[]>(),
      supabase.from("retention_signals").select("churn_risk_score").eq("student_id", booking.student_id)
        .maybeSingle<{ churn_risk_score: number | null }>(),
    ]);
    if (profilesRes.data) nameMap = Object.fromEntries(profilesRes.data.map(p => [p.id, p.full_name ?? "—"]));
    studentRisk = retentionRes.data?.churn_risk_score ?? null;
  }

  const isActive = !!session.started_at && !session.ended_at;
  const formatDT = (d: string | null) => d ? new Date(d).toLocaleString(locale) : "—";

  return (
    <div dir={dir} className="mx-auto max-w-4xl px-4 py-8">
      <div className="mb-6 flex items-center gap-3">
        <Link href="/moderator/sessions" className="glass rounded-lg p-2 text-muted transition-colors hover:bg-white/10">
          <ArrowRight size={16} />
        </Link>
        <h1 className="flex items-center gap-2 text-2xl font-bold"><Video size={24} className="text-gold" /> {t("تفاصيل الجلسة", "Session Details")}</h1>
        {booking && <SessionStatus scheduledAt={booking.scheduled_at} durationMin={booking.duration_min} expiresAt={session.expires_at} endedAt={session.ended_at} size="md" />}
      </div>

      {isActive && session.is_observable && (
        <Link href={`/moderator/sessions/${id}/observe`}
          className="glass glass-pill mb-6 flex items-center justify-center gap-2 rounded-xl px-6 py-3 text-sm font-medium text-gold transition-colors hover:bg-white/10">
          <Eye size={16} /> {t("مراقبة الجلسة", "Observe Session")}
        </Link>
      )}

      <div className="glass-card p-6">
        <h2 className="mb-4 text-lg font-semibold">{t("معلومات الجلسة", "Session Info")}</h2>
        <div className="grid gap-4 sm:grid-cols-2">
          <div><p className="text-xs text-muted">{t("معرف الجلسة", "Session ID")}</p><p className="mt-0.5 text-sm font-mono" dir="ltr">{session.id}</p></div>
          <div><p className="text-xs text-muted">{t("طريقة الإنشاء", "Created Via")}</p><p className="mt-0.5 text-sm">{session.created_via}</p></div>
          <div><p className="text-xs text-muted">{t("المدة الفعلية", "Actual Duration")}</p><p className="mt-0.5 text-sm">{session.actual_duration ? `${session.actual_duration} ${t("دقيقة", "min")}` : "—"}</p></div>
          <div><p className="text-xs text-muted">{t("تاريخ الإنشاء", "Created At")}</p><p className="mt-0.5 text-sm">{formatDT(session.created_at)}</p></div>
        </div>
      </div>

      {booking && (
        <div className="mt-4 glass-card p-6">
          <h2 className="mb-4 text-lg font-semibold">{t("معلومات الحجز", "Booking Info")}</h2>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="flex items-center gap-2"><User size={14} className="text-muted" /><div><p className="text-xs text-muted">{t("الطالب", "Student")}</p><div className="mt-0.5 flex items-center gap-2"><p className="text-sm font-medium">{nameMap[booking.student_id] ?? "—"}</p>{studentRisk != null && studentRisk >= 40 && (<span className={`glass-badge ${riskBadgeClass(studentRisk)}`} title={`${t("خطر التسرب", "Churn risk")}: ${studentRisk.toFixed(0)}`}>{riskLabel(studentRisk)}</span>)}</div></div></div>
            <div className="flex items-center gap-2"><GraduationCap size={14} className="text-muted" /><div><p className="text-xs text-muted">{t("المعلم", "Teacher")}</p><p className="mt-0.5 text-sm font-medium">{nameMap[booking.teacher_id] ?? "—"}</p></div></div>
            <div><p className="text-xs text-muted">{t("الموعد", "Scheduled")}</p><p className="mt-0.5 text-sm">{formatDT(booking.scheduled_at)}</p></div>
            <div><p className="text-xs text-muted">{t("المدة المحددة", "Scheduled Duration")}</p><p className="mt-0.5 text-sm">{booking.duration_min} {t("دقيقة", "min")}</p></div>
          </div>
        </div>
      )}

      <div className="mt-4 glass-card p-6">
        <h2 className="mb-4 flex items-center gap-2 text-lg font-semibold"><Clock size={18} className="text-gold" /> {t("الجدول الزمني", "Timeline")}</h2>
        <div className="space-y-3">
          {[
            { label: t("إنشاء الجلسة", "Session Created"), time: session.created_at, active: true },
            { label: t("بدء الجلسة", "Session Started"), time: session.started_at, active: !!session.started_at },
            { label: t("انضمام المعلم", "Teacher Joined"), time: session.teacher_joined ? session.started_at : null, active: session.teacher_joined },
            { label: t("انضمام الطالب", "Student Joined"), time: session.student_joined ? session.started_at : null, active: session.student_joined },
            { label: t("انتهاء الجلسة", "Session Ended"), time: session.ended_at, active: !!session.ended_at },
          ].map((step, i) => (
            <div key={i} className="flex items-center gap-3">
              <div className={`h-3 w-3 rounded-full ${step.active ? "bg-emerald-400" : "bg-muted/30"}`} />
              <p className={`text-sm ${step.active ? "font-medium" : "text-muted"}`}>{step.label}</p>
              <p className="me-auto text-xs text-muted">{step.time ? formatDT(step.time) : "—"}</p>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
