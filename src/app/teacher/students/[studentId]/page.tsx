import { redirect } from "next/navigation";
import Link from "next/link";
import { ArrowRight, Phone, Mail, User, BarChart3, AlertTriangle, Inbox } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { SESSION_TYPE_AR } from "@/lib/constants";
import type { SessionType, StudentLevel } from "@/types/database";
import { EvalForm } from "./eval-form";
import { ResolveErrorButton } from "./resolve-error-button";

interface Props { params: Promise<{ studentId: string }>; }

interface BookingRow { id: string; scheduled_at: string; duration_min: number; session_type: SessionType; status: string; }
interface SessionRow { booking_id: string; post_session_notes: string | null; homework: string | null; }
interface ProgressRow { level: StudentLevel; quality_rating: number | null; teacher_notes: string | null; created_at: string; surah_from: number | null; surah_to: number | null; }
interface ErrorRow { id: string; error_type: string; note: string | null; resolved: boolean; surah_num: number | null; ayah_num: number; }
interface ParentInfo { parent_name: string | null; parent_phone: string | null; parent_email: string | null; }

const LEVEL_AR: Record<StudentLevel, string> = { beginner: "مبتدئ", intermediate: "متوسط", advanced: "متقدم" };
const LEVEL_COLOR: Record<StudentLevel, string> = {
  beginner: "bg-amber-500/10 text-amber-400 border-amber-500/30",
  intermediate: "bg-sky-500/10 text-sky-400 border-sky-500/30",
  advanced: "bg-emerald-500/10 text-emerald-400 border-emerald-500/30",
};
const ERROR_TYPE_AR: Record<string, string> = { makharij: "مخارج", sifat: "صفات", madd: "مد", waqf: "وقف", ghunna: "غنة", other: "أخرى" };

export default async function StudentDetailPage({ params }: Props) {
  const { studentId } = await params;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const [profileRes, bookingsRes, progressRes] = await Promise.all([
    supabase.from("profiles").select("full_name, phone, country, parent_name, parent_phone, parent_email").eq("id", studentId)
      .single<{ full_name: string | null; phone: string | null; country: string | null } & ParentInfo>(),
    supabase.from("bookings")
      .select("id, scheduled_at, duration_min, session_type, status")
      .eq("student_id", studentId).eq("teacher_id", user.id)
      .in("status", ["confirmed", "completed"])
      .order("scheduled_at", { ascending: false })
      .returns<BookingRow[]>(),
    supabase.from("student_progress")
      .select("level, quality_rating, teacher_notes, created_at, surah_from, surah_to")
      .eq("student_id", studentId).eq("teacher_id", user.id)
      .order("created_at", { ascending: false })
      .limit(10)
      .returns<ProgressRow[]>(),
  ]);

  const student = profileRes.data;
  if (!student) redirect("/teacher/students");
  const bookings = bookingsRes.data ?? [];
  const progress = progressRes.data ?? [];

  // Get session notes
  let sessionMap: Record<string, SessionRow> = {};
  if (bookings.length > 0) {
    const bIds = bookings.map(b => b.id);
    const { data: sessions } = await supabase.from("sessions")
      .select("booking_id, post_session_notes, homework")
      .in("booking_id", bIds).returns<SessionRow[]>();
    if (sessions) sessionMap = Object.fromEntries(sessions.map(s => [s.booking_id, s]));
  }

  // Get recitation errors (from latest progress entries)
  let errors: ErrorRow[] = [];
  if (progress.length > 0) {
    const { data: progressIds } = await supabase.from("student_progress")
      .select("id").eq("student_id", studentId).eq("teacher_id", user.id)
      .order("created_at", { ascending: false }).limit(5)
      .returns<{ id: string }[]>();
    if (progressIds && progressIds.length > 0) {
      const { data: errs } = await supabase.from("recitation_errors")
        .select("id, error_type, note, resolved, surah_num, ayah_num")
        .in("progress_id", progressIds.map(p => p.id))
        .eq("resolved", false)
        .returns<ErrorRow[]>();
      errors = errs ?? [];
    }
  }

  // Compute stats
  const completedCount = bookings.filter(b => b.status === "completed").length;
  const totalMinutes = bookings.filter(b => b.status === "completed").reduce((s, b) => s + b.duration_min, 0);
  const latestLevel = progress[0]?.level ?? null;
  const avgQuality = progress.filter(p => p.quality_rating).reduce((sum, p, _, a) => sum + (p.quality_rating ?? 0) / a.length, 0);

  return (
    <div dir="rtl" className="mx-auto max-w-4xl px-4 py-8">
      <Link href="/teacher/students" className="mb-6 inline-flex items-center gap-1 text-sm text-gold hover:text-gold-hover">
        <ArrowRight size={14} /> العودة لطلابي
      </Link>

      {/* Profile Card */}
      <div className="glass-card mb-6 p-6">
        <div className="flex items-center gap-4">
          <div className="flex h-16 w-16 items-center justify-center rounded-full border border-gold/30 bg-gold/10 font-display text-2xl font-bold text-gold">
            {(student.full_name || "ط").charAt(0)}
          </div>
          <div className="flex-1">
            <h1 className="text-xl font-bold">{student.full_name || "طالب"}</h1>
            <p className="text-sm text-muted">{completedCount} جلسة مكتملة{student.country ? ` · ${student.country}` : ""}</p>
            {latestLevel && (
              <span className={`glass-badge mt-1 inline-block rounded-full px-2.5 py-0.5 text-xs ${LEVEL_COLOR[latestLevel]}`}>
                {LEVEL_AR[latestLevel]}
              </span>
            )}
          </div>
        </div>
      </div>

      {/* Stats Grid */}
      <div className="mb-6 grid grid-cols-4 gap-3">
        <div className="glass-card p-4 text-center">
          <p className="text-2xl font-bold text-gold">{completedCount}</p>
          <p className="text-xs text-muted">جلسة مكتملة</p>
        </div>
        <div className="glass-card p-4 text-center">
          <p className="text-2xl font-bold text-gold">{Math.round(totalMinutes / 60)}</p>
          <p className="text-xs text-muted">ساعة تعليم</p>
        </div>
        <div className="glass-card p-4 text-center">
          <p className="text-2xl font-bold text-gold">{avgQuality ? avgQuality.toFixed(1) : "—"}</p>
          <p className="text-xs text-muted">متوسط الجودة</p>
        </div>
        <div className="glass-card p-4 text-center">
          <p className="text-2xl font-bold text-gold">{errors.length}</p>
          <p className="text-xs text-muted">أخطاء معلقة</p>
        </div>
      </div>

      {/* Evaluate Student */}
      <div className="mb-6">
        <EvalForm studentId={studentId} studentName={student.full_name || "الطالب"} />
      </div>

      {/* Parent Contact */}
      {(student.parent_name || student.parent_phone || student.parent_email) && (
        <div className="glass-card mb-6 p-6">
          <h2 className="mb-3 flex items-center gap-2 text-lg font-bold"><User size={18} className="text-gold" /> ولي الأمر</h2>
          <div className="space-y-2">
            {student.parent_name && (
              <p className="text-sm"><span className="text-muted">الاسم:</span> {student.parent_name}</p>
            )}
            {student.parent_phone && (
              <p className="flex items-center gap-2 text-sm"><Phone size={14} className="text-muted" /> <span dir="ltr">{student.parent_phone}</span></p>
            )}
            {student.parent_email && (
              <p className="flex items-center gap-2 text-sm"><Mail size={14} className="text-muted" /> <span dir="ltr">{student.parent_email}</span></p>
            )}
          </div>
        </div>
      )}

      {/* Recitation Errors */}
      {errors.length > 0 && (
        <div className="glass-card mb-6 p-6">
          <h2 className="mb-3 flex items-center gap-2 text-lg font-bold"><AlertTriangle size={18} className="text-amber-400" /> أخطاء التلاوة المعلقة</h2>
          <div className="space-y-2">
            {errors.map((e) => (
              <div key={e.id} className="glass flex items-center gap-3 rounded-lg px-3 py-2 text-sm">
                <span className="glass-badge rounded-full border-amber-500/30 px-2 py-0.5 text-xs text-amber-400">
                  {ERROR_TYPE_AR[e.error_type] ?? e.error_type}
                </span>
                {e.surah_num && <span className="text-xs text-muted">سورة {e.surah_num} : آية {e.ayah_num}</span>}
                {e.note && <span className="flex-1 truncate text-xs text-muted" title={e.note}>{e.note}</span>}
                <ResolveErrorButton errorId={e.id} />
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Progress Summary */}
      {progress.length > 0 && (
        <div className="glass-card mb-6 p-6">
          <h2 className="mb-3 flex items-center gap-2 text-lg font-bold"><BarChart3 size={18} className="text-gold" /> ملخص التقدم</h2>
          <div className="space-y-2">
            {progress.slice(0, 5).map((p, i) => (
              <div key={i} className="glass flex items-center justify-between rounded-lg px-3 py-2">
                <div>
                  <span className={`glass-badge rounded-full px-2 py-0.5 text-xs ${LEVEL_COLOR[p.level]}`}>{LEVEL_AR[p.level]}</span>
                  {p.surah_from && <span className="mr-2 text-xs text-muted">سورة {p.surah_from}{p.surah_to && p.surah_to !== p.surah_from ? ` — ${p.surah_to}` : ""}</span>}
                  {p.quality_rating && <span className="mr-2 text-xs text-gold">جودة: {p.quality_rating}/5</span>}
                </div>
                <span className="text-xs text-muted">{new Date(p.created_at).toLocaleDateString("ar-SA")}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Session History */}
      <h2 className="mb-4 text-lg font-bold">سجل الجلسات</h2>
      {bookings.length === 0 ? (
        <div className="glass-card p-8 text-center">
          <Inbox size={28} className="mx-auto mb-2 text-muted" />
          <p className="text-sm text-muted">لا توجد جلسات مسجلة مع هذا الطالب</p>
        </div>
      ) : (
        <div className="space-y-3">
          {bookings.map(b => {
            const session = sessionMap[b.id];
            return (
              <div key={b.id} className="glass-card p-4">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm font-medium">{SESSION_TYPE_AR[b.session_type]} · {b.duration_min} دقيقة</p>
                    <p className="text-xs text-muted">{new Date(b.scheduled_at).toLocaleDateString("ar-SA", { weekday: "long", year: "numeric", month: "long", day: "numeric" })}</p>
                  </div>
                  <span className={`glass-badge rounded-full px-2 py-0.5 text-xs ${b.status === "completed" ? "text-emerald-400 border-emerald-500/30" : "text-amber-400 border-amber-500/30"}`}>
                    {b.status === "completed" ? "مكتمل" : "مؤكد"}
                  </span>
                </div>
                {session?.post_session_notes && (
                  <div className="glass mt-3 rounded-lg p-3">
                    <p className="mb-1 text-xs font-medium text-gold">ملاحظات</p>
                    <p className="text-sm text-muted break-words whitespace-pre-wrap">{session.post_session_notes}</p>
                  </div>
                )}
                {session?.homework && (
                  <div className="mt-2 rounded-lg border border-gold/20 bg-gold/5 p-3">
                    <p className="mb-1 text-xs font-medium text-gold">واجب</p>
                    <p className="text-sm text-muted break-words whitespace-pre-wrap">{session.homework}</p>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
