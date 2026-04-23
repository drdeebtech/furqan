import type { Metadata } from "next";
import { redirect } from "next/navigation";
import Link from "next/link";
import { ArrowRight, Calendar, Star, FileText, BookOpen, MessageSquare, TrendingDown } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { SESSION_TYPE_AR } from "@/lib/constants";
import { riskTone, riskLabel } from "@/lib/retention/ui";
import type { SessionType } from "@/types/database";

export const metadata: Metadata = { title: "تفاصيل المستخدم" };

interface Props { params: Promise<{ id: string }> }

export default async function AdminUserDetailPage({ params }: Props) {
  const { id } = await params;
  const supabase = await createClient();
  const { data: { user: admin } } = await supabase.auth.getUser();
  if (!admin) redirect("/login");

  // Profile
  const { data: profile } = await supabase
    .from("profiles")
    .select("id, full_name, role, phone, country, timezone, lang, is_active, created_at, parent_name, parent_phone, parent_email, date_of_birth")
    .eq("id", id)
    .single<{
      id: string; full_name: string | null; role: string; phone: string | null;
      country: string | null; timezone: string | null; lang: string | null;
      is_active: boolean; created_at: string; parent_name: string | null;
      parent_phone: string | null; parent_email: string | null; date_of_birth: string | null;
    }>();

  if (!profile) redirect("/admin/users");

  // Email from auth
  const { data: _authUser } = await supabase.from("profiles").select("id").eq("id", id).single();
  // We can't query auth.users from client, so skip email for now

  const isStudent = profile.role === "student";
  const isTeacher = profile.role === "teacher";

  // Retention signal (students only)
  const { data: retention } = isStudent
    ? await supabase
        .from("retention_signals")
        .select("churn_risk_score, engagement_score, last_booking_at, last_session_at, package_remaining, package_expires_at, last_intervention_at, intervention_type, computed_at")
        .eq("student_id", id)
        .maybeSingle<{
          churn_risk_score: number | null; engagement_score: number | null;
          last_booking_at: string | null; last_session_at: string | null;
          package_remaining: number | null; package_expires_at: string | null;
          last_intervention_at: string | null; intervention_type: string | null;
          computed_at: string;
        }>()
    : { data: null };

  // Bookings (student or teacher)
  const bookingFilter = isStudent ? "student_id" : "teacher_id";
  const { data: bookings } = await supabase
    .from("bookings")
    .select("id, student_id, teacher_id, session_type, scheduled_at, duration_min, status, amount_usd")
    .eq(bookingFilter, id)
    .order("scheduled_at", { ascending: false })
    .limit(20)
    .returns<{ id: string; student_id: string; teacher_id: string; session_type: SessionType; scheduled_at: string; duration_min: number; status: string; amount_usd: number }[]>();

  // Sessions with notes (for students: sessions where they're the student)
  const sessionBookingIds = (bookings ?? []).map(b => b.id);
  let sessionNotes: { id: string; booking_id: string; post_session_notes: string | null; homework: string | null; actual_duration: number | null }[] = [];
  if (sessionBookingIds.length > 0) {
    const { data } = await supabase
      .from("sessions")
      .select("id, booking_id, post_session_notes, homework, actual_duration")
      .in("booking_id", sessionBookingIds)
      .returns<typeof sessionNotes>();
    sessionNotes = data ?? [];
  }
  const notesMap = Object.fromEntries(sessionNotes.map(s => [s.booking_id, s]));

  // Evaluations (as student or teacher)
  const evalFilter = isStudent ? "student_id" : "teacher_id";
  const { data: evaluations } = await supabase
    .from("session_evaluations")
    .select("id, student_id, teacher_id, evaluation_type, overall_score, period_start, period_end, created_at")
    .eq(evalFilter, id)
    .order("created_at", { ascending: false })
    .limit(10)
    .returns<{ id: string; student_id: string; teacher_id: string; evaluation_type: string; overall_score: number; period_start: string; period_end: string; created_at: string }[]>();

  // Reviews
  const reviewFilter = isStudent ? "student_id" : "teacher_id";
  const { data: reviews } = await supabase
    .from("reviews")
    .select("id, student_id, teacher_id, rating, comment, teacher_reply, is_public, created_at")
    .eq(reviewFilter, id)
    .order("created_at", { ascending: false })
    .limit(10)
    .returns<{ id: string; student_id: string; teacher_id: string; rating: number; comment: string | null; teacher_reply: string | null; is_public: boolean; created_at: string }[]>();

  // Teacher profile (if teacher)
  interface TeacherInfo { hourly_rate: number; specialties: string[]; rating_avg: number; total_sessions: number; cv_status: string; is_accepting: boolean }
  let teacherProfile: TeacherInfo | null = null;
  if (isTeacher) {
    const { data } = await supabase
      .from("teacher_profiles")
      .select("hourly_rate, specialties, rating_avg, total_sessions, cv_status, is_accepting")
      .eq("teacher_id", id)
      .single<TeacherInfo>();
    teacherProfile = data;
  }

  // Name map for other users in bookings/reviews
  const otherIds = [...new Set([
    ...(bookings ?? []).map(b => isStudent ? b.teacher_id : b.student_id),
    ...(evaluations ?? []).map(e => isStudent ? e.teacher_id : e.student_id),
    ...(reviews ?? []).map(r => isStudent ? r.teacher_id : r.student_id),
  ])];
  let nameMap: Record<string, string> = {};
  if (otherIds.length > 0) {
    const { data: profiles } = await supabase.from("profiles").select("id, full_name").in("id", otherIds).returns<{ id: string; full_name: string | null }[]>();
    if (profiles) nameMap = Object.fromEntries(profiles.map(p => [p.id, p.full_name ?? "—"]));
  }

  const statusColors: Record<string, string> = {
    pending: "border-amber-500/30 bg-amber-500/10 text-amber-400",
    confirmed: "border-blue-500/30 bg-blue-500/10 text-blue-400",
    completed: "border-green-500/30 bg-green-500/10 text-green-400",
    cancelled: "border-red-500/30 bg-red-500/10 text-red-400",
    no_show: "border-red-500/30 bg-red-500/10 text-red-400",
  };

  const completedCount = (bookings ?? []).filter(b => b.status === "completed").length;

  return (
    <div dir="rtl" className="mx-auto max-w-5xl px-4 py-8">
      <Link href="/admin/users" className="mb-6 inline-flex items-center gap-1 text-sm text-gold hover:text-gold-hover">
        <ArrowRight size={14} /> العودة للمستخدمين
      </Link>

      {/* Profile Header */}
      <div className="glass-card p-6">
        <div className="flex items-start justify-between gap-4">
          <div className="flex items-center gap-4">
            <div className="flex h-14 w-14 items-center justify-center rounded-full bg-gold/20 text-xl font-bold text-gold">
              {(profile.full_name ?? "?")[0]}
            </div>
            <div>
              <h1 className="text-xl font-bold">{profile.full_name ?? "—"}</h1>
              <div className="mt-1 flex flex-wrap items-center gap-2 text-sm">
                <span className="glass-badge border-gold/30 bg-gold/10 text-gold">{profile.role}</span>
                <span className={`glass-badge ${profile.is_active ? "border-green-500/30 bg-green-500/10 text-green-400" : "border-red-500/30 bg-red-500/10 text-red-400"}`}>
                  {profile.is_active ? "نشط" : "معطل"}
                </span>
              </div>
            </div>
          </div>
          <div className="flex flex-col items-end gap-2 text-left text-xs text-muted">
            <span>انضم: {new Date(profile.created_at).toLocaleDateString("ar-SA")}</span>
            <div className="flex flex-wrap items-center gap-2">
              <Link
                href={`/admin/users/${profile.id}/timeline`}
                className="rounded-lg border border-surface-border/60 px-2 py-1 text-xs text-muted transition-colors hover:border-gold/40 hover:text-gold"
              >
                الجدول الزمني
              </Link>
              <Link
                href={`/admin/users/${profile.id}/as-user`}
                className="rounded-lg border border-gold/30 bg-gold/10 px-2 py-1 text-xs text-gold transition-colors hover:bg-gold/20"
              >
                معاينة كمستخدم
              </Link>
            </div>
          </div>
        </div>

        {/* Info grid */}
        <div className="mt-4 grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
          {profile.phone && <div><span className="text-muted">الهاتف:</span> <span dir="ltr">{profile.phone}</span></div>}
          {profile.country && <div><span className="text-muted">الدولة:</span> {profile.country}</div>}
          {profile.timezone && <div><span className="text-muted">المنطقة الزمنية:</span> {profile.timezone}</div>}
          {profile.date_of_birth && <div><span className="text-muted">تاريخ الميلاد:</span> {profile.date_of_birth}</div>}
        </div>

        {/* Retention signal (students) */}
        {isStudent && retention && (
          <div className="mt-4 glass-card rounded-lg p-3">
            <div className="mb-2 flex items-center gap-2">
              <TrendingDown size={14} className="text-gold" />
              <p className="text-xs font-medium text-gold">إشارة البقاء</p>
            </div>
            <div className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
              <div>
                <p className="text-xs text-muted">خطر التسرب</p>
                <p className={`font-bold ${riskTone(retention.churn_risk_score)}`}>
                  {(retention.churn_risk_score ?? 0).toFixed(0)} · {riskLabel(retention.churn_risk_score)}
                </p>
              </div>
              <div>
                <p className="text-xs text-muted">التفاعل</p>
                <p className="font-bold">{(retention.engagement_score ?? 0).toFixed(0)}</p>
              </div>
              <div>
                <p className="text-xs text-muted">الجلسات المتبقية</p>
                <p className="font-bold">{retention.package_remaining ?? "—"}</p>
              </div>
              <div>
                <p className="text-xs text-muted">آخر تدخل</p>
                <p className="text-xs">
                  {retention.last_intervention_at
                    ? `${retention.intervention_type ?? "—"} · ${new Date(retention.last_intervention_at).toLocaleDateString("ar-SA")}`
                    : "لا يوجد"}
                </p>
              </div>
            </div>
          </div>
        )}

        {/* Parent info (students) */}
        {isStudent && (profile.parent_name || profile.parent_phone || profile.parent_email) && (
          <div className="mt-4 glass-card rounded-lg p-3">
            <p className="mb-1 text-xs font-medium text-gold">معلومات ولي الأمر:</p>
            <div className="grid grid-cols-2 gap-2 text-sm sm:grid-cols-3">
              {profile.parent_name && <div><span className="text-muted">الاسم:</span> {profile.parent_name}</div>}
              {profile.parent_phone && <div><span className="text-muted">الهاتف:</span> <span dir="ltr">{profile.parent_phone}</span></div>}
              {profile.parent_email && <div><span className="text-muted">البريد:</span> <span dir="ltr">{profile.parent_email}</span></div>}
            </div>
          </div>
        )}

        {/* Teacher profile summary */}
        {isTeacher && teacherProfile && (
          <div className="mt-4 grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
            <div className="glass-card rounded-lg p-3 text-center">
              <p className="text-lg font-bold text-gold">{teacherProfile.rating_avg > 0 ? teacherProfile.rating_avg.toFixed(1) : "—"}</p>
              <p className="text-xs text-muted">التقييم</p>
            </div>
            <div className="glass-card rounded-lg p-3 text-center">
              <p className="text-lg font-bold text-gold">{teacherProfile.total_sessions}</p>
              <p className="text-xs text-muted">الجلسات</p>
            </div>
            <div className="glass-card rounded-lg p-3 text-center">
              <p className={`text-lg font-bold ${teacherProfile.cv_status === "approved" ? "text-green-400" : "text-amber-400"}`}>
                {teacherProfile.cv_status === "approved" ? "معتمد" : teacherProfile.cv_status === "pending_review" ? "قيد المراجعة" : "مسودة"}
              </p>
              <p className="text-xs text-muted">حالة السيرة</p>
            </div>
          </div>
        )}
      </div>

      {/* Quick stats */}
      <div className="mt-6 grid grid-cols-3 gap-3">
        <div className="glass-card rounded-xl p-4 text-center">
          <Calendar size={16} className="mx-auto mb-1 text-gold" />
          <p className="text-xl font-bold text-gold">{(bookings ?? []).length}</p>
          <p className="text-xs text-muted">الحجوزات</p>
        </div>
        <div className="glass-card rounded-xl p-4 text-center">
          <Star size={16} className="mx-auto mb-1 text-gold" />
          <p className="text-xl font-bold text-gold">{completedCount}</p>
          <p className="text-xs text-muted">جلسات مكتملة</p>
        </div>
        <div className="glass-card rounded-xl p-4 text-center">
          <MessageSquare size={16} className="mx-auto mb-1 text-gold" />
          <p className="text-xl font-bold text-gold">{(reviews ?? []).length}</p>
          <p className="text-xs text-muted">المراجعات</p>
        </div>
      </div>

      {/* Bookings + Session Notes */}
      <div className="mt-8">
        <h2 className="mb-4 flex items-center gap-2 text-lg font-semibold">
          <Calendar size={18} className="text-gold" /> الحجوزات والجلسات
        </h2>
        {(bookings ?? []).length === 0 ? (
          <p className="text-sm text-muted">لا توجد حجوزات</p>
        ) : (
          <div className="space-y-3">
            {(bookings ?? []).map(b => {
              const note = notesMap[b.id];
              const otherName = nameMap[isStudent ? b.teacher_id : b.student_id] ?? "—";
              return (
                <div key={b.id} className="glass-card rounded-xl p-4">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div>
                      <p className="text-sm font-medium">
                        {isStudent ? "المعلم" : "الطالب"}: {otherName}
                      </p>
                      <p className="mt-1 text-xs text-muted">
                        {SESSION_TYPE_AR[b.session_type]} · {b.duration_min} د
                        {note?.actual_duration ? ` · فعلي: ${note.actual_duration} د` : ""}
                      </p>
                    </div>
                    <div className="text-left">
                      <span className={`glass-badge ${statusColors[b.status] ?? "text-muted"}`}>
                        {b.status}
                      </span>
                      <p dir="ltr" className="mt-1 text-xs text-muted">
                        {new Date(b.scheduled_at).toLocaleDateString("ar-SA", { month: "short", day: "numeric" })}
                      </p>
                    </div>
                  </div>
                  {note?.post_session_notes && (
                    <div className="mt-2 rounded-lg border border-gold/20 bg-gold/5 p-2">
                      <p className="text-xs font-medium text-gold"><FileText size={12} className="inline" /> ملاحظات:</p>
                      <p className="mt-1 text-xs whitespace-pre-wrap">{note.post_session_notes}</p>
                    </div>
                  )}
                  {note?.homework && (
                    <div className="mt-1 rounded-lg border border-blue-500/20 bg-blue-500/5 p-2">
                      <p className="text-xs font-medium text-blue-400"><BookOpen size={12} className="inline" /> واجب:</p>
                      <p className="mt-1 text-xs whitespace-pre-wrap">{note.homework}</p>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Evaluations */}
      {(evaluations ?? []).length > 0 && (
        <div className="mt-8">
          <h2 className="mb-4 flex items-center gap-2 text-lg font-semibold">
            <Star size={18} className="text-gold" /> التقييمات
          </h2>
          <div className="space-y-2">
            {(evaluations ?? []).map(e => (
              <div key={e.id} className="flex items-center justify-between glass-card rounded-lg px-4 py-3">
                <div>
                  <p className="text-sm font-medium">
                    {isStudent ? "بواسطة" : "للطالب"}: {nameMap[isStudent ? e.teacher_id : e.student_id] ?? "—"}
                  </p>
                  <p className="text-xs text-muted">{e.evaluation_type} · {new Date(e.period_start).toLocaleDateString("ar-SA")} — {new Date(e.period_end).toLocaleDateString("ar-SA")}</p>
                </div>
                <span className={`glass-badge px-3 py-1 text-sm font-bold ${e.overall_score >= 8 ? "border-green-500/30 text-green-400" : e.overall_score >= 5 ? "border-amber-500/30 text-amber-400" : "border-red-500/30 text-red-400"}`}>
                  {e.overall_score}/10
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Reviews */}
      {(reviews ?? []).length > 0 && (
        <div className="mt-8">
          <h2 className="mb-4 flex items-center gap-2 text-lg font-semibold">
            <MessageSquare size={18} className="text-gold" /> المراجعات
          </h2>
          <div className="space-y-3">
            {(reviews ?? []).map(r => (
              <div key={r.id} className="glass-card rounded-xl p-4">
                <div className="flex items-start justify-between">
                  <div>
                    <p className="text-sm font-medium">
                      {isStudent ? "للمعلم" : "من الطالب"}: {nameMap[isStudent ? r.teacher_id : r.student_id] ?? "—"}
                    </p>
                    <div className="mt-1 flex gap-0.5">
                      {[1, 2, 3, 4, 5].map(star => (
                        <span key={star} className={`text-sm ${star <= r.rating ? "text-gold" : "text-muted/30"}`}>★</span>
                      ))}
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className={`glass-badge ${r.is_public ? "border-green-500/30 text-green-400" : "border-muted/30 text-muted"}`}>
                      {r.is_public ? "عام" : "خاص"}
                    </span>
                    <span className="text-xs text-muted">{new Date(r.created_at).toLocaleDateString("ar-SA")}</span>
                  </div>
                </div>
                {r.comment && <p className="mt-2 text-sm">{r.comment}</p>}
                {r.teacher_reply && (
                  <div className="mt-2 glass-card rounded-lg p-2">
                    <p className="text-xs text-gold">رد المعلم:</p>
                    <p className="mt-1 text-xs">{r.teacher_reply}</p>
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
