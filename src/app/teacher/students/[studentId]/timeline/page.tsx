import type { Metadata } from "next";
import { redirect } from "next/navigation";
import Link from "next/link";
import {
  ArrowRight, ScrollText, Video, Sparkles, BookOpen, BookMarked,
  RotateCcw, AlertCircle, ChevronRight,
} from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { getT } from "@/lib/i18n/server";
import { surahName } from "@/lib/quran/surahs";
import { SESSION_TYPE_AR } from "@/lib/constants";

export const metadata: Metadata = { title: "خط الطالب الزمني" };

interface Props { params: Promise<{ studentId: string }>; }

/**
 * Teacher view of a single student's timeline. Scoped to this teacher's
 * history with this student — does NOT pull other teachers' evaluations,
 * homework, or parent reports (privacy + RLS).
 *
 * Item #15 (rest) from the deep pedagogical analysis. The student-side
 * /student/timeline page surfaces ALL activity including parent reports;
 * this teacher view honours the multi-teacher reality by showing only
 * what this teacher contributed to this student's journey.
 */
type TimelineEvent =
  | { kind: "session"; at: string; sessionType: string; durationMin: number | null }
  | { kind: "evaluation"; at: string; overall: number | null; nextGoals: string | null; evalType: string | null }
  | { kind: "homework_graded"; at: string; title: string; grade: string; teacherNotes: string | null }
  | { kind: "progress"; at: string; progressType: "new" | "muraja" | "correction"; surahNum: number | null; ayahFrom: number | null; ayahTo: number | null };

const EVENT_META: Record<TimelineEvent["kind"], { icon: typeof Video; tint: string; barColor: string }> = {
  session:        { icon: Video,         tint: "text-sky-300",     barColor: "bg-sky-500/40" },
  evaluation:     { icon: Sparkles,      tint: "text-gold",        barColor: "bg-gold/40" },
  homework_graded:{ icon: BookOpen,      tint: "text-emerald-300", barColor: "bg-emerald-500/40" },
  progress:       { icon: BookMarked,    tint: "text-amber-300",   barColor: "bg-amber-500/40" },
};

export default async function TeacherStudentTimelinePage({ params }: Props) {
  const { studentId } = await params;
  const { t, dir, lang } = await getT();
  const locale = lang === "ar" ? "ar" : "en-US";
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  // RLS check: this teacher must have worked with this student. Without
  // a booking link, the teacher should not see any of this data — RLS
  // would silently filter it but we want a clean redirect.
  const { data: relation } = await supabase
    .from("bookings")
    .select("id")
    .eq("teacher_id", user.id)
    .eq("student_id", studentId)
    .limit(1)
    .maybeSingle();
  if (!relation) redirect("/teacher/students");

  // 90-day window — same as /student/timeline. Old activity lives on the
  // per-domain pages (sessions, evaluations, homework).
  const ninetyDaysAgoIso = new Date(Date.now() - 90 * 86400_000).toISOString();

  type BookingRow = {
    id: string;
    session_type: string;
    duration_min: number | null;
    scheduled_at: string;
  };
  type EvalRow = {
    id: string;
    overall_score: number | null;
    next_goals: string | null;
    evaluation_type: string | null;
    created_at: string;
  };
  type HomeworkRow = {
    id: string;
    title: string;
    status: string;
    teacher_notes: string | null;
    completed_at: string | null;
  };
  type ProgressRow = {
    id: string;
    progress_type: string;
    surah_to: number | null;
    ayah_to: number | null;
    surah_from: number | null;
    ayah_from: number | null;
    created_at: string;
  };

  const [studentRes, bookingsRes, evalsRes, hwRes, progressRes] = await Promise.all([
    supabase.from("profiles").select("full_name").eq("id", studentId)
      .single<{ full_name: string | null }>(),
    supabase.from("bookings")
      .select("id, session_type, duration_min, scheduled_at")
      .eq("teacher_id", user.id).eq("student_id", studentId).eq("status", "completed")
      .gte("scheduled_at", ninetyDaysAgoIso)
      .order("scheduled_at", { ascending: false })
      .returns<BookingRow[]>(),
    supabase.from("session_evaluations")
      .select("id, overall_score, next_goals, evaluation_type, created_at")
      .eq("teacher_id", user.id).eq("student_id", studentId)
      .gte("created_at", ninetyDaysAgoIso)
      .order("created_at", { ascending: false })
      .returns<EvalRow[]>(),
    supabase.from("homework_assignments")
      .select("id, title, status, teacher_notes, completed_at")
      .eq("teacher_id", user.id).eq("student_id", studentId)
      .like("status", "completed_%")
      .gte("completed_at", ninetyDaysAgoIso)
      .order("completed_at", { ascending: false })
      .returns<HomeworkRow[]>(),
    supabase.from("student_progress")
      .select("id, progress_type, surah_to, ayah_to, surah_from, ayah_from, created_at")
      .eq("teacher_id", user.id).eq("student_id", studentId)
      .gte("created_at", ninetyDaysAgoIso)
      .order("created_at", { ascending: false })
      .returns<ProgressRow[]>(),
  ]);

  const studentName = studentRes.data?.full_name ?? t("الطالب", "Student");
  const events: TimelineEvent[] = [];
  for (const b of bookingsRes.data ?? []) {
    events.push({
      kind: "session",
      at: b.scheduled_at,
      sessionType: b.session_type,
      durationMin: b.duration_min,
    });
  }
  for (const e of evalsRes.data ?? []) {
    events.push({
      kind: "evaluation",
      at: e.created_at,
      overall: e.overall_score,
      nextGoals: e.next_goals,
      evalType: e.evaluation_type,
    });
  }
  for (const h of hwRes.data ?? []) {
    if (!h.completed_at) continue;
    events.push({
      kind: "homework_graded",
      at: h.completed_at,
      title: h.title,
      grade: h.status,
      teacherNotes: h.teacher_notes,
    });
  }
  for (const p of progressRes.data ?? []) {
    events.push({
      kind: "progress",
      at: p.created_at,
      progressType: (p.progress_type as "new" | "muraja" | "correction"),
      surahNum: p.surah_to ?? p.surah_from,
      ayahFrom: p.ayah_from,
      ayahTo: p.ayah_to,
    });
  }

  events.sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime());

  const byDay = new Map<string, TimelineEvent[]>();
  for (const e of events) {
    const dayKey = new Date(e.at).toLocaleDateString("en-CA");
    const arr = byDay.get(dayKey) ?? [];
    arr.push(e);
    byDay.set(dayKey, arr);
  }
  const days = Array.from(byDay.keys());

  return (
    <div dir={dir} className="mx-auto max-w-3xl px-4 py-8">
      <Link
        href={`/teacher/students/${studentId}`}
        className="mb-4 inline-flex items-center gap-1 text-sm text-gold hover:text-gold-hover focus-ring rounded"
      >
        <ArrowRight size={14} aria-hidden="true" />
        {t("العودة لملف الطالب", "Back to student profile")}
      </Link>

      <div className="mb-6 flex items-center gap-3">
        <ScrollText size={24} className="text-gold" aria-hidden="true" />
        <div>
          <h1 className="text-xl font-bold">{studentName}</h1>
          <p className="mt-0.5 text-xs text-muted">
            {t(
              "خط زمني لما حدث بينك وبين الطالب آخر ٩٠ يوماً.",
              "Timeline of everything that happened between you and this student over the last 90 days.",
            )}
          </p>
        </div>
      </div>

      {events.length === 0 ? (
        <div className="glass-card p-12 text-center">
          <ScrollText size={40} className="mx-auto mb-3 text-muted/40" aria-hidden="true" />
          <p className="text-muted">
            {t("لا توجد أنشطة في آخر ٩٠ يوماً", "No activity in the last 90 days")}
          </p>
        </div>
      ) : (
        <ol className="space-y-6">
          {days.map(day => {
            const dayEvents = byDay.get(day)!;
            const dayLabel = new Date(day).toLocaleDateString(locale, {
              weekday: "long", year: "numeric", month: "long", day: "numeric",
            });
            return (
              <li key={day}>
                <h2 className="mb-2 text-xs font-medium uppercase tracking-wider text-muted-light">
                  {dayLabel}
                </h2>
                <ol className="space-y-2">
                  {dayEvents.map((e, idx) => (
                    <TimelineEntry
                      key={`${day}-${idx}`}
                      event={e}
                      t={t}
                      lang={lang === "ar" ? "ar" : "en"}
                      locale={locale}
                    />
                  ))}
                </ol>
              </li>
            );
          })}
        </ol>
      )}
    </div>
  );
}

function TimelineEntry({
  event, t, lang, locale,
}: {
  event: TimelineEvent;
  t: (ar: string, en: string) => string;
  lang: "ar" | "en";
  locale: string;
}) {
  const meta = EVENT_META[event.kind];
  const Icon = meta.icon;
  const time = new Date(event.at).toLocaleTimeString(locale, { hour: "2-digit", minute: "2-digit" });

  let body: React.ReactNode = null;
  switch (event.kind) {
    case "session": {
      const typeLabel = lang === "ar"
        ? (SESSION_TYPE_AR as Record<string, string>)[event.sessionType] ?? event.sessionType
        : event.sessionType;
      body = (
        <>
          <p className="text-sm font-medium">
            {t(`جلسة ${typeLabel}`, `${typeLabel} session`)}
          </p>
          {event.durationMin && (
            <p className="text-xs text-muted">{event.durationMin} {t("دقيقة", "min")}</p>
          )}
        </>
      );
      break;
    }
    case "evaluation":
      body = (
        <>
          <p className="text-sm font-medium">
            {t(
              `تقييم${event.evalType ? ` (${event.evalType})` : ""}${event.overall ? ` — ${event.overall}/10 إجمالي` : ""}`,
              `Evaluation${event.evalType ? ` (${event.evalType})` : ""}${event.overall ? ` — ${event.overall}/10 overall` : ""}`,
            )}
          </p>
          {event.nextGoals && (
            <p className="mt-1 text-xs text-foreground/80 line-clamp-2">{event.nextGoals}</p>
          )}
        </>
      );
      break;
    case "homework_graded": {
      const gradeLabel: Record<string, { ar: string; en: string }> = {
        completed_excellent: { ar: "ممتاز", en: "Excellent" },
        completed_good: { ar: "جيد", en: "Good" },
        completed_needs_work: { ar: "يحتاج تحسين", en: "Needs work" },
        completed_not_done: { ar: "لم يُنجز", en: "Not done" },
      };
      const g = gradeLabel[event.grade] ?? { ar: event.grade, en: event.grade };
      body = (
        <>
          <p className="text-sm font-medium">
            {t(`متابعة: ${event.title} — ${g.ar}`, `Homework: ${event.title} — ${g.en}`)}
          </p>
          {event.teacherNotes && (
            <p className="mt-1 text-xs text-gold/80 line-clamp-2">💬 {event.teacherNotes}</p>
          )}
        </>
      );
      break;
    }
    case "progress": {
      const surah = surahName(event.surahNum, lang);
      const ayahPart =
        event.ayahFrom && event.ayahTo && event.ayahFrom !== event.ayahTo
          ? ` (${event.ayahFrom}–${event.ayahTo})`
          : event.ayahFrom
          ? ` (${event.ayahFrom})`
          : "";
      const typeLabel: Record<typeof event.progressType, { ar: string; en: string; icon?: typeof RotateCcw }> = {
        new: { ar: "حفظ جديد", en: "New memorization" },
        muraja: { ar: "مراجعة", en: "Review", icon: RotateCcw },
        correction: { ar: "تصحيح", en: "Correction", icon: AlertCircle },
      };
      const tl = typeLabel[event.progressType];
      body = (
        <p className="text-sm font-medium">
          {t(`${tl.ar}: سورة ${surah}${ayahPart}`, `${tl.en}: Surah ${surah}${ayahPart}`)}
        </p>
      );
      break;
    }
  }

  return (
    <li className="rounded-xl border border-card-border bg-card p-3">
      <div className="flex items-start gap-3">
        <div className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full ${meta.barColor}`}>
          <Icon size={14} className={meta.tint} aria-hidden="true" />
        </div>
        <div className="min-w-0 flex-1">
          {body}
          <p className="mt-1 text-[10px] tabular-nums text-muted-light">{time}</p>
        </div>
        <ChevronRight size={14} className="mt-2 shrink-0 text-muted-light/40" aria-hidden="true" />
      </div>
    </li>
  );
}
