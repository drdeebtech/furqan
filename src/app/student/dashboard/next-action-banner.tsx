"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { ArrowLeft, ArrowRight, BookOpen, CalendarPlus, Play, Video } from "lucide-react";
import { useLang } from "@/lib/i18n/context";

interface NextActionData {
  /** Most-imminent confirmed booking, if any. */
  nextBooking: { sessionId: string | null; bookingId: string; scheduledAt: string; teacherName: string | null } | null;
  /** First in-progress course lesson the student should resume, if any. */
  resumeLesson: { lessonId: string; title: string; href: string; progressPct: number } | null;
}

/**
 * Single-CTA banner that resolves to the highest-value next action for the
 * student. Priority order:
 *   1. Session is live or starts within 30 minutes — "Join now" (primary).
 *   2. Session is later today / tomorrow — "Open session details" (calm).
 *   3. There's an in-progress lesson — "Pick up where you left off".
 *   4. Fallback — "Book your next session".
 *
 * Refreshes on a 60s tick so the imminent threshold flips without a reload.
 */
export function NextActionBanner({ data }: { data: NextActionData }) {
  const { t, dir, lang } = useLang();
  const Arrow = dir === "rtl" ? ArrowLeft : ArrowRight;
  const locale = lang === "ar" ? "ar" : "en-US";
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 60_000);
    return () => window.clearInterval(id);
  }, []);

  const next = data.nextBooking;
  const minsUntilNext = next ? Math.floor((new Date(next.scheduledAt).getTime() - now) / 60_000) : null;

  // 1. Live or imminent session — primary, urgent.
  if (next && minsUntilNext != null && minsUntilNext <= 30) {
    const minsLabel = minsUntilNext <= 0
      ? t("الآن", "Now")
      : t(`خلال ${minsUntilNext} د`, `In ${minsUntilNext} min`);
    const href = next.sessionId ? `/student/sessions/${next.sessionId}` : "/student/sessions";
    return (
      <BannerShell tone="primary">
        <BannerIcon><Video size={20} aria-hidden="true" /></BannerIcon>
        <div className="min-w-0 flex-1">
          <p className="text-xs font-medium uppercase tracking-wider text-gold/90">
            {t("جلستك القادمة", "Your next session")} · {minsLabel}
          </p>
          <p className="mt-0.5 truncate font-display text-base font-semibold text-foreground sm:text-lg">
            {next.teacherName
              ? t(`مع ${next.teacherName}`, `with ${next.teacherName}`)
              : t("جلسة فردية", "1-on-1 session")}
          </p>
        </div>
        <Link href={href} className="glass-gold glass-pill inline-flex items-center gap-2 px-5 py-2.5 text-sm font-semibold text-background hover:bg-gold-hover">
          <Play size={14} aria-hidden="true" />
          {t("انضم الآن", "Join now")}
          <Arrow size={14} aria-hidden="true" />
        </Link>
      </BannerShell>
    );
  }

  // 2. Scheduled session, more than 30 min away.
  if (next) {
    const date = new Date(next.scheduledAt);
    const dayLabel = date.toLocaleDateString(locale, { weekday: "long", day: "numeric", month: "short" });
    const timeLabel = date.toLocaleTimeString(locale, { hour: "2-digit", minute: "2-digit" });
    const href = next.sessionId ? `/student/sessions/${next.sessionId}` : "/student/sessions";
    return (
      <BannerShell tone="calm">
        <BannerIcon><CalendarPlus size={20} aria-hidden="true" /></BannerIcon>
        <div className="min-w-0 flex-1">
          <p className="text-xs font-medium uppercase tracking-wider text-muted">
            {t("جلسة مجدولة", "Scheduled session")}
          </p>
          <p className="mt-0.5 truncate font-display text-base font-semibold text-foreground sm:text-lg">
            {dayLabel} · {timeLabel}
            {next.teacherName && (
              <span className="text-muted"> · {t(`مع ${next.teacherName}`, `with ${next.teacherName}`)}</span>
            )}
          </p>
        </div>
        <Link href={href} className="glass glass-pill inline-flex items-center gap-2 px-5 py-2.5 text-sm font-medium text-gold hover:bg-gold/10">
          {t("التفاصيل", "Open details")}
          <Arrow size={14} aria-hidden="true" />
        </Link>
      </BannerShell>
    );
  }

  // 3. Resume lesson.
  if (data.resumeLesson) {
    const r = data.resumeLesson;
    return (
      <BannerShell tone="calm">
        <BannerIcon><BookOpen size={20} aria-hidden="true" /></BannerIcon>
        <div className="min-w-0 flex-1">
          <p className="text-xs font-medium uppercase tracking-wider text-muted">
            {t("درس قيد المتابعة", "In-progress lesson")} · {r.progressPct}%
          </p>
          <p className="mt-0.5 truncate font-display text-base font-semibold text-foreground sm:text-lg">
            {r.title}
          </p>
        </div>
        <Link href={r.href} className="glass-gold glass-pill inline-flex items-center gap-2 px-5 py-2.5 text-sm font-semibold text-background hover:bg-gold-hover">
          <Play size={14} aria-hidden="true" />
          {t("أكمل", "Resume")}
          <Arrow size={14} aria-hidden="true" />
        </Link>
      </BannerShell>
    );
  }

  // 4. Fallback — book a session.
  return (
    <BannerShell tone="primary">
      <BannerIcon><CalendarPlus size={20} aria-hidden="true" /></BannerIcon>
      <div className="min-w-0 flex-1">
        <p className="text-xs font-medium uppercase tracking-wider text-gold/90">
          {t("ابدأ من جديد", "Get started")}
        </p>
        <p className="mt-0.5 font-display text-base font-semibold text-foreground sm:text-lg">
          {t("احجز جلستك القادمة", "Book your next session")}
        </p>
      </div>
      <Link href="/student/teachers" className="glass-gold glass-pill inline-flex items-center gap-2 px-5 py-2.5 text-sm font-semibold text-background hover:bg-gold-hover">
        {t("تصفح المعلمين", "Browse teachers")}
        <Arrow size={14} aria-hidden="true" />
      </Link>
    </BannerShell>
  );
}

function BannerShell({ tone, children }: { tone: "primary" | "calm"; children: React.ReactNode }) {
  const baseTone = tone === "primary"
    ? "border-gold/30 bg-gold/[0.04]"
    : "border-[var(--surface-border)] bg-surface/40";
  return (
    <div className={`flex flex-col items-stretch gap-3 rounded-2xl border ${baseTone} p-4 sm:flex-row sm:items-center sm:gap-4 sm:p-5`}>
      {children}
    </div>
  );
}

function BannerIcon({ children }: { children: React.ReactNode }) {
  return (
    <div className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-gold/10 text-gold">
      {children}
    </div>
  );
}
