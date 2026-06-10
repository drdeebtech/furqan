import type { Metadata } from "next";
import { redirect } from "next/navigation";
import Link from "next/link";
import { ArrowRight, Phone, Mail, User, BarChart3, AlertTriangle, Inbox, BookMarked, MessageSquareQuote, Mic, ScrollText } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { loadOrFail } from "@/lib/supabase/load-or-fail";
import { SESSION_TYPE_AR } from "@/lib/constants";
import { getT } from "@/lib/i18n/server";
import type { SessionType, StudentLevel } from "@/types/database";
import { HomeworkAudioPlayer } from "@/components/shared/homework-audio-player";
import { DataLoadBanner } from "@/components/shared/data-load-banner";
import { EvalForm } from "./eval-form";
import { ResolveErrorButton } from "./resolve-error-button";
import { RECITATION_STANDARD_LABEL } from "@/lib/recitation-constants";

const SESSION_TYPE_EN: Record<SessionType, string> = {
  hifz: "Hifz", muraja: "Review", tajweed: "Tajweed", tilawa: "Tilawa",
  qiraat: "Qiraat", tafsir: "Tafsir", combined: "Hifz + Review", other: "Other",
};
const LEVEL_EN: Record<StudentLevel, string> = { beginner: "Beginner", intermediate: "Intermediate", advanced: "Advanced" };
const ERROR_TYPE_EN: Record<string, string> = { makharij: "Makharij", sifat: "Sifat", madd: "Madd", waqf: "Waqf", ghunna: "Ghunna", other: "Other" };

interface Props { params: Promise<{ studentId: string }>; }

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { studentId } = await params;
  const supabase = await createClient();
  const { data } = await supabase.from("profiles").select("full_name").eq("id", studentId).single<{ full_name: string | null }>();
  const name = data?.full_name?.trim() || "طالب";
  return { title: `${name} | فرقان` };
}

interface BookingRow { id: string; scheduled_at: string; duration_min: number; session_type: SessionType; status: string; }
interface SessionRow { booking_id: string; post_session_notes: string | null; homework: string | null; }
interface ProgressRow { level: StudentLevel; quality_rating: number | null; teacher_notes: string | null; created_at: string; surah_from: number | null; surah_to: number | null; }
interface ErrorRow { id: string; error_type: string; note: string | null; resolved: boolean; surah_num: number | null; ayah_num: number; }
interface ParentInfo { parent_name: string | null; parent_phone: string | null; parent_email: string | null; }

const LEVEL_AR: Record<StudentLevel, string> = { beginner: "مبتدئ", intermediate: "متوسط", advanced: "متقدم" };
const LEVEL_COLOR: Record<StudentLevel, string> = {
  beginner: "bg-warning/10 text-warning border-warning/30",
  intermediate: "bg-gold/10 text-gold border-gold/30",
  advanced: "bg-success/10 text-success border-success/30",
};
const ERROR_TYPE_AR: Record<string, string> = { makharij: "مخارج", sifat: "صفات", madd: "مد", waqf: "وقف", ghunna: "غنة", other: "أخرى" };

export default async function StudentDetailPage({ params }: Props) {
  const { studentId } = await params;
  const { t, dir, lang } = await getT();
  const locale = lang === "ar" ? "ar-EG" : "en-US";
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const [profileRes, bookingsRes, progressRes, latestEvalRes, latestStandardRes, audioHwRes] = await Promise.all([
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
    // Latest evaluation this teacher wrote for this student — fuels the
    // "what you said last time" inline panel.
    supabase.from("session_evaluations")
      .select("next_goals, areas_for_improvement, overall_score, evaluation_type, created_at")
      .eq("student_id", studentId).eq("teacher_id", user.id)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle<{ next_goals: string | null; areas_for_improvement: string | null; overall_score: number | null; evaluation_type: string | null; created_at: string }>(),
    // Latest recitation_standard for this student — anchors the teacher
    // mentally in which qira'a tradition this student is studying.
    supabase.from("student_progress")
      .select("recitation_standard")
      .eq("student_id", studentId)
      .not("recitation_standard", "is", null)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle<{ recitation_standard: string | null }>(),
    // Recent follow-up with audio submissions — let the teacher hear the
    // student's most-recent recordings without context-switching to the
    // Follow-up page.
    supabase.from("homework_assignments")
      .select("id, title, audio_duration_seconds, ready_at, status")
      .eq("student_id", studentId).eq("teacher_id", user.id)
      .not("audio_url", "is", null)
      .order("ready_at", { ascending: false })
      .limit(5)
      .returns<{ id: string; title: string; audio_duration_seconds: number | null; ready_at: string | null; status: string }[]>(),
  ]);

  const student = profileRes.data;
  if (!student) redirect("/teacher/students");

  const bookingsLoad = loadOrFail(bookingsRes, [] as BookingRow[], { route: "teacher-student-detail", widget: "bookings", metadata: { studentId } });
  const progressLoad = loadOrFail(progressRes, [] as ProgressRow[], { route: "teacher-student-detail", widget: "progress", metadata: { studentId } });
  const latestEvalLoad = loadOrFail(latestEvalRes, null, { route: "teacher-student-detail", widget: "latest-eval", metadata: { studentId } });
  const latestStandardLoad = loadOrFail(latestStandardRes, null, { route: "teacher-student-detail", widget: "recitation-standard", metadata: { studentId } });
  const audioHwLoad = loadOrFail(audioHwRes, [] as { id: string; title: string; audio_duration_seconds: number | null; ready_at: string | null; status: string }[], { route: "teacher-student-detail", widget: "audio-homework", metadata: { studentId } });
  const anyFailed = bookingsLoad.failed || progressLoad.failed || latestEvalLoad.failed || latestStandardLoad.failed || audioHwLoad.failed;

  const bookings = bookingsLoad.data;
  const progress = progressLoad.data;

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
  const latestEval = latestEvalLoad.data;
  const recitationStandard = latestStandardLoad.data?.recitation_standard ?? null;
  const audioSubmissions = audioHwLoad.data;

  // Group recitation errors by type so the teacher sees the dominant
  // category at a glance instead of having to count error rows.
  const errorBreakdown: Record<string, number> = {};
  for (const e of errors) {
    errorBreakdown[e.error_type] = (errorBreakdown[e.error_type] ?? 0) + 1;
  }
  const topErrorTypes = Object.entries(errorBreakdown)
    .sort((a, b) => b[1] - a[1]);

  return (
    <div dir={dir} className="mx-auto max-w-4xl px-4 py-8">
      <DataLoadBanner failed={anyFailed} />
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <Link href="/teacher/students" className="inline-flex items-center gap-1 text-sm text-gold hover:text-gold-hover">
          <ArrowRight size={14} /> {t("العودة لطلابي", "Back to My Students")}
        </Link>
        <Link
          href={`/teacher/students/${studentId}/timeline`}
          className="inline-flex items-center gap-1 rounded-full border border-card-border bg-card/50 px-3 py-1.5 text-xs text-muted hover:text-foreground/80 focus-ring"
        >
          <ScrollText size={12} aria-hidden="true" />
          {t("الخط الزمني", "Timeline")}
        </Link>
      </div>

      {/* Profile Card */}
      <div className="glass-card mb-6 p-6">
        <div className="flex items-center gap-4">
          <div className="flex h-16 w-16 items-center justify-center rounded-full border border-gold/30 bg-gold/10 font-display text-2xl font-bold text-gold">
            {(student.full_name || "S").charAt(0)}
          </div>
          <div className="flex-1">
            <h1 className="text-xl font-bold">{student.full_name || t("طالب", "Student")}</h1>
            <p className="text-sm text-muted">{completedCount} {t("جلسة مكتملة", "completed sessions")}{student.country ? ` · ${student.country}` : ""}</p>
            <div className="mt-1 flex flex-wrap items-center gap-2">
              {latestLevel && (
                <span className={`glass-badge rounded-full px-2.5 py-0.5 text-xs ${LEVEL_COLOR[latestLevel]}`}>
                  {lang === "ar" ? LEVEL_AR[latestLevel] : LEVEL_EN[latestLevel]}
                </span>
              )}
              {/* Recitation standard pill — anchors which qira'a tradition
                  this student studies under so the teacher doesn't have
                  to remember between sessions. */}
              {recitationStandard && RECITATION_STANDARD_LABEL[recitationStandard] && (
                <span
                  className="inline-flex items-center gap-1 rounded-full border border-gold/30 bg-gold/5 px-2.5 py-0.5 text-xs text-gold"
                  title={t("الرواية التي يدرس بها", "Recitation tradition")}
                >
                  <BookMarked size={11} aria-hidden="true" />
                  {t(
                    RECITATION_STANDARD_LABEL[recitationStandard].ar,
                    RECITATION_STANDARD_LABEL[recitationStandard].en,
                  )}
                </span>
              )}
            </div>
          </div>
        </div>

        {/* What you said last evaluation — closes the loop on the
            teacher's own promised focus. Surfaces only when this teacher
            has written an evaluation with a recommendation. */}
        {latestEval?.next_goals && (
          <div className="mt-5 rounded-xl border border-gold/30 bg-gold/5 p-4">
            <div className="mb-1 flex items-center justify-between gap-2">
              <h2 className="flex items-center gap-1.5 text-xs font-semibold text-gold">
                <MessageSquareQuote size={12} aria-hidden="true" />
                {t(
                  `قلت في آخر تقييم (${new Date(latestEval.created_at).toLocaleDateString(locale, { month: "short", day: "numeric" })})`,
                  `What you wrote last evaluation (${new Date(latestEval.created_at).toLocaleDateString(locale, { month: "short", day: "numeric" })})`,
                )}
              </h2>
              {latestEval.overall_score != null && (
                <span className="text-xs text-muted">{t("إجمالي", "Overall")}: {latestEval.overall_score}/10</span>
              )}
            </div>
            <p className="text-sm leading-relaxed text-foreground">{latestEval.next_goals}</p>
            {latestEval.areas_for_improvement && (
              <p className="mt-2 text-xs text-muted">
                <span className="text-orange-400">{t("للتحسين:", "To improve:")}</span> {latestEval.areas_for_improvement}
              </p>
            )}
          </div>
        )}
      </div>

      {/* Stats Grid */}
      <div className="mb-6 grid grid-cols-4 gap-3">
        <div className="glass-card p-4 text-center">
          <p className="text-2xl font-bold text-gold">{completedCount}</p>
          <p className="text-xs text-muted">{t("جلسة مكتملة", "Sessions")}</p>
        </div>
        <div className="glass-card p-4 text-center">
          <p className="text-2xl font-bold text-gold">{Math.round(totalMinutes / 60)}</p>
          <p className="text-xs text-muted">{t("ساعة تعليم", "Hours Taught")}</p>
        </div>
        <div className="glass-card p-4 text-center">
          <p className="text-2xl font-bold text-gold">{avgQuality ? avgQuality.toFixed(1) : "—"}</p>
          <p className="text-xs text-muted">{t("متوسط الجودة", "Avg Quality")}</p>
        </div>
        <div className="glass-card p-4 text-center">
          <p className="text-2xl font-bold text-gold">{errors.length}</p>
          <p className="text-xs text-muted">{t("أخطاء معلقة", "Pending Errors")}</p>
        </div>
      </div>

      {/* Evaluate Student */}
      <div className="mb-6">
        <EvalForm studentId={studentId} studentName={student.full_name || t("الطالب", "Student")} />
      </div>

      {/* Parent Contact */}
      {(student.parent_name || student.parent_phone || student.parent_email) && (
        <div className="glass-card mb-6 p-6">
          <h2 className="mb-3 flex items-center gap-2 text-lg font-bold"><User size={18} className="text-gold" /> {t("ولي الأمر", "Parent")}</h2>
          <div className="space-y-2">
            {student.parent_name && (
              <p className="text-sm"><span className="text-muted">{t("الاسم", "Name")}:</span> {student.parent_name}</p>
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
          <h2 className="mb-3 flex items-center gap-2 text-lg font-bold"><AlertTriangle size={18} className="text-warning" /> {t("أخطاء التلاوة المعلقة", "Pending Recitation Errors")}</h2>

          {/* Category breakdown — gives the teacher the "what dominates"
              answer at a glance instead of forcing them to scroll the
              list and count. */}
          {topErrorTypes.length > 0 && (
            <div className="mb-3 flex flex-wrap items-center gap-1.5">
              <span className="text-xs text-muted">{t("التوزيع:", "Breakdown:")}</span>
              {topErrorTypes.map(([type, count]) => (
                <span
                  key={type}
                  className="inline-flex items-center gap-1 rounded-full border border-warning/30 bg-warning/10 px-2 py-0.5 text-xs text-warning"
                >
                  <span className="font-bold">{count}</span>
                  {(lang === "ar" ? ERROR_TYPE_AR[type] : ERROR_TYPE_EN[type]) ?? type}
                </span>
              ))}
            </div>
          )}

          <div className="space-y-2">
            {errors.map((e) => (
              <div key={e.id} className="glass flex items-center gap-3 rounded-lg px-3 py-2 text-sm">
                <span className="glass-badge rounded-full border-warning/30 px-2 py-0.5 text-xs text-warning">
                  {(lang === "ar" ? ERROR_TYPE_AR[e.error_type] : ERROR_TYPE_EN[e.error_type]) ?? e.error_type}
                </span>
                {e.surah_num && <span className="text-xs text-muted">{t("سورة", "Surah")} {e.surah_num} : {t("آية", "Ayah")} {e.ayah_num}</span>}
                {e.note && <span className="flex-1 truncate text-xs text-muted" title={e.note}>{e.note}</span>}
                <ResolveErrorButton errorId={e.id} />
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Recent audio submissions — lets the teacher hear the student's
          most-recent recordings without leaving the student detail page.
          Lazy-loaded signed URLs via getHomeworkAudioUrl. */}
      {audioSubmissions.length > 0 && (
        <div className="glass-card mb-6 p-6">
          <h2 className="mb-3 flex items-center gap-2 text-lg font-bold">
            <Mic size={18} className="text-violet-400" aria-hidden="true" /> {t("تسميعات حديثة", "Recent recitations")}
          </h2>
          <ul className="space-y-3">
            {audioSubmissions.map(hw => (
              <li key={hw.id} className="rounded-lg border border-card-border bg-card/50 p-3">
                <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
                  <p className="text-sm font-medium">{hw.title}</p>
                  {hw.ready_at && (
                    <p className="text-xs text-muted">
                      {new Date(hw.ready_at).toLocaleDateString(locale, { month: "short", day: "numeric", year: "numeric" })}
                    </p>
                  )}
                </div>
                <HomeworkAudioPlayer
                  homeworkId={hw.id}
                  durationSeconds={hw.audio_duration_seconds}
                  label={{ ar: "تسميع الطالب", en: "Student's recitation" }}
                />
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Progress Summary */}
      {progress.length > 0 && (
        <div className="glass-card mb-6 p-6">
          <h2 className="mb-3 flex items-center gap-2 text-lg font-bold"><BarChart3 size={18} className="text-gold" /> {t("ملخص التقدم", "Progress Summary")}</h2>
          <div className="space-y-2">
            {progress.slice(0, 5).map((p, i) => (
              <div key={i} className="glass flex items-center justify-between rounded-lg px-3 py-2">
                <div>
                  <span className={`glass-badge rounded-full px-2 py-0.5 text-xs ${LEVEL_COLOR[p.level]}`}>{lang === "ar" ? LEVEL_AR[p.level] : LEVEL_EN[p.level]}</span>
                  {p.surah_from && <span className="me-2 text-xs text-muted">{t("سورة", "Surah")} {p.surah_from}{p.surah_to && p.surah_to !== p.surah_from ? ` — ${p.surah_to}` : ""}</span>}
                  {p.quality_rating && <span className="me-2 text-xs text-gold">{t("جودة", "Quality")}: {p.quality_rating}/5</span>}
                </div>
                <span className="text-xs text-muted">{new Date(p.created_at).toLocaleDateString(locale)}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Session History */}
      <h2 className="mb-4 text-lg font-bold">{t("سجل الجلسات", "Session History")}</h2>
      {bookings.length === 0 ? (
        <div className="glass-card p-8 text-center">
          <Inbox size={28} className="mx-auto mb-2 text-muted" />
          <p className="text-sm text-muted">{t("لا توجد جلسات مسجلة مع هذا الطالب", "No sessions recorded with this student")}</p>
        </div>
      ) : (
        <div className="space-y-3">
          {bookings.map(b => {
            const session = sessionMap[b.id];
            return (
              <div key={b.id} className="glass-card p-4">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm font-medium">{lang === "ar" ? SESSION_TYPE_AR[b.session_type] : SESSION_TYPE_EN[b.session_type]} · {b.duration_min} {t("دقيقة", "min")}</p>
                    <p className="text-xs text-muted">{new Date(b.scheduled_at).toLocaleDateString(locale, { weekday: "long", year: "numeric", month: "long", day: "numeric" })}</p>
                  </div>
                  <span className={`glass-badge rounded-full px-2 py-0.5 text-xs ${b.status === "completed" ? "text-success border-success/30" : "text-warning border-warning/30"}`}>
                    {b.status === "completed" ? t("مكتمل", "Completed") : t("مؤكد", "Confirmed")}
                  </span>
                </div>
                {session?.post_session_notes && (
                  <div className="glass mt-3 rounded-lg p-3">
                    <p className="mb-1 text-xs font-medium text-gold">{t("ملاحظات", "Notes")}</p>
                    <p className="text-sm text-muted break-words whitespace-pre-wrap">{session.post_session_notes}</p>
                  </div>
                )}
                {session?.homework && (
                  <div className="mt-2 rounded-lg border border-gold/20 bg-gold/5 p-3">
                    <p className="mb-1 text-xs font-medium text-gold">{t("المتابعة", "Follow-up")}</p>
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
