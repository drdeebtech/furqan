"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import {
  ArrowLeft, ArrowRight, AlertTriangle, ClipboardCheck, Radio, Users, X, XCircle,
} from "lucide-react";
import { useLang } from "@/lib/i18n/context";

interface AdminNextActionData {
  pendingCount: number;
  activeSessionCount: number;
  newStudentCount: number;
  pendingPreview: { id: string; studentName: string | null; teacherName: string | null; scheduledAt: string }[];
}

const DISMISS_KEY = "furqan-admin-banner-dismissed-key";

/**
 * Admin operator banner. Priority cascade is signal-driven (not narrative).
 *   1. Active sessions live → monitor
 *   2. Pending bookings backlog → review
 *   3. New signups this week → welcome (calm)
 *   4. Fallback — open control tower
 */
export function AdminNextActionBanner({ data }: { data: AdminNextActionData }) {
  const { t, dir } = useLang();
  const Arrow = dir === "rtl" ? ArrowLeft : ArrowRight;
  const [dismissedKey, setDismissedKey] = useState<string | null>(() => {
    if (typeof window === "undefined") return null;
    try { return window.localStorage.getItem(DISMISS_KEY); } catch { return null; }
  });

  // Tick to keep the imminent-flag fresh.
  const [, setTick] = useState(0);
  useEffect(() => {
    const id = window.setInterval(() => setTick(t => t + 1), 60_000);
    return () => window.clearInterval(id);
  }, []);

  const state = ((): AdminBannerState => {
    if (data.activeSessionCount > 0) {
      return { kind: "active-sessions", key: `live:${data.activeSessionCount}`, count: data.activeSessionCount };
    }
    if (data.pendingCount >= 5) {
      return { kind: "pending-backlog", key: `pending:${data.pendingCount}`, count: data.pendingCount };
    }
    if (data.pendingCount > 0) {
      return { kind: "pending-bookings", key: `pending:${data.pendingCount}`, count: data.pendingCount, preview: data.pendingPreview };
    }
    if (data.newStudentCount > 0) {
      return { kind: "new-students", key: `new:${data.newStudentCount}`, count: data.newStudentCount };
    }
    return { kind: "fallback", key: "fallback" };
  })();

  if (dismissedKey === state.key) return null;

  const dismiss = () => {
    localStorage.setItem(DISMISS_KEY, state.key);
    setDismissedKey(state.key);
  };

  switch (state.kind) {
    case "active-sessions":
      return (
        <Banner tone="primary" onDismiss={dismiss}>
          <Icon><Radio size={20} className="animate-pulse" aria-hidden="true" /></Icon>
          <Copy
            eyebrow={t("جلسات نشطة الآن", "Live now")}
            eyebrowTone="primary"
            title={t(
              `${state.count} جلسة جارية في هذه اللحظة`,
              `${state.count} session${state.count === 1 ? "" : "s"} live this moment`,
            )}
          />
          <Primary href="/admin/sessions/live" label={t("راقب الجلسات", "Monitor live")} arrow={<Arrow size={14} aria-hidden="true" />} />
        </Banner>
      );
    case "pending-backlog":
      return (
        <Banner tone="warning" onDismiss={dismiss}>
          <Icon tone="warning"><AlertTriangle size={20} aria-hidden="true" /></Icon>
          <Copy
            eyebrow={t("تراكم الحجوزات", "Booking backlog")}
            eyebrowTone="warning"
            title={t(
              `${state.count} حجز معلق — قد يتأخر المعلمون عن الرد`,
              `${state.count} pending bookings — teachers may need a nudge`,
            )}
          />
          <Primary href="/admin/bookings?status=pending" label={t("راجع الحجوزات", "Review backlog")} arrow={<Arrow size={14} aria-hidden="true" />} />
        </Banner>
      );
    case "pending-bookings": {
      const preview = state.preview.slice(0, 2).map(p =>
        `${p.studentName ?? t("طالب", "Student")} ↔ ${p.teacherName ?? t("معلم", "Teacher")}`
      ).join(" · ");
      return (
        <Banner tone="warning" onDismiss={dismiss}>
          <Icon tone="warning"><ClipboardCheck size={20} aria-hidden="true" /></Icon>
          <Copy
            eyebrow={t("بانتظار التأكيد", "Awaiting confirmation")}
            eyebrowTone="warning"
            title={preview ? `${state.count} · ${preview}` : t(`${state.count} حجز معلق`, `${state.count} pending`)}
          />
          <Primary href="/admin/bookings?status=pending" label={t("افتح الحجوزات", "Open bookings")} arrow={<Arrow size={14} aria-hidden="true" />} />
        </Banner>
      );
    }
    case "new-students":
      return (
        <Banner tone="calm" onDismiss={dismiss}>
          <Icon><Users size={20} aria-hidden="true" /></Icon>
          <Copy
            eyebrow={t("هذا الأسبوع", "This week")}
            eyebrowTone="calm"
            title={t(
              `${state.count} طالب جديد التحق بالمنصة`,
              `${state.count} new student${state.count === 1 ? "" : "s"} joined`,
            )}
          />
          <Secondary href="/admin/users?role=student&recent=1" label={t("اعرض المسجلين", "View signups")} arrow={<Arrow size={14} aria-hidden="true" />} />
        </Banner>
      );
    case "fallback":
      return (
        <Banner tone="calm" onDismiss={dismiss}>
          <Icon><XCircle size={20} aria-hidden="true" /></Icon>
          <Copy
            eyebrow={t("هادئ", "All quiet")}
            eyebrowTone="calm"
            title={t("لا تنبيهات. وقت ممتاز لمراجعة المؤشرات أو إطلاق إعلان.", "No alerts. Good time to review metrics or push an announcement.")}
          />
          <Secondary href="/admin/control-tower" label={t("مركز التحكم", "Control Tower")} arrow={<Arrow size={14} aria-hidden="true" />} />
        </Banner>
      );
  }
}

// ─── State + render helpers ─────────────────────────────────────────────────

type AdminBannerState =
  | { kind: "active-sessions"; key: string; count: number }
  | { kind: "pending-backlog"; key: string; count: number }
  | { kind: "pending-bookings"; key: string; count: number; preview: AdminNextActionData["pendingPreview"] }
  | { kind: "new-students"; key: string; count: number }
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
  return <div className={`inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-xl ${wrap}`}>{children}</div>;
}

function Copy({ eyebrow, eyebrowTone, title }: { eyebrow: string; eyebrowTone: Tone; title: React.ReactNode }) {
  const tone = eyebrowTone === "primary" ? "text-gold/90" : eyebrowTone === "warning" ? "text-warning" : "text-muted";
  return (
    <div className="min-w-0 flex-1">
      <p className={`text-xs font-medium uppercase tracking-wider ${tone}`}>{eyebrow}</p>
      <p className="mt-0.5 truncate font-display text-base font-semibold text-foreground sm:text-lg">{title}</p>
    </div>
  );
}

function Primary({ href, label, arrow }: { href: string; label: string; arrow: React.ReactNode }) {
  return (
    <Link href={href} className="glass-gold glass-pill inline-flex items-center justify-center gap-2 px-5 py-2.5 text-sm font-semibold text-background hover:bg-gold-hover">
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
