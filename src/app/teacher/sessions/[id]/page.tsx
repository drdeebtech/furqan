import type { Metadata } from "next";
import { redirect } from "next/navigation";
import Link from "next/link";
import { ArrowRight, Sparkles, AlertTriangle, BookMarked, MessageSquareQuote } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { SESSION_TYPE_AR } from "@/lib/constants";
import { surahName } from "@/lib/quran/surahs";
import { getT } from "@/lib/i18n/server";
import { riskBadgeClass, riskLabel } from "@/lib/retention/ui";
import type { SessionType, SessionMode, HomeworkAssignment } from "@/types/database";
import { SessionModeBadge } from "@/components/sessions/SessionModeBadge";

const SESSION_TYPE_EN: Record<SessionType, string> = {
  hifz: "Hifz", muraja: "Review", tajweed: "Tajweed", tilawa: "Tilawa",
  qiraat: "Qiraat", tafsir: "Tafsir", combined: "Hifz + Review", other: "Other",
};
import { VideoRoom } from "@/app/student/sessions/[id]/video-room";
import { PostSessionForm } from "./post-session-form";
import { SessionDetailControls } from "./session-detail-controls";
import { LessonPlanPanel } from "./lesson-plan-panel";
import { HomeworkAssignmentForm } from "@/components/shared/homework-assignment-form";
import { AddStudentControl } from "./add-student-control";
import { NoErrorsButton } from "./no-errors-button";
import type { LessonPlan } from "@/lib/actions/session-lesson-plan";
import { isFeatureEnabled } from "@/lib/settings";

export const metadata: Metadata = { title: "الجلسة" };

interface Props {
  params: Promise<{ id: string }>;
}

export default async function TeacherSessionPage({ params }: Props) {
  const { id } = await params;
  const { t, dir, lang } = await getT();
  const locale = lang === "ar" ? "ar-EG" : "en-US";
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: session } = await supabase
    .from("sessions")
    .select("id, booking_id, session_mode, room_url, room_name, expires_at, started_at, ended_at, actual_duration, post_session_notes, homework, lesson_plan, is_group, capacity")
    .eq("id", id)
    .single<{
      id: string;
      booking_id: string;
      session_mode: SessionMode;
      room_url: string;
      room_name: string;
      expires_at: string | null;
      started_at: string | null;
      ended_at: string | null;
      actual_duration: number | null;
      post_session_notes: string | null;
      homework: string | null;
      lesson_plan: LessonPlan | null;
      is_group: boolean;
      capacity: number;
    }>();

  if (!session) redirect("/teacher/sessions");

  const { data: booking } = await supabase
    .from("bookings")
    .select("student_id, teacher_id, scheduled_at, duration_min, session_type")
    .eq("id", session.booking_id)
    .single<{
      student_id: string;
      teacher_id: string;
      scheduled_at: string;
      duration_min: number;
      session_type: SessionType;
    }>();

  if (!booking || booking.teacher_id !== user.id) redirect("/teacher/sessions");

  const [studentRes, retentionRes, prevEvalRes, lastProgressRes] = await Promise.all([
    supabase.from("profiles").select("full_name").eq("id", booking.student_id)
      .single<{ full_name: string | null }>(),
    supabase.from("retention_signals").select("churn_risk_score").eq("student_id", booking.student_id)
      .maybeSingle<{ churn_risk_score: number | null }>(),
    // Most recent evaluation THIS teacher wrote for THIS student. Drives
    // the "you said last time" prompt — closes the loop between teacher
    // intent (next_goals text) and teacher follow-through (did the
    // session today address what was promised last time?).
    // Uses live schema column names: next_goals (forward-looking guidance)
    // and areas_for_improvement (weakness summary). Earlier code used
    // recommendations/weaknesses which never existed — Sentry E4-16.
    supabase.from("session_evaluations")
      .select("next_goals, areas_for_improvement, created_at")
      .eq("student_id", booking.student_id)
      .eq("teacher_id", user.id)
      .not("next_goals", "is", null)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle<{ next_goals: string | null; areas_for_improvement: string | null; created_at: string }>(),
    // Latest student_progress row — gives surah/ayah position the teacher
    // is about to continue from.
    supabase.from("student_progress")
      .select("surah_to, ayah_to, surah_from, ayah_from, level, recitation_standard, created_at")
      .eq("student_id", booking.student_id)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle<{ surah_to: number | null; ayah_to: number | null; surah_from: number | null; ayah_from: number | null; level: string; recitation_standard: string | null; created_at: string }>(),
  ]);
  const student = studentRes.data;
  const studentRisk = retentionRes.data?.churn_risk_score ?? null;
  const prevEval = prevEvalRes.data ?? null;
  const lastProgress = lastProgressRes.data ?? null;

  // Recitation error breakdown for this student, last 30 days. Two-step
  // because recitation_errors is keyed by progress_id (FK), not student_id.
  // Aggregates by error_type so the teacher sees "the student needs work
  // on madd + makharij" before walking into the session.
  const thirtyDaysAgoIso = new Date(Date.now() - 30 * 86400_000).toISOString();
  const { data: recentProgressIds } = await supabase
    .from("student_progress")
    .select("id")
    .eq("student_id", booking.student_id)
    .gte("created_at", thirtyDaysAgoIso)
    .returns<{ id: string }[]>();
  const errorCounts: Record<string, number> = {
    makharij: 0, sifat: 0, madd: 0, waqf: 0, ghunna: 0, other: 0,
  };
  if (recentProgressIds && recentProgressIds.length > 0) {
    // Exclude the no-errors-observed sentinel rows (Sprint 2.2). They live
    // in recitation_errors so the per-session banner can flip green via
    // a single COUNT, but they aren't real tajweed errors and would
    // otherwise inflate the 'other' bucket in the heatmap.
    const { data: errs } = await supabase
      .from("recitation_errors")
      .select("error_type, note")
      .in("progress_id", recentProgressIds.map(p => p.id))
      .gte("created_at", thirtyDaysAgoIso)
      .returns<{ error_type: string; note: string | null }[]>();
    for (const e of errs ?? []) {
      if (e.note === "__no_errors_observed_sentinel__") continue;
      if (e.error_type in errorCounts) errorCounts[e.error_type] += 1;
      else errorCounts.other += 1;
    }
  }
  const topErrorCategories = Object.entries(errorCounts)
    .filter(([, c]) => c > 0)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3);

  // Sprint 2.2 (2026-05-05): per-session error count for the end-session
  // nudge. Filters student_progress rows tied to THIS booking (progress
  // entries the teacher created during this specific session), then
  // counts recitation_errors hung off them. Drives the "no errors
  // logged this session yet" prompt above PostSessionForm.
  const { data: thisSessionProgress } = await supabase
    .from("student_progress")
    .select("id")
    .eq("booking_id", session.booking_id)
    .returns<{ id: string }[]>();
  let sessionErrorCount = 0;
  let hasNoErrorsAttestation = false;
  if (thisSessionProgress && thisSessionProgress.length > 0) {
    const progressIds = thisSessionProgress.map(p => p.id);
    // Real-error count excludes the sentinel so the banner reflects only
    // tajweed errors the teacher actually logged.
    const { count: realCount } = await supabase
      .from("recitation_errors")
      .select("id", { count: "exact", head: true })
      .in("progress_id", progressIds)
      .neq("note", "__no_errors_observed_sentinel__");
    sessionErrorCount = realCount ?? 0;
    // Separate check for the attestation sentinel — when this is true and
    // realCount is 0, the banner shows "teacher confirmed: no errors".
    const { count: sentinelCount } = await supabase
      .from("recitation_errors")
      .select("id", { count: "exact", head: true })
      .in("progress_id", progressIds)
      .eq("note", "__no_errors_observed_sentinel__");
    hasNoErrorsAttestation = (sentinelCount ?? 0) > 0;
  }

  // Group-session: list every student enrolled in this session via their
  // own bookings row. Each enrolled booking has its own follow-up feed.
  const { data: enrolledRaw } = await supabase
    .from("bookings")
    .select("id, student_id")
    .eq("session_id", session.id)
    .is("deleted_at", null)
    .returns<{ id: string; student_id: string }[]>();
  // Defensive: include the primary booking too so a freshly-created session
  // (where bookings.session_id hasn't been backfilled yet) still shows the
  // primary student.
  const allEnrolledBookings = (() => {
    const seen = new Set((enrolledRaw ?? []).map(b => b.id));
    const out = [...(enrolledRaw ?? [])];
    if (!seen.has(session.booking_id)) {
      out.unshift({ id: session.booking_id, student_id: booking.student_id });
    }
    return out;
  })();
  const enrolledStudentIds = Array.from(new Set(allEnrolledBookings.map(b => b.student_id)));
  const enrolledBookingIds = allEnrolledBookings.map(b => b.id);

  // Names + per-booking follow-up in two round-trips.
  const [profilesRes, hwRes] = await Promise.all([
    enrolledStudentIds.length > 0
      ? supabase.from("profiles").select("id, full_name").in("id", enrolledStudentIds)
          .returns<{ id: string; full_name: string | null }[]>()
      : Promise.resolve({ data: [] }),
    enrolledBookingIds.length > 0
      ? supabase.from("homework_assignments").select("*").in("booking_id", enrolledBookingIds)
          .order("assigned_at", { ascending: false })
          .returns<HomeworkAssignment[]>()
      : Promise.resolve({ data: [] }),
  ]);
  const profileById = new Map((profilesRes.data ?? []).map(p => [p.id, p.full_name ?? t("بدون اسم", "Unnamed")]));
  const enrolledList = enrolledStudentIds.map((sid) => ({
    id: sid,
    name: profileById.get(sid) ?? t("بدون اسم", "Unnamed"),
  }));
  // Group follow-up by booking_id for easy per-student lookup downstream.
  const homeworkByBooking = new Map<string, HomeworkAssignment[]>();
  for (const hw of hwRes.data ?? []) {
    const arr = homeworkByBooking.get(hw.booking_id) ?? [];
    arr.push(hw);
    homeworkByBooking.set(hw.booking_id, arr);
  }
  // Build the per-student "card" payload for the post-session form.
  const enrolledForForm = allEnrolledBookings.map((b) => ({
    bookingId: b.id,
    studentId: b.student_id,
    studentName: profileById.get(b.student_id) ?? t("الطالب", "Student"),
    assignments: homeworkByBooking.get(b.id) ?? [],
  }));
  // Legacy single-student feed used by the inline "Assign follow-up now"
  // panel for in-progress sessions — keep pointing at the primary booking.
  const hwAssignments = homeworkByBooking.get(session.booking_id) ?? [];

  // Candidates for the "Add student" picker: every student the teacher has
  // worked with (any non-deleted booking), minus the ones already enrolled.
  // Using the teacher_id keeps the list scoped — a teacher with 200 students
  // shouldn't pick from a global directory.
  const { data: candidateBookings } = await supabase
    .from("bookings")
    .select("student_id")
    .eq("teacher_id", booking.teacher_id)
    .is("deleted_at", null)
    .returns<{ student_id: string }[]>();
  const candidateIds = Array.from(new Set((candidateBookings ?? []).map(b => b.student_id)));
  const { data: candidateProfiles } = candidateIds.length > 0
    ? await supabase.from("profiles").select("id, full_name").in("id", candidateIds)
        .returns<{ id: string; full_name: string | null }[]>()
    : { data: [] };
  const candidates = (candidateProfiles ?? [])
    .map((p) => ({ id: p.id, name: p.full_name ?? t("بدون اسم", "Unnamed") }))
    .sort((a, b) => a.name.localeCompare(b.name));

  const studentName = student?.full_name || t("الطالب", "Student");
  const scheduledDate = new Date(booking.scheduled_at);
  const isCompleted = session.ended_at !== null;

  return (
    <div dir={dir} className="mx-auto max-w-5xl px-4 py-8">
      <Link
        href="/teacher/sessions"
        className="mb-6 inline-flex items-center gap-1 text-sm text-gold transition-colors hover:text-gold-hover focus-ring"
      >
        <ArrowRight size={14} />
        {t("العودة للجلسات", "Back to Sessions")}
      </Link>

      <div className="glass-card mb-6 flex flex-wrap items-center justify-between gap-4 p-4">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-lg font-bold">{studentName}</h1>
            <SessionModeBadge mode={session.session_mode} size="sm" />
            {studentRisk != null && studentRisk >= 40 && (
              <span className={`glass-badge ${riskBadgeClass(studentRisk)}`} title={`${t("خطر التسرب", "Churn risk")}: ${studentRisk.toFixed(0)}`}>
                {riskLabel(studentRisk)}
              </span>
            )}
          </div>
          <p className="mt-1 text-sm text-gold">
            {lang === "ar" ? SESSION_TYPE_AR[booking.session_type] : SESSION_TYPE_EN[booking.session_type]}
            <span className="me-2 text-muted">· {booking.duration_min} {t("دقيقة", "min")}</span>
          </p>
          <p dir="ltr" className="mt-1 text-left text-sm text-muted">
            {scheduledDate.toLocaleDateString(locale, { weekday: "long", year: "numeric", month: "long", day: "numeric" })}
            <span className="mx-2">·</span>
            {scheduledDate.toLocaleTimeString(locale, { hour: "2-digit", minute: "2-digit" })}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {(session.is_group || enrolledList.length > 1) && (
            <div className="glass glass-pill border-gold/30 bg-gold/10 px-3 py-1 text-xs text-gold">
              {t("جلسة جماعية", "Group session")} · {enrolledList.length}/{session.capacity}
            </div>
          )}
          {isCompleted && session.actual_duration && (
            <div className="glass glass-pill px-3 py-1 text-sm text-muted">
              {t("مدة الجلسة", "Session duration")}: {session.actual_duration} {t("دقيقة", "min")}
            </div>
          )}
        </div>
      </div>

      {/* Pre-session prep — what THIS teacher told THIS student last time +
          recent error patterns + last memorization position. Helps the
          teacher walk into the session with context instead of "what did
          we say last time?" friction. Hidden when there's nothing to show
          (brand-new student-teacher pairing, no prior data) and on group
          sessions for now (per-student panels need a separate UI). */}
      {!isCompleted && enrolledList.length <= 1 && (
        prevEval || lastProgress || topErrorCategories.length > 0
      ) && (
        <div className="mb-4 rounded-2xl border border-gold/20 bg-gold/[0.03] p-5">
          <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold text-gold">
            <Sparkles size={14} aria-hidden="true" />
            {t("تحضير الجلسة", "Pre-session prep")}
          </h2>

          <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
            {/* What this teacher said last time. */}
            {prevEval?.next_goals && (
              <div className="rounded-xl border border-gold/30 bg-gold/5 p-3 md:col-span-3">
                <h3 className="mb-1 flex items-center gap-1.5 text-xs font-semibold text-gold">
                  <MessageSquareQuote size={12} aria-hidden="true" />
                  {t(
                    `قلت في آخر تقييم (${new Date(prevEval.created_at).toLocaleDateString(locale, { month: "short", day: "numeric" })})`,
                    `What you wrote last evaluation (${new Date(prevEval.created_at).toLocaleDateString(locale, { month: "short", day: "numeric" })})`,
                  )}
                </h3>
                <p className="text-sm leading-relaxed text-foreground">{prevEval.next_goals}</p>
                {prevEval.areas_for_improvement && (
                  <p className="mt-2 text-xs text-muted">
                    <span className="text-orange-400">{t("نقاط ضعف:", "Weaknesses:")}</span> {prevEval.areas_for_improvement}
                  </p>
                )}
              </div>
            )}

            {/* Last memorization position — surah/ayah/level/standard. */}
            {lastProgress && (lastProgress.surah_to || lastProgress.surah_from) && (
              <div className="rounded-xl border border-card-border bg-card/50 p-3">
                <h3 className="mb-1 flex items-center gap-1.5 text-xs font-medium text-muted">
                  <BookMarked size={12} aria-hidden="true" />
                  {t("آخر موقع محفوظ", "Last position")}
                </h3>
                <p className="text-sm font-medium text-foreground">
                  {(() => {
                    const num = lastProgress.surah_to ?? lastProgress.surah_from;
                    const ayah = lastProgress.ayah_to ?? lastProgress.ayah_from;
                    const name = surahName(num, lang === "ar" ? "ar" : "en");
                    return lang === "ar"
                      ? `سورة ${name}${ayah ? ` آية ${ayah}` : ""}`
                      : `Surah ${name}${ayah ? ` · ayah ${ayah}` : ""}`;
                  })()}
                </p>
                {lastProgress.recitation_standard && (
                  <p className="mt-1 text-[11px] text-muted">
                    {(() => {
                      const std: Record<string, { ar: string; en: string }> = {
                        hafs: { ar: "حفص عن عاصم", en: "Hafs an Asim" },
                        warsh: { ar: "ورش عن نافع", en: "Warsh an Nafi" },
                        qalon: { ar: "قالون عن نافع", en: "Qalun an Nafi" },
                        al_duri: { ar: "الدوري عن أبي عمرو", en: "Al-Duri an Abu Amr" },
                        shu_ba: { ar: "شعبة عن عاصم", en: "Shu'ba an Asim" },
                      };
                      const label = std[lastProgress.recitation_standard];
                      return label ? t(label.ar, label.en) : lastProgress.recitation_standard;
                    })()}
                  </p>
                )}
              </div>
            )}

            {/* Top recitation error categories last 30 days. */}
            {topErrorCategories.length > 0 && (
              <div className="rounded-xl border border-card-border bg-card/50 p-3 md:col-span-2">
                <h3 className="mb-1 flex items-center gap-1.5 text-xs font-medium text-muted">
                  <AlertTriangle size={12} aria-hidden="true" />
                  {t("أنماط أخطاء حديثة (٣٠ يوم)", "Recent error patterns (30 days)")}
                </h3>
                <div className="flex flex-wrap gap-1.5">
                  {topErrorCategories.map(([cat, count]) => {
                    const label: Record<string, { ar: string; en: string }> = {
                      makharij: { ar: "مخارج", en: "Makharij" },
                      sifat: { ar: "صفات", en: "Sifat" },
                      madd: { ar: "مدود", en: "Madd" },
                      waqf: { ar: "وقف", en: "Waqf" },
                      ghunna: { ar: "غنّة", en: "Ghunna" },
                      other: { ar: "أخرى", en: "Other" },
                    };
                    const l = label[cat] ?? { ar: cat, en: cat };
                    return (
                      <span
                        key={cat}
                        className="inline-flex items-center gap-1 rounded-full border border-amber-500/30 bg-amber-500/10 px-2.5 py-0.5 text-xs text-amber-300"
                      >
                        <span className="font-bold">{count}</span>
                        <span>{t(l.ar, l.en)}</span>
                      </span>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Enrolled students — always shown so the teacher knows who's in the
          session. The Add Student button lets them grow a 1:1 into a group
          ad-hoc (Phase 1 of group lessons). Hidden once the session is
          completed since adding a student to history is not meaningful. */}
      {!isCompleted && (
        <div className="glass-card mb-4 p-4">
          <div className="mb-3 flex items-center justify-between gap-2">
            <p className="text-xs font-medium uppercase tracking-wider text-muted">
              {t("الطلاب المسجَّلون", "Enrolled students")} · {enrolledList.length}
            </p>
            <AddStudentControl
              sessionId={session.id}
              candidates={candidates}
              enrolledIds={enrolledStudentIds}
            />
          </div>
          {enrolledList.length === 0 ? (
            <p className="text-sm text-muted">{t("لا يوجد طلاب", "No students yet")}</p>
          ) : (
            <ul className="flex flex-wrap gap-2">
              {enrolledList.map((s) => (
                <li
                  key={s.id}
                  className="glass-badge border-gold/30 bg-gold/10 px-3 py-1 text-xs font-medium text-gold"
                >
                  {s.name}
                  {s.id === booking.student_id && enrolledList.length > 1 && (
                    <span className="ms-1 text-[10px] text-gold/60" title={t("الطالب الأصلي", "Primary booking")}>
                      ★
                    </span>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {/* Session controls (timer + end/extend buttons) when active */}
      {!isCompleted && (
        <SessionDetailControls
          sessionId={session.id}
          startedAt={session.started_at}
          expiresAt={session.expires_at}
          durationMin={booking.duration_min}
          scheduledAt={booking.scheduled_at}
        />
      )}

      {!isCompleted && (await isFeatureEnabled("lesson_plan_enabled")) && (
        <div className="mt-4">
          <LessonPlanPanel sessionId={session.id} initialPlan={session.lesson_plan} />
        </div>
      )}

      {isCompleted ? (
        <>
          {/* Sprint 2.2 (2026-05-05): end-session error-logging nudge with
              active attestation. Three states:
              - amber: no errors logged AND no attestation → teacher must
                either log errors or click "no errors observed".
              - green-attested: 0 real errors but attestation row exists →
                teacher actively confirmed they observed and saw none.
              - green-logged: real errors > 0 → already in the heatmap. */}
          <div className={`mt-4 rounded-xl border p-3 ${
            sessionErrorCount === 0 && !hasNoErrorsAttestation
              ? "border-warning/30 bg-warning/10"
              : "border-success/30 bg-success/10"
          }`}>
            <p className={`flex items-center gap-1.5 text-sm font-medium ${
              sessionErrorCount === 0 && !hasNoErrorsAttestation ? "text-warning" : "text-success"
            }`}>
              <AlertTriangle size={14} aria-hidden="true" />
              {sessionErrorCount === 0 && !hasNoErrorsAttestation
                ? t("لا توجد أخطاء مُسجَّلة لهذه الجلسة", "No errors logged for this session yet")
                : sessionErrorCount === 0 && hasNoErrorsAttestation
                  ? t("أكدتَ أنه لم تُلاحَظ أخطاء في هذه الجلسة", "You confirmed: no errors observed for this session")
                  : t(`تم تسجيل ${sessionErrorCount} خطأ لهذه الجلسة`, `${sessionErrorCount} errors logged for this session`)}
            </p>
            <p className="mt-1 text-xs text-muted">
              {sessionErrorCount === 0 && !hasNoErrorsAttestation
                ? t(
                  "إذا ارتكب الطالب أخطاءً تجويدية، سجّلها لتظهر في خريطة أخطائه. وإن لم تُلاحَظ أخطاء، اضغط الزر أدناه ليُسجَّل ذلك صراحةً.",
                  "If the student made tajweed errors, log them so they appear in the heatmap. If no errors were observed, click the button below to record that explicitly.",
                )
                : sessionErrorCount === 0 && hasNoErrorsAttestation
                  ? t(
                    "تم حفظ الإقرار. لن تظهر علامات أخطاء وهمية في خريطة الطالب.",
                    "Attestation saved. No fake error marks will appear in the student's heatmap.",
                  )
                  : t(
                    "ستظهر هذه الأخطاء في خريطة الطالب على صفحة تقدمه.",
                    "These will appear in the student's error heatmap on their progress page.",
                  )}
            </p>
            {sessionErrorCount === 0 && !hasNoErrorsAttestation && (
              <NoErrorsButton sessionId={session.id} bookingId={session.booking_id} />
            )}
          </div>
          <PostSessionForm
            sessionId={session.id}
            bookingId={session.booking_id}
            studentId={booking.student_id}
            studentName={studentName}
            existingNotes={session.post_session_notes}
            existingHomework={session.homework}
            existingAssignments={hwAssignments}
            enrolled={enrolledForForm}
          />
        </>
      ) : (
        <>
          <VideoRoom
            sessionId={session.id}
            roomUrl={session.room_url}
            userName={user.user_metadata?.full_name ?? t("معلم", "Teacher")}
            expiresAt={session.expires_at}
            durationMin={booking.duration_min}
          />
          {/* Follow-ups can be assigned at any time, not only post-session.
              Collapsed by default so it doesn't compete with the video room. */}
          <details className="glass-card mt-4 p-4">
            <summary className="cursor-pointer text-sm font-medium">
              {t("اعتماد متابعة الآن", "Assign follow-up now")}
            </summary>
            <div className="mt-3">
              <HomeworkAssignmentForm
                bookingId={session.booking_id}
                studentId={booking.student_id}
                sessionId={session.id}
                existingAssignments={hwAssignments ?? []}
                hideHeader
                defaultOpen
              />
            </div>
          </details>
        </>
      )}
    </div>
  );
}
