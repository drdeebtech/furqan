import type { Metadata } from "next";
import { redirect, notFound } from "next/navigation";
import Link from "next/link";
import { ArrowRight, Video, User, GraduationCap, Clock, FileText, Shield } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { SessionStatus } from "@/components/shared/session-status";
import { getT } from "@/lib/i18n/server";
import { riskBadgeClass, riskLabel } from "@/lib/retention/ui";
import { SessionDetailActions } from "./detail-actions";
import { SendReportButton } from "./send-report-button";

export const metadata: Metadata = { title: "تفاصيل الجلسة" };

interface SessionRow {
  id: string;
  booking_id: string;
  room_name: string;
  room_url: string;
  expires_at: string | null;
  created_via: string;
  started_at: string | null;
  ended_at: string | null;
  actual_duration: number | null;
  recording_url: string | null;
  teacher_joined: boolean;
  student_joined: boolean;
  post_session_notes: string | null;
  homework: string | null;
  created_at: string;
}

interface BookingRow {
  id: string;
  student_id: string;
  teacher_id: string;
  scheduled_at: string;
  duration_min: number;
  session_type: string;
  status: string;
  amount_usd: number;
}

interface AuditRow {
  id: string;
  changed_by: string | null;
  action: string;
  old_data: Record<string, unknown> | null;
  new_data: Record<string, unknown> | null;
  reason: string | null;
  created_at: string;
}

export default async function SessionDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const { t, dir, lang } = await getT();
  const locale = lang === "ar" ? "ar-SA" : "en-US";
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  /* Fetch session */
  const { data: session } = await supabase
    .from("sessions")
    .select("id, booking_id, room_name, room_url, expires_at, created_via, started_at, ended_at, actual_duration, recording_url, teacher_joined, student_joined, post_session_notes, homework, created_at")
    .eq("id", id)
    .single()
    .then((r) => ({ data: r.data as SessionRow | null }));

  if (!session) notFound();

  /* Fetch booking */
  const { data: booking } = await supabase
    .from("bookings")
    .select("id, student_id, teacher_id, scheduled_at, duration_min, session_type, status, amount_usd")
    .eq("id", session.booking_id)
    .single()
    .then((r) => ({ data: r.data as BookingRow | null }));

  /* Resolve names */
  let nameMap: Record<string, string> = {};
  let studentRisk: number | null = null;
  if (booking) {
    const ids = [booking.student_id, booking.teacher_id];
    const [profilesRes, retentionRes] = await Promise.all([
      supabase
        .from("profiles")
        .select("id, full_name")
        .in("id", ids)
        .returns<{ id: string; full_name: string | null }[]>(),
      supabase
        .from("retention_signals")
        .select("churn_risk_score")
        .eq("student_id", booking.student_id)
        .maybeSingle<{ churn_risk_score: number | null }>(),
    ]);
    if (profilesRes.data) {
      nameMap = Object.fromEntries(profilesRes.data.map((p) => [p.id, p.full_name ?? "—"]));
    }
    studentRisk = retentionRes.data?.churn_risk_score ?? null;
  }

  /* Fetch audit log entries */
  const { data: auditLogs } = await supabase
    .from("audit_log")
    .select("id, changed_by, action, old_data, new_data, reason, created_at")
    .eq("table_name", "sessions")
    .eq("record_id", id)
    .order("created_at", { ascending: true })
    .returns<AuditRow[]>();

  const logs = auditLogs ?? [];

  /* Resolve audit log user names */
  const auditUserIds = [...new Set(logs.map((l) => l.changed_by).filter(Boolean) as string[])];
  let auditNameMap: Record<string, string> = {};
  if (auditUserIds.length > 0) {
    const { data: p } = await supabase
      .from("profiles")
      .select("id, full_name")
      .in("id", auditUserIds)
      .returns<{ id: string; full_name: string | null }[]>();
    if (p) auditNameMap = Object.fromEntries(p.map((pr) => [pr.id, pr.full_name ?? "—"]));
  }

  const actionColor: Record<string, string> = {
    INSERT: "text-emerald-400",
    UPDATE: "text-amber-400",
    DELETE: "text-red-400",
  };

  /* Determine states for actions */
  // eslint-disable-next-line react-hooks/purity -- server component, Date.now() is fine
  const now = Date.now();
  const isActive = !!session.started_at && !session.ended_at;
  const isExpired = session.expires_at && new Date(session.expires_at).getTime() < now && !session.ended_at;

  const formatDT = (d: string | null) =>
    d ? new Date(d).toLocaleString(locale) : "—";

  const sessionTypeMap: Record<string, string> = lang === "ar"
    ? { hifz: "حفظ", tilawa: "تلاوة", tajweed: "تجويد", revision: "مراجعة" }
    : { hifz: "Hifz", tilawa: "Tilawa", tajweed: "Tajweed", revision: "Review" };

  return (
    <div dir={dir} className="mx-auto max-w-4xl px-4 py-8">
      {/* Header */}
      <div className="mb-6 flex items-center gap-3">
        <Link
          href="/admin/sessions"
          className="glass rounded-lg p-2 text-muted transition-colors"
        >
          <ArrowRight size={16} />
        </Link>
        <h1 className="flex items-center gap-2 text-2xl font-bold">
          <Video size={24} className="text-gold" />
          {t("تفاصيل الجلسة", "Session Details")}
        </h1>
        {booking && (
          <SessionStatus
            scheduledAt={booking.scheduled_at}
            durationMin={booking.duration_min}
            expiresAt={session.expires_at}
            endedAt={session.ended_at}
            size="md"
          />
        )}
      </div>

      {/* Action buttons */}
      <div className="flex flex-wrap items-center gap-3">
        <SessionDetailActions
          sessionId={session.id}
          isActive={isActive}
          isExpired={!!isExpired}
        />
        {session.ended_at && user && <SendReportButton sessionId={session.id} actorId={user.id} />}
      </div>

      {/* Session info card */}
      <div className="mt-6 glass-card p-6">
        <h2 className="mb-4 text-lg font-semibold">{t("معلومات الجلسة", "Session Info")}</h2>
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <p className="text-xs text-muted">{t("معرف الجلسة", "Session ID")}</p>
            <p className="mt-0.5 text-sm font-mono" dir="ltr">{session.id}</p>
          </div>
          <div>
            <p className="text-xs text-muted">{t("طريقة الإنشاء", "Created Via")}</p>
            <p className="mt-0.5 text-sm">{session.created_via}</p>
          </div>
          <div>
            <p className="text-xs text-muted">{t("اسم الغرفة", "Room Name")}</p>
            <p className="mt-0.5 text-sm font-mono" dir="ltr">{session.room_name}</p>
          </div>
          <div>
            <p className="text-xs text-muted">{t("انتهاء صلاحية الغرفة", "Room Expires")}</p>
            <p className="mt-0.5 text-sm">{formatDT(session.expires_at)}</p>
          </div>
          <div>
            <p className="text-xs text-muted">{t("المدة الفعلية", "Actual Duration")}</p>
            <p className="mt-0.5 text-sm">{session.actual_duration ? `${session.actual_duration} ${t("دقيقة", "min")}` : "—"}</p>
          </div>
          <div>
            <p className="text-xs text-muted">{t("تاريخ الإنشاء", "Created At")}</p>
            <p className="mt-0.5 text-sm">{formatDT(session.created_at)}</p>
          </div>
        </div>
      </div>

      {/* Booking info card */}
      {booking && (
        <div className="mt-4 glass-card p-6">
          <h2 className="mb-4 text-lg font-semibold">{t("معلومات الحجز", "Booking Info")}</h2>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="flex items-center gap-2">
              <User size={14} className="text-muted" />
              <div>
                <p className="text-xs text-muted">{t("الطالب", "Student")}</p>
                <div className="mt-0.5 flex items-center gap-2">
                  <p className="text-sm font-medium">{nameMap[booking.student_id] ?? "—"}</p>
                  {studentRisk != null && studentRisk >= 40 && (
                    <span className={`glass-badge ${riskBadgeClass(studentRisk)}`} title={`${t("خطر التسرب", "Churn risk")}: ${studentRisk.toFixed(0)}`}>
                      {riskLabel(studentRisk)}
                    </span>
                  )}
                </div>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <GraduationCap size={14} className="text-muted" />
              <div>
                <p className="text-xs text-muted">{t("المعلم", "Teacher")}</p>
                <p className="mt-0.5 text-sm font-medium">{nameMap[booking.teacher_id] ?? "—"}</p>
              </div>
            </div>
            <div>
              <p className="text-xs text-muted">{t("نوع الجلسة", "Session Type")}</p>
              <p className="mt-0.5 text-sm">{sessionTypeMap[booking.session_type] ?? booking.session_type}</p>
            </div>
            <div>
              <p className="text-xs text-muted">{t("الموعد المحدد", "Scheduled At")}</p>
              <p className="mt-0.5 text-sm">{formatDT(booking.scheduled_at)}</p>
            </div>
            <div>
              <p className="text-xs text-muted">{t("المدة المحددة", "Scheduled Duration")}</p>
              <p className="mt-0.5 text-sm">{booking.duration_min} {t("دقيقة", "min")}</p>
            </div>
            <div>
              <p className="text-xs text-muted">{t("المبلغ", "Amount")}</p>
              <p className="mt-0.5 text-sm font-semibold text-gold">${Number(booking.amount_usd).toFixed(2)}</p>
            </div>
          </div>
        </div>
      )}

      {/* Timeline */}
      <div className="mt-4 glass-card p-6">
        <h2 className="mb-4 flex items-center gap-2 text-lg font-semibold">
          <Clock size={18} className="text-gold" />
          {t("الجدول الزمني", "Timeline")}
        </h2>
        <div className="space-y-3">
          {[
            { label: t("إنشاء الجلسة", "Session Created"), time: session.created_at, active: true },
            { label: t("بدء الجلسة", "Session Started"), time: session.started_at, active: !!session.started_at },
            { label: t("انضمام المعلم", "Teacher Joined"), time: session.teacher_joined ? session.started_at : null, active: session.teacher_joined },
            { label: t("انضمام الطالب", "Student Joined"), time: session.student_joined ? session.started_at : null, active: session.student_joined },
            { label: t("انتهاء الجلسة", "Session Ended"), time: session.ended_at, active: !!session.ended_at },
          ].map((step, i) => (
            <div key={i} className="flex items-center gap-3">
              <div
                className={`h-3 w-3 rounded-full ${
                  step.active ? "bg-emerald-400" : "bg-muted/30"
                }`}
              />
              <p className={`text-sm ${step.active ? "font-medium" : "text-muted"}`}>
                {step.label}
              </p>
              <p className="me-auto text-xs text-muted">
                {step.time ? formatDT(step.time) : "—"}
              </p>
            </div>
          ))}
        </div>
      </div>

      {/* Notes */}
      {(session.post_session_notes || session.homework) && (
        <div className="mt-4 glass-card p-6">
          <h2 className="mb-4 flex items-center gap-2 text-lg font-semibold">
            <FileText size={18} className="text-gold" />
            {t("ملاحظات", "Notes")}
          </h2>
          {session.post_session_notes && (
            <div className="mb-3">
              <p className="text-xs text-muted">{t("ملاحظات ما بعد الجلسة", "Post-Session Notes")}</p>
              <p className="mt-1 text-sm">{session.post_session_notes}</p>
            </div>
          )}
          {session.homework && (
            <div>
              <p className="text-xs text-muted">{t("الواجب", "Homework")}</p>
              <p className="mt-1 text-sm">{session.homework}</p>
            </div>
          )}
        </div>
      )}

      {/* Audit log */}
      <div className="mt-4 glass-card p-6">
        <h2 className="mb-4 flex items-center gap-2 text-lg font-semibold">
          <Shield size={18} className="text-gold" />
          {t("سجل التعديلات", "Audit Log")}
        </h2>
        {logs.length === 0 ? (
          <p className="text-sm text-muted">{t("لا توجد سجلات", "No records")}</p>
        ) : (
          <div className="space-y-3">
            {logs.map((l) => (
              <div key={l.id} className="glass-card rounded-xl p-3">
                <div className="flex items-center gap-2 text-sm">
                  <span className={`font-medium ${actionColor[l.action] ?? "text-muted"}`}>
                    {l.action}
                  </span>
                  <span className="text-muted">—</span>
                  <span>{l.changed_by ? auditNameMap[l.changed_by] ?? "—" : t("نظام", "System")}</span>
                  <span className="me-auto text-xs text-muted">{formatDT(l.created_at)}</span>
                </div>
                {l.reason && (
                  <p className="mt-1 text-xs text-muted">{t("السبب", "Reason")}: {l.reason}</p>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
