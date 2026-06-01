"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import Link from "next/link";
import { AlertTriangle, BookOpen, Package, Timer, TrendingDown, Users, XCircle } from "lucide-react";
import { useLang } from "@/lib/i18n/context";
import { ActionFeedback } from "@/components/shared/action-feedback";
import type { ControlTowerSnapshot, WidgetKey, WidgetTier } from "@/app/admin/control-tower/data";
import {
  retryFailedAutomations,
  resolveOldestDeadLetters,
  forceEndStuckSessions,
} from "@/app/admin/control-tower/quick-actions";

type IconType = typeof Users;
type Widget = {
  key: WidgetKey;
  labelAr: string;
  labelEn: string;
  icon: IconType;
  tier: WidgetTier;
  href: string;
  threshold: number;
};

const WIDGETS: Widget[] = [
  { key: "pending-cvs", labelAr: "سير ذاتية بانتظار المراجعة", labelEn: "Pending CVs", icon: Users, tier: "warning", href: "/admin/teachers/cv", threshold: 0 },
  { key: "failed-auto", labelAr: "أتمتة فاشلة (24 ساعة)", labelEn: "Failed Automations (24h)", icon: XCircle, tier: "error", href: "/admin/automation", threshold: 0 },
  { key: "dead-letter", labelAr: "مهام فاشلة نهائياً", labelEn: "Dead-Letter Queue", icon: XCircle, tier: "error", href: "/admin/automation", threshold: 0 },
  { key: "stuck", labelAr: "جلسات متوقفة", labelEn: "Stuck Sessions (>15m)", icon: Timer, tier: "error", href: "/admin/sessions/live", threshold: 0 },
  { key: "no-show", labelAr: "غياب اليوم", labelEn: "No-Shows Today", icon: AlertTriangle, tier: "warning", href: "/admin/sessions", threshold: 0 },
  { key: "low-balance", labelAr: "باقات منخفضة الرصيد", labelEn: "Low Balance Packages", icon: Package, tier: "info", href: "/admin/credits", threshold: 0 },
  { key: "new-signups", labelAr: "مسجلون جدد (7 أيام)", labelEn: "New Signups (7d)", icon: Users, tier: "success", href: "/admin/users", threshold: -1 },
  { key: "at-risk", labelAr: "طلاب في خطر التسرب", labelEn: "At-Risk Students", icon: TrendingDown, tier: "error", href: "/admin/retention", threshold: 0 },
  { key: "grading", labelAr: "متابعات بانتظار التقييم", labelEn: "Pending Grading", icon: BookOpen, tier: "info", href: "/admin/notes", threshold: 0 },
  { key: "recitation", labelAr: "أخطاء تلاوة غير محلولة", labelEn: "Unresolved Errors", icon: AlertTriangle, tier: "warning", href: "/admin/sessions", threshold: 10 },
  { key: "failed-actions", labelAr: "إجراءات إدارية فاشلة (24 ساعة)", labelEn: "Failed Admin Actions (24h)", icon: XCircle, tier: "error", href: "/admin/audit", threshold: 0 },
];

const TIER_FG: Record<WidgetTier, string> = {
  warning: "text-warning",
  error: "text-error",
  info: "text-gold",
  success: "text-success",
};
const TIER_BG: Record<WidgetTier, string> = {
  warning: "bg-warning/10",
  error: "bg-error/10",
  info: "bg-gold/10",
  success: "bg-success/10",
};

const POLL_INTERVAL_MS = 30_000;

type ActionState = { ok: true; message?: string } | { ok: false; error: string } | null;

export function ControlTowerGrid({ initialData }: { initialData: ControlTowerSnapshot }) {
  const { t, lang } = useLang();
  const [snapshot, setSnapshot] = useState(initialData);
  // 0 until mount; the effect stamps the real mount time. Avoids calling the
  // impure Date.now() during render (react-hooks/purity, issue #325).
  const lastFetchRef = useRef(0);
  const [actionState, setActionState] = useState<ActionState>(null);
  const [pendingKey, setPendingKey] = useState<WidgetKey | null>(null);
  const [, startAction] = useTransition();

  // 30-second polling, paused while tab is hidden. We compare timestamps so a
  // visibility change can immediately catch up rather than waiting another
  // full interval.
  useEffect(() => {
    let cancelled = false;
    // Stamp mount time here rather than in render (purity rule).
    lastFetchRef.current = Date.now();

    async function refresh() {
      try {
        const res = await fetch("/api/admin/control-tower/snapshot", { cache: "no-store" });
        if (!res.ok) return;
        const fresh = (await res.json()) as ControlTowerSnapshot;
        if (!cancelled) {
          setSnapshot(fresh);
          lastFetchRef.current = Date.now();
        }
      } catch {
        // network blip — silent; next tick will retry
      }
    }

    const id = setInterval(() => {
      if (document.visibilityState === "visible") refresh();
    }, POLL_INTERVAL_MS);

    function onVisible() {
      if (document.visibilityState === "visible" && Date.now() - lastFetchRef.current > POLL_INTERVAL_MS) {
        refresh();
      }
    }
    document.addEventListener("visibilitychange", onVisible);

    return () => {
      cancelled = true;
      clearInterval(id);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, []);

  const alertCount = WIDGETS.filter((w) => w.threshold >= 0 && (snapshot.counts[w.key] ?? 0) > w.threshold).length;

  function runAction(key: WidgetKey, fn: () => Promise<{ ok: true; message?: string } | { ok: false; error: string }>) {
    setPendingKey(key);
    setActionState(null);
    startAction(async () => {
      const result = await fn();
      setActionState(result);
      setPendingKey(null);
      // Optimistically refetch so the count drops immediately rather than
      // waiting for the next 30s tick.
      try {
        const res = await fetch("/api/admin/control-tower/snapshot", { cache: "no-store" });
        if (res.ok) setSnapshot((await res.json()) as ControlTowerSnapshot);
      } catch { /* will catch up on next interval */ }
    });
  }

  return (
    <>
      <div className="mb-6 flex items-center justify-between gap-3">
        {alertCount > 0 ? (
          <span className="rounded-full bg-error/10 px-3 py-1 text-sm font-bold text-error">
            {lang === "ar" ? `${alertCount} تنبيهات` : `${alertCount} alerts`}
          </span>
        ) : (
          <span />
        )}
        <span className="text-xs text-muted">
          {t("آخر تحديث", "Updated")}: {new Date(snapshot.generatedAt).toLocaleTimeString(lang === "ar" ? "ar-EG" : "en-US")}
        </span>
      </div>

      <ActionFeedback state={actionState} />

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {WIDGETS.map((w) => {
          const value = snapshot.counts[w.key] ?? 0;
          const Icon = w.icon;
          const isAlert = w.threshold >= 0 && value > w.threshold;
          const label = lang === "ar" ? w.labelAr : w.labelEn;

          // Quick-action widgets get a button row under the count.
          const quickAction = QUICK_ACTIONS[w.key];

          return (
            <div
              key={w.key}
              className={`glass-card flex flex-col gap-3 p-5 transition-colors hover:border-gold/30 ${isAlert ? "border-error/30" : ""}`}
            >
              <Link href={w.href} className="flex items-center gap-4">
                <div className={`flex h-12 w-12 shrink-0 items-center justify-center rounded-xl ${TIER_BG[w.tier]}`}>
                  <Icon size={22} className={TIER_FG[w.tier]} aria-hidden="true" />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="font-display text-2xl font-bold tabular-nums">{value}</p>
                  <p className="text-xs text-muted">{label}</p>
                </div>
                {isAlert && <AlertTriangle size={14} className="text-error" aria-hidden="true" />}
              </Link>

              {quickAction && value > 0 && (
                <button
                  type="button"
                  disabled={pendingKey === w.key}
                  onClick={() => runAction(w.key, quickAction.run)}
                  className="rounded-lg border border-[var(--surface-border)] py-1.5 text-xs font-medium text-foreground transition-colors hover:bg-foreground/5 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {pendingKey === w.key
                    ? t("جارٍ التنفيذ...", "Working...")
                    : t(quickAction.labelAr, quickAction.labelEn)}
                </button>
              )}
            </div>
          );
        })}
      </div>

      <div className="mt-6 grid gap-4 sm:grid-cols-2">
        <Link href="/admin/automation" className="glass-card p-4 text-center transition-colors hover:border-gold/20">
          <p className="text-sm font-medium">{t("سجل الأتمتة", "Automation Logs")}</p>
        </Link>
        <Link href="/admin/audit" className="glass-card p-4 text-center transition-colors hover:border-gold/20">
          <p className="text-sm font-medium">{t("سجل المراجعة", "Audit Log")}</p>
        </Link>
      </div>
    </>
  );
}

const QUICK_ACTIONS: Partial<Record<WidgetKey, { labelAr: string; labelEn: string; run: () => Promise<{ ok: true; message?: string } | { ok: false; error: string }> }>> = {
  "failed-auto": {
    labelAr: "إعادة محاولة الكل",
    labelEn: "Retry all",
    run: () => retryFailedAutomations(),
  },
  "dead-letter": {
    labelAr: "حلّ أقدم 10",
    labelEn: "Resolve oldest 10",
    run: () => resolveOldestDeadLetters(),
  },
  stuck: {
    labelAr: "إنهاء الجلسات >30 دقيقة",
    labelEn: "Force-end >30m",
    run: () => forceEndStuckSessions(),
  },
};
