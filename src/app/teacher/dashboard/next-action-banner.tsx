"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import {
  ArrowLeft, ArrowRight, BookOpen, Calendar, ClipboardCheck, FileWarning, MessageSquare, Play, Video, X,
} from "lucide-react";
import { useLang } from "@/lib/i18n/context";

interface TeacherNextActionData {
  cvStatus: "draft" | "pending_review" | "approved" | "rejected";
  imminentSession: { sessionId: string | null; bookingId: string; scheduledAt: string; studentName: string | null } | null;
  pendingBookings: number;
  ungradedHomework: number;
  unreadMessages: number;
  hasAvailability: boolean;
}

const DISMISS_KEY = "furqan-teacher-banner-dismissed-key";

/**
 * Teacher-side single-CTA banner. Priority:
 *   1. CV not approved → finish CV (blocks all other actions)
 *   2. No availability → set availability
 *   3. Imminent session (≤30 min) → Open session
 *   4. Pending bookings to confirm → Confirm
 *   5. Ungraded homework → Grade
 *   6. Unread messages → Open inbox
 *   7. Fallback — open today's plan
 *
 * Each state dismissible per-key with localStorage persistence.
 */
export function TeacherNextActionBanner({ data }: { data: TeacherNextActionData }) {
  const { t, dir, lang } = useLang();
  const Arrow = dir === "rtl" ? ArrowLeft : ArrowRight;
  const locale = lang === "ar" ? "ar" : "en-US";
  const [now, setNow] = useState(() => Date.now());
  const [dismissedKey, setDismissedKey] = useState<string | null>(() => {
    if (typeof window === "undefined") return null;
    try { return window.localStorage.getItem(DISMISS_KEY); } catch { return null; }
  });

  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 60_000);
    return () => window.clearInterval(id);
  }, []);

  const imminent = data.imminentSession;
  const minsUntilNext = imminent ? Math.floor((new Date(imminent.scheduledAt).getTime() - now) / 60_000) : null;
  const isImminent = minsUntilNext != null && minsUntilNext <= 30;

  const state = ((): TeacherBannerState => {
    if (data.cvStatus === "draft" || data.cvStatus === "rejected") {
      return { kind: "cv-incomplete", key: `cv:${data.cvStatus}`, status: data.cvStatus };
    }
    if (data.cvStatus === "pending_review") {
      return { kind: "cv-pending", key: "cv:pending" };
    }
    if (!data.hasAvailability) {
      return { kind: "set-availability", key: "no-availability" };
    }
    if (imminent && isImminent) {
      return { kind: "imminent-session", key: `session:${imminent.bookingId}`, mins: minsUntilNext, imminent };
    }
    if (data.pendingBookings > 0) {
      return { kind: "pending-bookings", key: `pending:${data.pendingBookings}`, count: data.pendingBookings };
    }
    if (data.ungradedHomework > 0) {
      return { kind: "ungraded-homework", key: `grading:${data.ungradedHomework}`, count: data.ungradedHomework };
    }
    if (data.unreadMessages > 0) {
      return { kind: "unread-messages", key: `inbox:${data.unreadMessages}`, count: data.unreadMessages };
    }
    return { kind: "fallback", key: "fallback" };
  })();

  if (dismissedKey === state.key) return null;

  const dismiss = () => {
    localStorage.setItem(DISMISS_KEY, state.key);
    setDismissedKey(state.key);
  };

  switch (state.kind) {
    case "cv-incomplete":
      return (
        <Banner tone="warning" onDismiss={state.status === "draft" ? undefined : dismiss}>
          <Icon tone="warning"><FileWarning size={20} aria-hidden="true" /></Icon>
          <Copy
            eyebrow={t("الخطوة الأولى", "First step")}
            eyebrowTone="warning"
            title={state.status === "rejected"
              ? t("سيرتك بحاجة لتعديل قبل قبول الطلاب", "Your CV needs revision before accepting students")
              : t("أكمل سيرتك الذاتية لبدء استقبال الطلاب", "Finish your CV to start accepting students")}
          />
          <Primary href="/teacher/cv" label={t("افتح السيرة", "Open CV")} arrow={<Arrow size={14} aria-hidden="true" />} />
        </Banner>
      );
    case "cv-pending":
      return (
        <Banner tone="calm" onDismiss={dismiss}>
          <Icon><FileWarning size={20} aria-hidden="true" /></Icon>
          <Copy
            eyebrow={t("قيد المراجعة", "Under review")}
            eyebrowTone="calm"
            title={t("سيرتك في انتظار المراجعة من الإدارة", "Your CV is awaiting moderator review")}
          />
          <Secondary href="/teacher/cv" label={t("اعرض السيرة", "View CV")} arrow={<Arrow size={14} aria-hidden="true" />} />
        </Banner>
      );
    case "set-availability":
      return (
        <Banner tone="primary" onDismiss={dismiss}>
          <Icon><Calendar size={20} aria-hidden="true" /></Icon>
          <Copy
            eyebrow={t("الخطوة التالية", "Next step")}
            eyebrowTone="primary"
            title={t("حدد ساعات تدريسك ليتمكن الطلاب من الحجز", "Set your teaching hours so students can book")}
          />
          <Primary href="/teacher/availability" label={t("افتح المواعيد", "Set hours")} arrow={<Arrow size={14} aria-hidden="true" />} />
        </Banner>
      );
    case "imminent-session": {
      const minsLabel = state.mins <= 0 ? t("الآن", "Now") : t(`خلال ${state.mins} د`, `In ${state.mins} min`);
      const date = new Date(state.imminent.scheduledAt).toLocaleTimeString(locale, { hour: "2-digit", minute: "2-digit" });
      const href = state.imminent.sessionId ? `/teacher/sessions/${state.imminent.sessionId}` : "/teacher/sessions";
      return (
        <Banner tone="primary" onDismiss={dismiss}>
          <Icon><Video size={20} aria-hidden="true" /></Icon>
          <Copy
            eyebrow={`${t("الجلسة القادمة", "Your next session")} · ${minsLabel} · ${date}`}
            eyebrowTone="primary"
            title={state.imminent.studentName
              ? t(`مع ${state.imminent.studentName}`, `with ${state.imminent.studentName}`)
              : t("جلسة فردية", "1-on-1 session")}
          />
          <Primary href={href} icon={<Play size={14} aria-hidden="true" />} label={t("افتح الجلسة", "Open session")} arrow={<Arrow size={14} aria-hidden="true" />} />
        </Banner>
      );
    }
    case "pending-bookings":
      return (
        <Banner tone="warning" onDismiss={dismiss}>
          <Icon tone="warning"><ClipboardCheck size={20} aria-hidden="true" /></Icon>
          <Copy
            eyebrow={t("بانتظارك", "Waiting on you")}
            eyebrowTone="warning"
            title={t(
              `${state.count} حجز يحتاج تأكيد منك`,
              `${state.count} booking${state.count > 1 ? "s" : ""} need${state.count > 1 ? "" : "s"} your confirmation`,
            )}
          />
          <Primary href="/teacher/dashboard#pending" label={t("راجع الحجوزات", "Review bookings")} arrow={<Arrow size={14} aria-hidden="true" />} />
        </Banner>
      );
    case "ungraded-homework":
      return (
        <Banner tone="warning" onDismiss={dismiss}>
          <Icon tone="warning"><BookOpen size={20} aria-hidden="true" /></Icon>
          <Copy
            eyebrow={t("تقييم بانتظارك", "Grading queue")}
            eyebrowTone="warning"
            title={t(
              `${state.count} واجب جاهز للتقييم`,
              `${state.count} assignment${state.count > 1 ? "s" : ""} ready to grade`,
            )}
          />
          <Primary href="/teacher/homework" label={t("ابدأ التقييم", "Start grading")} arrow={<Arrow size={14} aria-hidden="true" />} />
        </Banner>
      );
    case "unread-messages":
      return (
        <Banner tone="calm" onDismiss={dismiss}>
          <Icon><MessageSquare size={20} aria-hidden="true" /></Icon>
          <Copy
            eyebrow={t("رسائل جديدة", "New messages")}
            eyebrowTone="calm"
            title={t(
              `${state.count} رسالة غير مقروءة من طلابك`,
              `${state.count} unread message${state.count > 1 ? "s" : ""} from your students`,
            )}
          />
          <Secondary href="/teacher/messages" label={t("افتح الرسائل", "Open inbox")} arrow={<Arrow size={14} aria-hidden="true" />} />
        </Banner>
      );
    case "fallback":
      return (
        <Banner tone="calm" onDismiss={dismiss}>
          <Icon><Calendar size={20} aria-hidden="true" /></Icon>
          <Copy
            eyebrow={t("هادئ", "Quiet day")}
            eyebrowTone="calm"
            title={t("لا مهام عالقة. ربما حان وقت تحديث المواعيد أو إضافة درس مسجل.", "Inbox zero. Update availability or add a recorded lesson.")}
          />
          <Secondary href="/teacher/availability" label={t("المواعيد", "Availability")} arrow={<Arrow size={14} aria-hidden="true" />} />
        </Banner>
      );
  }
}

// ─── State + render helpers ─────────────────────────────────────────────────

type TeacherBannerState =
  | { kind: "cv-incomplete"; key: string; status: "draft" | "rejected" }
  | { kind: "cv-pending"; key: string }
  | { kind: "set-availability"; key: string }
  | { kind: "imminent-session"; key: string; mins: number; imminent: NonNullable<TeacherNextActionData["imminentSession"]> }
  | { kind: "pending-bookings"; key: string; count: number }
  | { kind: "ungraded-homework"; key: string; count: number }
  | { kind: "unread-messages"; key: string; count: number }
  | { kind: "fallback"; key: string };

type Tone = "primary" | "calm" | "warning";

function Banner({ tone, children, onDismiss }: { tone: Tone; children: React.ReactNode; onDismiss?: () => void }) {
  const { t } = useLang();
  const baseTone = tone === "primary"
    ? "border-gold/30 bg-gold/[0.04]"
    : tone === "warning"
      ? "border-warning/30 bg-warning/[0.05]"
      : "border-[var(--surface-border)] bg-surface/40";
  return (
    <div role="region" aria-label={t("الإجراء التالي", "Next action")} className={`relative flex flex-col items-stretch gap-3 rounded-2xl border ${baseTone} p-4 sm:flex-row sm:items-center sm:gap-4 sm:p-5`}>
      {children}
      {onDismiss && (
        <button
          type="button"
          onClick={onDismiss}
          aria-label={t("إخفاء", "Dismiss")}
          className="absolute end-2 top-2 inline-flex h-7 w-7 items-center justify-center rounded-lg text-muted-light transition-colors hover:bg-foreground/5 hover:text-foreground focus-ring"
        >
          <X size={14} aria-hidden="true" />
        </button>
      )}
    </div>
  );
}

function Icon({ children, tone = "primary" }: { children: React.ReactNode; tone?: Tone }) {
  const wrap = tone === "warning" ? "bg-warning/10 text-warning" : "bg-gold/10 text-gold";
  return (
    <div className={`inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-xl ${wrap}`}>
      {children}
    </div>
  );
}

function Copy({ eyebrow, eyebrowTone, title }: { eyebrow: string; eyebrowTone: Tone; title: React.ReactNode }) {
  const tone = eyebrowTone === "primary"
    ? "text-gold/90"
    : eyebrowTone === "warning"
      ? "text-warning"
      : "text-muted";
  return (
    <div className="min-w-0 flex-1">
      <p className={`text-xs font-medium uppercase tracking-wider ${tone}`}>{eyebrow}</p>
      <p className="mt-0.5 truncate font-display text-base font-semibold text-foreground sm:text-lg">{title}</p>
    </div>
  );
}

function Primary({ href, icon, label, arrow }: { href: string; icon?: React.ReactNode; label: string; arrow: React.ReactNode }) {
  return (
    <Link href={href} className="glass-gold glass-pill inline-flex items-center justify-center gap-2 px-5 py-2.5 text-sm font-semibold text-background hover:bg-gold-hover">
      {icon}
      <span>{label}</span>
      {arrow}
    </Link>
  );
}

function Secondary({ href, label, arrow }: { href: string; label: string; arrow: React.ReactNode }) {
  return (
    <Link href={href} className="glass glass-pill inline-flex items-center justify-center gap-2 px-5 py-2.5 text-sm font-medium text-gold hover:bg-gold/10">
      <span>{label}</span>
      {arrow}
    </Link>
  );
}
