"use client";

import Link from "next/link";
import { startTransition, useEffect, useState } from "react";
import {
  ArrowLeft, ArrowRight, BookOpen, CalendarPlus, ClipboardCheck, Play, Video, X,
} from "lucide-react";
import { useLang } from "@/lib/i18n/context";
import { useNowTicker } from "@/lib/hooks/use-now-ticker";

interface NextActionData {
  /** Most-imminent confirmed booking, if any. */
  nextBooking: { sessionId: string | null; bookingId: string; scheduledAt: string; teacherName: string | null } | null;
  /** First in-progress course lesson the student should resume, if any. */
  resumeLesson: { lessonId: string; title: string; href: string; progressPct: number } | null;
  /** Follow-up signal (overdue + due-today + next item). */
  homework: { overdue: number; dueToday: number; dueThisWeek: number; nextItem: { id: string; description: string | null; dueDate: string | null; type: string } | null };
  /** Upcoming quiz, if any. */
  nextQuiz: { id: string; title: string; due_at: string | null } | null;
}

const DISMISS_KEY = "furqan-student-banner-dismissed-key";

/**
 * Single primary CTA banner. Resolves the most-actionable surface for the
 * student in priority order:
 *   1. Live or imminent session (≤30 min) — Join now (urgent)
 *   2. Overdue follow-up — Submit overdue (warning)
 *   3. Quiz due today — Take quiz now (urgent)
 *   4. Scheduled session later — Open details (calm)
 *   5. Follow-up due today — Submit today's work (warning)
 *   6. Resume in-progress lesson — Resume (calm)
 *   7. Quiz this week — Take quiz (calm)
 *   8. Fallback — Browse teachers
 *
 * The banner is dismissible per-state-key (e.g. dismissing the "Resume lesson"
 * state stays dismissed for that lesson, but a new "Imminent session" state
 * renders fresh). Refreshes on a 60s tick so urgency thresholds flip.
 */
export function NextActionBanner({ data, renderedAtMs }: { data: NextActionData; renderedAtMs: number }) {
  const { t, dir, lang } = useLang();
  const Arrow = dir === "rtl" ? ArrowLeft : ArrowRight;
  const locale = lang === "ar" ? "ar" : "en-US";
  const now = useNowTicker(60_000, renderedAtMs).getTime();
  const [dismissedKey, setDismissedKey] = useState<string | null>(null);

  useEffect(() => {
    try {
      const stored = window.localStorage.getItem(DISMISS_KEY);
      if (stored !== null) {
        startTransition(() => setDismissedKey(stored));
      }
    } catch {
      startTransition(() => setDismissedKey(null));
    }
  }, []);

  const next = data.nextBooking;
  const minsUntilNext = next ? Math.floor((new Date(next.scheduledAt).getTime() - now) / 60_000) : null;
  const hw = data.homework;
  const quiz = data.nextQuiz;
  const quizDate = quiz?.due_at ? new Date(quiz.due_at) : null;
  const quizDaysLeft = quizDate ? Math.ceil((quizDate.getTime() - now) / 86_400_000) : null;

  // Resolve the active state. Priority cascade — first match wins.
  const state = ((): BannerState => {
    if (next && minsUntilNext != null && minsUntilNext <= 30) {
      return { kind: "imminent-session", key: `session:${next.bookingId}`, mins: minsUntilNext, next };
    }
    if (hw.overdue > 0) {
      return { kind: "overdue-homework", key: `hw-overdue:${hw.overdue}`, count: hw.overdue };
    }
    if (quiz && quizDaysLeft != null && quizDaysLeft <= 0) {
      return { kind: "quiz-today", key: `quiz-today:${quiz.id}`, quiz };
    }
    if (next) {
      return { kind: "scheduled-session", key: `session:${next.bookingId}`, next };
    }
    if (hw.dueToday > 0) {
      return { kind: "due-today-homework", key: `hw-today:${hw.dueToday}`, count: hw.dueToday };
    }
    if (data.resumeLesson) {
      return { kind: "resume-lesson", key: `lesson:${data.resumeLesson.lessonId}`, lesson: data.resumeLesson };
    }
    if (quiz && quizDaysLeft != null && quizDaysLeft <= 7) {
      return { kind: "quiz-soon", key: `quiz:${quiz.id}`, quiz, daysLeft: quizDaysLeft };
    }
    if (hw.dueThisWeek > 0) {
      return { kind: "homework-this-week", key: `hw-week:${hw.dueThisWeek}`, count: hw.dueThisWeek };
    }
    return { kind: "fallback", key: "fallback" };
  })();

  if (dismissedKey === state.key) return null;

  const dismiss = () => {
    localStorage.setItem(DISMISS_KEY, state.key);
    setDismissedKey(state.key);
  };

  // Build the rendered shell from state.
  switch (state.kind) {
    case "imminent-session": {
      const minsLabel = state.mins <= 0
        ? t("الآن", "Now")
        : t(`خلال ${state.mins} د`, `In ${state.mins} min`);
      const href = state.next.sessionId ? `/student/sessions/${state.next.sessionId}` : "/student/sessions";
      return (
        <BannerShell tone="primary" onDismiss={dismiss} dismissLabel={t("إخفاء", "Dismiss")}>
          <BannerIcon><Video size={20} aria-hidden="true" /></BannerIcon>
          <BannerCopy
            eyebrow={`${t("جلستك القادمة", "Your next session")} · ${minsLabel}`}
            eyebrowTone="primary"
            title={state.next.teacherName
              ? t(`مع ${state.next.teacherName}`, `with ${state.next.teacherName}`)
              : t("جلسة فردية", "1-on-1 session")}
          />
          <PrimaryAction href={href} icon={<Play size={14} aria-hidden="true" />} label={t("انضم الآن", "Join now")} arrow={<Arrow size={14} aria-hidden="true" />} />
        </BannerShell>
      );
    }
    case "overdue-homework":
      return (
        <BannerShell tone="warning" onDismiss={dismiss} dismissLabel={t("إخفاء", "Dismiss")}>
          <BannerIcon tone="warning"><BookOpen size={20} aria-hidden="true" /></BannerIcon>
          <BannerCopy
            eyebrow={t("تنبيه", "Heads up")}
            eyebrowTone="warning"
            title={t(
              `${state.count} متابعة متأخرة${state.count > 1 ? "" : ""} — راجعها قبل الجلسة القادمة`,
              `${state.count} overdue follow-up${state.count > 1 ? "s" : ""} — close them out before your next session`,
            )}
          />
          <PrimaryAction href="/student/follow-up" label={t("افتح المتابعة", "Open follow-up")} arrow={<Arrow size={14} aria-hidden="true" />} />
        </BannerShell>
      );
    case "quiz-today":
      return (
        <BannerShell tone="primary" onDismiss={dismiss} dismissLabel={t("إخفاء", "Dismiss")}>
          <BannerIcon><ClipboardCheck size={20} aria-hidden="true" /></BannerIcon>
          <BannerCopy
            eyebrow={t("اختبار اليوم", "Quiz due today")}
            eyebrowTone="primary"
            title={state.quiz.title}
          />
          <PrimaryAction href={`/student/quizzes/${state.quiz.id}/take`} icon={<Play size={14} aria-hidden="true" />} label={t("ابدأ الاختبار", "Start quiz")} arrow={<Arrow size={14} aria-hidden="true" />} />
        </BannerShell>
      );
    case "scheduled-session": {
      const date = new Date(state.next.scheduledAt);
      const dayLabel = date.toLocaleDateString(locale, { weekday: "long", day: "numeric", month: "short" });
      const timeLabel = date.toLocaleTimeString(locale, { hour: "2-digit", minute: "2-digit" });
      const href = state.next.sessionId ? `/student/sessions/${state.next.sessionId}` : "/student/sessions";
      return (
        <BannerShell tone="calm" onDismiss={dismiss} dismissLabel={t("إخفاء", "Dismiss")}>
          <BannerIcon><CalendarPlus size={20} aria-hidden="true" /></BannerIcon>
          <BannerCopy
            eyebrow={t("جلسة مجدولة", "Scheduled session")}
            eyebrowTone="calm"
            title={(
              <span suppressHydrationWarning>
                {dayLabel} · {timeLabel}
                {state.next.teacherName && (
                  <span className="text-muted"> · {t(`مع ${state.next.teacherName}`, `with ${state.next.teacherName}`)}</span>
                )}
              </span>
            )}
          />
          <SecondaryAction href={href} label={t("التفاصيل", "Open details")} arrow={<Arrow size={14} aria-hidden="true" />} />
        </BannerShell>
      );
    }
    case "due-today-homework":
      return (
        <BannerShell tone="warning" onDismiss={dismiss} dismissLabel={t("إخفاء", "Dismiss")}>
          <BannerIcon tone="warning"><BookOpen size={20} aria-hidden="true" /></BannerIcon>
          <BannerCopy
            eyebrow={t("اليوم", "Today")}
            eyebrowTone="warning"
            title={t(
              `${state.count} متابعة يحتاج تسليم اليوم`,
              `${state.count} assignment${state.count > 1 ? "s" : ""} due today`,
            )}
          />
          <PrimaryAction href="/student/follow-up" label={t("ابدأ الآن", "Start now")} arrow={<Arrow size={14} aria-hidden="true" />} />
        </BannerShell>
      );
    case "resume-lesson":
      return (
        <BannerShell tone="calm" onDismiss={dismiss} dismissLabel={t("إخفاء", "Dismiss")}>
          <BannerIcon><BookOpen size={20} aria-hidden="true" /></BannerIcon>
          <BannerCopy
            eyebrow={`${t("درس قيد المتابعة", "In-progress lesson")} · ${state.lesson.progressPct}%`}
            eyebrowTone="calm"
            title={state.lesson.title}
          />
          <PrimaryAction href={state.lesson.href} icon={<Play size={14} aria-hidden="true" />} label={t("أكمل", "Resume")} arrow={<Arrow size={14} aria-hidden="true" />} />
        </BannerShell>
      );
    case "quiz-soon":
      return (
        <BannerShell tone="calm" onDismiss={dismiss} dismissLabel={t("إخفاء", "Dismiss")}>
          <BannerIcon><ClipboardCheck size={20} aria-hidden="true" /></BannerIcon>
          <BannerCopy
            eyebrow={t(
              `اختبار خلال ${state.daysLeft} ${state.daysLeft === 1 ? "يوم" : "أيام"}`,
              `Quiz in ${state.daysLeft} day${state.daysLeft === 1 ? "" : "s"}`,
            )}
            eyebrowTone="calm"
            title={state.quiz.title}
          />
          <SecondaryAction href={`/student/quizzes/${state.quiz.id}/take`} label={t("استعرض", "Preview")} arrow={<Arrow size={14} aria-hidden="true" />} />
        </BannerShell>
      );
    case "homework-this-week":
      return (
        <BannerShell tone="calm" onDismiss={dismiss} dismissLabel={t("إخفاء", "Dismiss")}>
          <BannerIcon><BookOpen size={20} aria-hidden="true" /></BannerIcon>
          <BannerCopy
            eyebrow={t("هذا الأسبوع", "This week")}
            eyebrowTone="calm"
            title={t(
              `${state.count} متابعة قادمة خلال 7 أيام`,
              `${state.count} follow-up${state.count > 1 ? "s" : ""} due this week`,
            )}
          />
          <SecondaryAction href="/student/follow-up" label={t("افتح المتابعة", "Open follow-up")} arrow={<Arrow size={14} aria-hidden="true" />} />
        </BannerShell>
      );
    case "fallback":
      return (
        <BannerShell tone="primary" onDismiss={dismiss} dismissLabel={t("إخفاء", "Dismiss")}>
          <BannerIcon><CalendarPlus size={20} aria-hidden="true" /></BannerIcon>
          <BannerCopy
            eyebrow={t("ابدأ من جديد", "Get started")}
            eyebrowTone="primary"
            title={t("احجز جلستك القادمة", "Book your next session")}
          />
          <PrimaryAction href="/student/teachers" label={t("تصفح المعلمين", "Browse teachers")} arrow={<Arrow size={14} aria-hidden="true" />} />
        </BannerShell>
      );
  }
}

// ─── State + render helpers ─────────────────────────────────────────────────

type BannerState =
  | { kind: "imminent-session"; key: string; mins: number; next: NonNullable<NextActionData["nextBooking"]> }
  | { kind: "overdue-homework"; key: string; count: number }
  | { kind: "quiz-today"; key: string; quiz: NonNullable<NextActionData["nextQuiz"]> }
  | { kind: "scheduled-session"; key: string; next: NonNullable<NextActionData["nextBooking"]> }
  | { kind: "due-today-homework"; key: string; count: number }
  | { kind: "resume-lesson"; key: string; lesson: NonNullable<NextActionData["resumeLesson"]> }
  | { kind: "quiz-soon"; key: string; quiz: NonNullable<NextActionData["nextQuiz"]>; daysLeft: number }
  | { kind: "homework-this-week"; key: string; count: number }
  | { kind: "fallback"; key: string };

type Tone = "primary" | "calm" | "warning";

function BannerShell({ tone, children, onDismiss, dismissLabel }: { tone: Tone; children: React.ReactNode; onDismiss?: () => void; dismissLabel: string }) {
  const baseTone = tone === "primary"
    ? "border-gold/30 bg-gold/[0.04]"
    : tone === "warning"
      ? "border-warning/30 bg-warning/[0.05]"
      : "border-[var(--surface-border)] bg-surface/40";
  return (
    <div
      role="region"
      aria-label="Next action"
      className={`relative flex flex-col items-stretch gap-3 rounded-2xl border ${baseTone} p-4 animate-fade-up motion-reduce:animate-none sm:flex-row sm:items-center sm:gap-4 sm:p-5`}
    >
      {children}
      {onDismiss && (
        <button
          type="button"
          onClick={onDismiss}
          aria-label={dismissLabel}
          className="absolute end-2 top-2 inline-flex h-7 w-7 items-center justify-center rounded-lg text-muted-light transition-colors hover:bg-foreground/5 hover:text-foreground focus-ring"
        >
          <X size={14} aria-hidden="true" />
        </button>
      )}
    </div>
  );
}

function BannerIcon({ children, tone = "primary" }: { children: React.ReactNode; tone?: Tone }) {
  const wrap = tone === "warning" ? "bg-warning/10 text-warning" : "bg-gold/10 text-gold";
  return (
    <div className={`inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-xl ${wrap}`}>
      {children}
    </div>
  );
}

function BannerCopy({ eyebrow, eyebrowTone, title }: { eyebrow: string; eyebrowTone: Tone; title: React.ReactNode }) {
  const tone = eyebrowTone === "primary"
    ? "text-gold/90"
    : eyebrowTone === "warning"
      ? "text-warning"
      : "text-muted";
  return (
    <div className="min-w-0 flex-1">
      <p className={`text-xs font-medium uppercase tracking-wider ${tone}`}>{eyebrow}</p>
      <p className="mt-0.5 truncate font-display text-base font-semibold text-foreground sm:text-lg">
        {title}
      </p>
    </div>
  );
}

function PrimaryAction({ href, icon, label, arrow }: { href: string; icon?: React.ReactNode; label: string; arrow: React.ReactNode }) {
  return (
    <Link href={href} className="glass-gold glass-pill inline-flex items-center justify-center gap-2 px-5 py-2.5 text-sm font-semibold text-background hover:bg-gold-hover">
      {icon}
      <span>{label}</span>
      {arrow}
    </Link>
  );
}

function SecondaryAction({ href, label, arrow }: { href: string; label: string; arrow: React.ReactNode }) {
  return (
    <Link href={href} className="glass glass-pill inline-flex items-center justify-center gap-2 px-5 py-2.5 text-sm font-medium text-gold hover:bg-gold/10">
      <span>{label}</span>
      {arrow}
    </Link>
  );
}
