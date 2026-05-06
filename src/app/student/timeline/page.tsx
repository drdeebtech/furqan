import type { Metadata } from "next";
import { redirect } from "next/navigation";
import Link from "next/link";
import {
  ScrollText, Video, ClipboardCheck, BookOpen, Mail, BookMarked,
  Sparkles, RotateCcw, AlertCircle, ChevronRight,
} from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { getT } from "@/lib/i18n/server";
import { surahName } from "@/lib/quran/surahs";
import { HOMEWORK_TYPE_AR, SESSION_TYPE_AR } from "@/lib/constants";
import { EmptyState } from "@/components/shared/empty-state";

export const metadata: Metadata = { title: "خط زمني" };

/**
 * Student-side unified timeline. Merges five data sources into one
 * chronological feed so the student can see the arc of their journey in
 * one place: sessions held, evaluations written, follow-up graded, parent
 * reports sent, and progress logged. Read-only.
 *
 * This is the student-view-only first cut of item #15 (parent-student-
 * teacher triangle dashboard) from the deep pedagogical analysis. The
 * full multi-role version — where parent + teacher see the same timeline
 * with role-appropriate context — comes later (needs parent-profile
 * elevation and additional RLS). The student-only timeline ships now
 * because it works on existing RLS without any schema change.
 */

type TimelineEvent =
  | { kind: "session"; at: string; teacherName: string; sessionType: string; durationMin: number | null; href: string }
  | { kind: "evaluation"; at: string; overall: number | null; next_goals: string | null; evalType: string | null; href: string }
  | { kind: "homework_graded"; at: string; title: string; grade: string; teacherNotes: string | null; teacherName: string; href: string }
  | { kind: "parent_report"; at: string; reportType: string; href: string }
  | { kind: "progress"; at: string; progressType: "new" | "muraja" | "correction"; surahNum: number | null; ayahFrom: number | null; ayahTo: number | null; teacherName: string };

const EVENT_META: Record<TimelineEvent["kind"], { icon: typeof Video; tint: string; barColor: string }> = {
  session:        { icon: Video,         tint: "text-sky-300",     barColor: "bg-sky-500/40" },
  evaluation:     { icon: Sparkles,      tint: "text-gold",        barColor: "bg-gold/40" },
  homework_graded:{ icon: BookOpen,      tint: "text-emerald-300", barColor: "bg-emerald-500/40" },
  parent_report:  { icon: Mail,          tint: "text-violet-300",  barColor: "bg-violet-500/40" },
  progress:       { icon: BookMarked,    tint: "text-amber-300",   barColor: "bg-amber-500/40" },
};

export default async function StudentTimelinePage() {
  const { t, dir, lang } = await getT();
  const locale = lang === "ar" ? "ar" : "en-US";
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  // Pull the last 90 days from each source. 90d covers the typical
  // pedagogical "recent past" the student wants to remember; older history
  // is available in the per-domain pages (sessions / progress / etc.).
  const ninetyDaysAgoIso = new Date(Date.now() - 90 * 86400_000).toISOString();

  type BookingRow = {
    id: string;
    teacher_id: string;
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
    teacher_id: string;
    teacher_notes: string | null;
    completed_at: string | null;
  };
  type ParentReportRow = {
    id: string;
    report_type: string;
    sent_at: string | null;
    created_at: string;
  };
  type ProgressRow = {
    id: string;
    progress_type: string;
    surah_to: number | null;
    ayah_to: number | null;
    surah_from: number | null;
    ayah_from: number | null;
    teacher_id: string;
    created_at: string;
  };

  const [bookingsRes, evalsRes, hwRes, parentRes, progressRes] = await Promise.all([
    supabase.from("bookings")
      .select("id, teacher_id, session_type, duration_min, scheduled_at")
      .eq("student_id", user.id).eq("status", "completed")
      .gte("scheduled_at", ninetyDaysAgoIso)
      .order("scheduled_at", { ascending: false })
      .returns<BookingRow[]>(),
    supabase.from("session_evaluations")
      .select("id, overall_score, next_goals, evaluation_type, created_at")
      .eq("student_id", user.id)
      .gte("created_at", ninetyDaysAgoIso)
      .order("created_at", { ascending: false })
      .returns<EvalRow[]>(),
    supabase.from("homework_assignments")
      .select("id, title, status, teacher_id, teacher_notes, completed_at")
      .eq("student_id", user.id)
      .like("status", "completed_%")
      .gte("completed_at", ninetyDaysAgoIso)
      .order("completed_at", { ascending: false })
      .returns<HomeworkRow[]>(),
    supabase.from("parent_reports")
      .select("id, report_type, sent_at, created_at")
      .eq("student_id", user.id)
      .gte("created_at", ninetyDaysAgoIso)
      .order("created_at", { ascending: false })
      .returns<ParentReportRow[]>(),
    supabase.from("student_progress")
      .select("id, progress_type, surah_to, ayah_to, surah_from, ayah_from, teacher_id, created_at")
      .eq("student_id", user.id)
      .gte("created_at", ninetyDaysAgoIso)
      .order("created_at", { ascending: false })
      .returns<ProgressRow[]>(),
  ]);

  // Resolve teacher names for any teacher_id referenced.
  const teacherIds = new Set<string>();
  for (const b of bookingsRes.data ?? []) teacherIds.add(b.teacher_id);
  for (const h of hwRes.data ?? []) teacherIds.add(h.teacher_id);
  for (const p of progressRes.data ?? []) teacherIds.add(p.teacher_id);
  const nameMap: Record<string, string> = {};
  if (teacherIds.size > 0) {
    const { data: profiles } = await supabase
      .from("profiles")
      .select("id, full_name")
      .in("id", Array.from(teacherIds))
      .returns<{ id: string; full_name: string | null }[]>();
    for (const p of profiles ?? []) {
      nameMap[p.id] = p.full_name ?? t("معلم", "Teacher");
    }
  }

  const events: TimelineEvent[] = [];
  for (const b of bookingsRes.data ?? []) {
    events.push({
      kind: "session",
      at: b.scheduled_at,
      teacherName: nameMap[b.teacher_id] ?? t("معلم", "Teacher"),
      sessionType: b.session_type,
      durationMin: b.duration_min,
      href: `/student/sessions`,
    });
  }
  for (const e of evalsRes.data ?? []) {
    events.push({
      kind: "evaluation",
      at: e.created_at,
      overall: e.overall_score,
      next_goals: e.next_goals,
      evalType: e.evaluation_type,
      href: `/student/progress`,
    });
  }
  for (const h of hwRes.data ?? []) {
    events.push({
      kind: "homework_graded",
      at: h.completed_at ?? h.teacher_id, // completed_at can theoretically be null here despite the filter; harmless fallback
      title: h.title,
      grade: h.status,
      teacherNotes: h.teacher_notes,
      teacherName: nameMap[h.teacher_id] ?? t("معلم", "Teacher"),
      href: `/student/follow-up`,
    });
  }
  for (const p of parentRes.data ?? []) {
    events.push({
      kind: "parent_report",
      at: p.sent_at ?? p.created_at,
      reportType: p.report_type,
      href: `/student/progress`,
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
      teacherName: nameMap[p.teacher_id] ?? t("معلم", "Teacher"),
    });
  }

  events.sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime());

  // Bucket by day so the rendered list reads like a journal entry.
  const byDay = new Map<string, TimelineEvent[]>();
  for (const e of events) {
    const dayKey = new Date(e.at).toLocaleDateString("en-CA"); // YYYY-MM-DD
    const arr = byDay.get(dayKey) ?? [];
    arr.push(e);
    byDay.set(dayKey, arr);
  }
  const days = Array.from(byDay.keys());

  return (
    <div dir={dir} className="mx-auto max-w-3xl px-4 py-8">
      <div className="mb-6 flex items-center gap-3">
        <ScrollText size={24} className="text-gold" aria-hidden="true" />
        <div>
          <h1 className="text-xl font-bold">{t("خط زمني", "Timeline")}</h1>
          <p className="mt-0.5 text-xs text-muted">
            {t(
              "كل ما حدث في رحلتك آخر ٩٠ يوماً — في مكان واحد.",
              "Everything that happened in your journey over the last 90 days — in one place.",
            )}
          </p>
        </div>
      </div>

      {events.length === 0 ? (
        <EmptyState
          variant="glass-card"
          icon={<ScrollText size={40} className="text-muted/40" aria-hidden="true" />}
          message={t("لم يحدث شيء بعد", "Nothing has happened yet")}
          hint={t(
            "بعد جلستك الأولى تظهر هنا الجلسات والتقييمات والمتابعات وتقارير الأهل.",
            "After your first session, this page will show sessions, evaluations, follow-ups, and parent reports.",
          )}
          action={
            <Link
              href="/student/teachers"
              className="inline-flex items-center gap-1 text-sm text-gold hover:text-gold-hover focus-ring rounded"
            >
              {t("احجز جلستك الأولى", "Book your first session")}
              <ChevronRight size={14} aria-hidden="true" />
            </Link>
          }
        />
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
                    <TimelineEntry key={`${day}-${idx}`} event={e} t={t} lang={lang === "ar" ? "ar" : "en"} locale={locale} />
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
  let href: string | undefined;
  switch (event.kind) {
    case "session": {
      const typeLabel = lang === "ar"
        ? (SESSION_TYPE_AR as Record<string, string>)[event.sessionType] ?? event.sessionType
        : event.sessionType;
      body = (
        <>
          <p className="text-sm font-medium">
            {t(`جلسة ${typeLabel} مع ${event.teacherName}`, `${typeLabel} session with ${event.teacherName}`)}
          </p>
          {event.durationMin && (
            <p className="text-xs text-muted">{event.durationMin} {t("دقيقة", "min")}</p>
          )}
        </>
      );
      href = event.href;
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
          {event.next_goals && (
            <p className="mt-1 text-xs text-foreground/80 line-clamp-2">{event.next_goals}</p>
          )}
        </>
      );
      href = event.href;
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
            {t(`متابعة: ${event.title} — ${g.ar}`, `Follow-up: ${event.title} — ${g.en}`)}
          </p>
          <p className="text-xs text-muted">{event.teacherName}</p>
          {event.teacherNotes && (
            <p className="mt-1 text-xs text-gold/80 line-clamp-2">💬 {event.teacherNotes}</p>
          )}
        </>
      );
      href = event.href;
      break;
    }
    case "parent_report":
      body = (
        <>
          <p className="text-sm font-medium">
            {t("تقرير لوالدك", "Parent report")}
            {event.reportType && (
              <span className="ms-1 text-xs text-muted">({event.reportType})</span>
            )}
          </p>
          <p className="text-xs text-muted">
            {t("اقرأه في صفحة تقدمي", "Read it on My Progress")}
          </p>
        </>
      );
      href = event.href;
      break;
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
        <>
          <p className="text-sm font-medium">
            {t(`${tl.ar}: سورة ${surah}${ayahPart}`, `${tl.en}: Surah ${surah}${ayahPart}`)}
          </p>
          <p className="text-xs text-muted">{event.teacherName}</p>
        </>
      );
      break;
    }
  }

  const inner = (
    <div className="flex items-start gap-3">
      <div className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full ${meta.barColor}`}>
        <Icon size={14} className={meta.tint} aria-hidden="true" />
      </div>
      <div className="min-w-0 flex-1">
        {body}
        <p className="mt-1 text-[10px] tabular-nums text-muted-light">{time}</p>
      </div>
      {href && <ChevronRight size={14} className="mt-2 shrink-0 text-muted-light" aria-hidden="true" />}
    </div>
  );

  if (href) {
    return (
      <li>
        <Link
          href={href}
          className="block rounded-xl border border-card-border bg-card p-3 transition-colors hover:border-card-border/60 hover:bg-card/80 focus-ring"
        >
          {inner}
        </Link>
      </li>
    );
  }
  return (
    <li className="rounded-xl border border-card-border bg-card p-3">
      {inner}
    </li>
  );
}
