"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import {
  ArrowLeft, ArrowRight, ClipboardList, Eye, FileCheck, FileText, Keyboard,
  RefreshCw, ShieldCheck, Star, Video, X,
} from "lucide-react";
import { useLang } from "@/lib/i18n/context";
import { useNowTicker } from "@/lib/hooks/use-now-ticker";
import { useToast } from "@/components/shared/toast";
import { StatCard } from "@/components/shared/stat-card";
import { WidgetCard } from "@/components/shared/widget-card";
import { AnalyticsChart } from "@/components/shared/analytics-chart";
import { LiveSessionsWidget } from "@/components/shared/live-sessions-widget";
import { BreakdownBar } from "@/components/shared/breakdown-bar";
import { DataTable } from "@/components/shared/data-table";
import { ShortcutsHelp } from "@/components/shared/shortcuts-help";
import { SectionErrorBoundary } from "@/components/shared/section-error-boundary";
import { useKeyboardShortcuts, useShortcutsHelp, type Shortcut } from "@/lib/hooks/use-keyboard-shortcuts";

const DISMISS_KEY = "furqan-moderator-banner-dismissed-key";

interface ModeratorDashboardData {
  studentCount: number;
  teacherCount: number;
  pendingCvCount: number;
  activeSessionCount: number;
  evalCount: number;
  flaggedEvalCount: number;
  weeklyCVActivity: { day: string; value: number; isActive: boolean }[];
  liveSessions: { id: string; title: string; subtitle: string; initials: string; timeRemaining?: string; progressPercent?: number }[];
  ratingDistribution: { label: string; value: number; color: string }[];
  flaggedEvaluations: { id: string; [key: string]: unknown }[];
}

export function ModeratorDashboardContent({ data }: { data: ModeratorDashboardData }) {
  const { t, dir, lang } = useLang();
  const toast = useToast();
  const locale = lang === "ar" ? "ar" : "en-US";
  const Arrow = dir === "rtl" ? ArrowLeft : ArrowRight;
  const {
    pendingCvCount, activeSessionCount, evalCount, flaggedEvalCount,
    weeklyCVActivity, liveSessions, ratingDistribution, flaggedEvaluations,
  } = data;

  const now = useNowTicker();
  const weekday = now.toLocaleDateString(locale, { weekday: "long" });

  // Smart banner state — moderator priority cascade.
  type ModBannerState =
    | { kind: "pending-cvs"; key: string; count: number }
    | { kind: "flagged-evals"; key: string; count: number }
    | { kind: "active-sessions"; key: string; count: number }
    | { kind: "fallback"; key: string };

  const bannerState = ((): ModBannerState => {
    if (pendingCvCount > 0) return { kind: "pending-cvs", key: `cv:${pendingCvCount}`, count: pendingCvCount };
    if (flaggedEvalCount > 0) return { kind: "flagged-evals", key: `flagged:${flaggedEvalCount}`, count: flaggedEvalCount };
    if (activeSessionCount > 0) return { kind: "active-sessions", key: `live:${activeSessionCount}`, count: activeSessionCount };
    return { kind: "fallback", key: "fallback" };
  })();

  const [dismissedKey, setDismissedKey] = useState<string | null>(() => {
    if (typeof window === "undefined") return null;
    try { return window.localStorage.getItem(DISMISS_KEY); } catch { return null; }
  });
  const dismiss = () => {
    localStorage.setItem(DISMISS_KEY, bannerState.key);
    setDismissedKey(bannerState.key);
  };

  // Keyboard shortcuts.
  const [helpOpen, setHelpOpen] = useShortcutsHelp();
  const shortcuts: Shortcut[] = useMemo(() => [
    {
      combo: "j",
      description: { ar: "افتح الجلسات النشطة", en: "Open live sessions" },
      group: { ar: "إجراءات", en: "Actions" },
      onTrigger: () => {
        if (activeSessionCount > 0) window.location.assign("/moderator/sessions");
        else toast.info(t("لا جلسات نشطة الآن", "No live sessions"));
      },
    },
    {
      combo: "r",
      description: { ar: "افتح صف مراجعة السير", en: "Open CV review queue" },
      group: { ar: "إجراءات", en: "Actions" },
      onTrigger: () => window.location.assign("/moderator/cv-review"),
    },
    { combo: "g d", description: { ar: "اللوحة", en: "Dashboard" }, group: { ar: "تنقل", en: "Navigate" }, href: "/moderator/dashboard" },
    { combo: "g v", description: { ar: "مراجعة السير", en: "CV Review" }, group: { ar: "تنقل", en: "Navigate" }, href: "/moderator/cv-review" },
    { combo: "g s", description: { ar: "الجلسات", en: "Sessions" }, group: { ar: "تنقل", en: "Navigate" }, href: "/moderator/sessions" },
    { combo: "g e", description: { ar: "التقييمات", en: "Evaluations" }, group: { ar: "تنقل", en: "Navigate" }, href: "/moderator/evaluations" },
    { combo: "g u", description: { ar: "المستخدمون", en: "Users" }, group: { ar: "تنقل", en: "Navigate" }, href: "/moderator/users" },
    { combo: "g a", description: { ar: "سجل التدقيق", en: "Audit log" }, group: { ar: "تنقل", en: "Navigate" }, href: "/moderator/audit" },
    { combo: "g c", description: { ar: "مراجعة الدورات", en: "Course review" }, group: { ar: "تنقل", en: "Navigate" }, href: "/moderator/courses" },
    { combo: "?", description: { ar: "إظهار الاختصارات", en: "Show shortcuts" }, group: { ar: "مساعدة", en: "Help" }, onTrigger: () => setHelpOpen(true) },
  ], [activeSessionCount, toast, t, setHelpOpen]);
  useKeyboardShortcuts(shortcuts, true);

  const [lastRefreshAt] = useState(() => new Date());
  const lastRefreshLabel = lastRefreshAt.toLocaleTimeString(locale, { hour: "2-digit", minute: "2-digit" });
  const refresh = () => window.location.reload();

  return (
    <>
      <a
        href="#moderator-main"
        className="sr-only focus:not-sr-only focus:absolute focus:start-4 focus:top-4 focus:z-[200] focus:rounded focus:bg-gold focus:px-3 focus:py-2 focus:text-sm focus:font-medium focus:text-background"
      >
        {t("تخطي إلى المحتوى", "Skip to main content")}
      </a>

      <div className="h-0.5 bg-gradient-to-l from-gold/0 via-gold/30 to-gold/0" aria-hidden="true" />
      <div dir={dir} className="mx-auto max-w-7xl px-4 py-8 sm:px-6" id="moderator-main">
        <header className="mb-6">
          <h1 className="font-display text-2xl font-bold sm:text-3xl">
            {t("لوحة المشرف", "Moderator Dashboard")}
          </h1>
          <p className="mt-1 text-sm text-muted" aria-live="polite">
            {weekday}
            <span className="mx-2 text-muted-light" aria-hidden="true">·</span>
            <span>
              {pendingCvCount > 0
                ? t(`${pendingCvCount} سيرة بانتظارك`, `${pendingCvCount} CV${pendingCvCount === 1 ? "" : "s"} awaiting review`)
                : flaggedEvalCount > 0
                  ? t(`${flaggedEvalCount} تقييم منخفض هذا الأسبوع`, `${flaggedEvalCount} flagged eval${flaggedEvalCount === 1 ? "" : "s"} this week`)
                  : t("الجودة على ما يرام — حافظ على المستوى", "Quality looks healthy — keep watch")}
            </span>
          </p>
        </header>

        {/* Smart moderator banner. */}
        {dismissedKey !== bannerState.key && (
          <SectionErrorBoundary fallbackLabel={t("تعذّر تحميل الإجراء التالي", "Couldn't load next action")}>
            <section aria-label={t("الإجراء التالي", "Next action")} className="mb-6">
              {(() => {
                if (bannerState.kind === "pending-cvs") {
                  return (
                    <Banner tone="warning" onDismiss={dismiss}>
                      <Icon tone="warning"><FileCheck size={20} aria-hidden="true" /></Icon>
                      <Copy
                        eyebrow={t("صف المراجعة", "Review queue")}
                        eyebrowTone="warning"
                        title={t(
                          `${bannerState.count} سيرة ذاتية بانتظار المراجعة — معلمون لا يستطيعون التدريس بدونها`,
                          `${bannerState.count} CV${bannerState.count === 1 ? "" : "s"} pending — teachers can't onboard until reviewed`,
                        )}
                      />
                      <Primary href="/moderator/cv-review" label={t("ابدأ المراجعة", "Start review")} arrow={<Arrow size={14} aria-hidden="true" />} />
                    </Banner>
                  );
                }
                if (bannerState.kind === "flagged-evals") {
                  return (
                    <Banner tone="warning" onDismiss={dismiss}>
                      <Icon tone="warning"><Star size={20} aria-hidden="true" /></Icon>
                      <Copy
                        eyebrow={t("جودة منخفضة", "Quality dip")}
                        eyebrowTone="warning"
                        title={t(
                          `${bannerState.count} تقييم منخفض في آخر 7 أيام`,
                          `${bannerState.count} low-rated evaluation${bannerState.count === 1 ? "" : "s"} in the last 7 days`,
                        )}
                      />
                      <Primary href="/moderator/evaluations?score=low" label={t("راجع الآن", "Review now")} arrow={<Arrow size={14} aria-hidden="true" />} />
                    </Banner>
                  );
                }
                if (bannerState.kind === "active-sessions") {
                  return (
                    <Banner tone="primary" onDismiss={dismiss}>
                      <Icon><Video size={20} aria-hidden="true" /></Icon>
                      <Copy
                        eyebrow={t("جلسات مباشرة", "Live now")}
                        eyebrowTone="primary"
                        title={t(
                          `${bannerState.count} جلسة قابلة للمراقبة الآن`,
                          `${bannerState.count} session${bannerState.count === 1 ? "" : "s"} you can observe right now`,
                        )}
                      />
                      <Primary href="/moderator/sessions" label={t("مراقبة", "Observe")} arrow={<Arrow size={14} aria-hidden="true" />} />
                    </Banner>
                  );
                }
                return (
                  <Banner tone="calm" onDismiss={dismiss}>
                    <Icon><ShieldCheck size={20} aria-hidden="true" /></Icon>
                    <Copy
                      eyebrow={t("هادئ", "All clear")}
                      eyebrowTone="calm"
                      title={t("لا تنبيهات. وقت ممتاز لتدقيق عشوائي لجلسة.", "No alerts. Good time for a random session audit.")}
                    />
                    <Secondary href="/moderator/sessions" label={t("استعرض الجلسات", "Browse sessions")} arrow={<Arrow size={14} aria-hidden="true" />} />
                  </Banner>
                );
              })()}
            </section>
          </SectionErrorBoundary>
        )}

        {/* 4 Stat Cards. */}
        <SectionErrorBoundary fallbackLabel={t("تعذّر تحميل المؤشرات", "Couldn't load metrics")}>
          <section aria-label={t("مؤشرات سريعة", "Key metrics")} className="grid grid-cols-2 gap-4 md:grid-cols-4 stagger-children motion-reduce:[&>*]:animate-none">
            <StatCard
              icon={FileCheck}
              label={t("السير الذاتية المعلقة", "Pending CVs")}
              value={pendingCvCount}
              href="/moderator/cv-review"
              actionLabel={t("مراجعة", "Review")}
              statusBadge={pendingCvCount > 0 ? { text: t("عاجل", "Urgent"), type: "warning" as const } : undefined}
            />
            <StatCard
              icon={Video}
              label={t("الجلسات النشطة", "Active Sessions")}
              value={activeSessionCount}
              href="/moderator/sessions"
              actionLabel={t("مراقبة", "Monitor")}
              statusBadge={activeSessionCount > 0 ? { text: t("مباشر", "Live"), type: "active" as const } : undefined}
            />
            <StatCard
              icon={Star}
              label={t("تقييمات منخفضة", "Flagged Evals")}
              value={flaggedEvalCount}
              href="/moderator/evaluations?score=low"
              actionLabel={t("عرض", "View")}
              statusBadge={flaggedEvalCount > 0 ? { text: t("للمراجعة", "Review"), type: "warning" as const } : undefined}
            />
            <StatCard
              icon={ClipboardList}
              label={t("إجمالي التقييمات", "Total Evaluations")}
              value={evalCount}
              href="/moderator/evaluations"
              actionLabel={t("عرض", "View")}
            />
          </section>
        </SectionErrorBoundary>

        {/* Chart + right widgets. */}
        <section aria-label={t("التحليلات", "Analytics")} className="mt-6 grid grid-cols-1 gap-4 lg:grid-cols-5">
          <div className="lg:col-span-3">
            <SectionErrorBoundary fallbackLabel={t("تعذّر تحميل النشاط", "Couldn't load activity")}>
              <WidgetCard title={t("نشاط السير الذاتية", "CV Submissions Activity")}>
                <AnalyticsChart data={weeklyCVActivity} title={t("السير المقدمة", "Submissions")} unit="#" />
              </WidgetCard>
            </SectionErrorBoundary>
          </div>
          <div className="space-y-4 lg:col-span-2">
            <SectionErrorBoundary fallbackLabel={t("تعذّر تحميل الجلسات المباشرة", "Couldn't load live sessions")}>
              <LiveSessionsWidget sessions={liveSessions} title={t("الجلسات المباشرة", "Live Sessions")} ongoingCount={liveSessions.length} />
            </SectionErrorBoundary>
            <SectionErrorBoundary fallbackLabel={t("تعذّر تحميل التوزيع", "Couldn't load distribution")}>
              <BreakdownBar title={t("توزيع التقييمات", "Rating Distribution")} segments={ratingDistribution} emptyMessage={t("لا توجد تقييمات في آخر 30 يوم", "No evaluations in the last 30 days")} />
            </SectionErrorBoundary>
          </div>
        </section>

        {/* Flagged evaluations table. */}
        <section aria-labelledby="flagged-heading" className="mt-6">
          <h2 id="flagged-heading" className="sr-only">{t("التقييمات المنخفضة", "Flagged Evaluations")}</h2>
          <SectionErrorBoundary fallbackLabel={t("تعذّر تحميل التقييمات المنخفضة", "Couldn't load flagged evals")}>
            <DataTable
              title={t("التقييمات المنخفضة (آخر 7 أيام)", "Flagged Evaluations (Last 7 Days)")}
              columns={[
                { key: "subject", label: t("النوع", "Type") },
                { key: "date", label: t("التاريخ", "Date"), type: "date" },
                { key: "progress", label: t("التقييم", "Score"), type: "progress" },
                { key: "assignee", label: t("المعلم", "Teacher"), type: "assignee" },
                { key: "view", label: t("عرض", "View"), type: "actions" },
              ]}
              rows={flaggedEvaluations as { id: string; [key: string]: unknown }[]}
              emptyMessage={t("لا توجد تقييمات منخفضة", "No flagged evaluations")}
            />
          </SectionErrorBoundary>
        </section>

        {/* Quick actions. */}
        <section aria-labelledby="quick-actions-heading" className="mt-6">
          <h2 id="quick-actions-heading" className="sr-only">{t("إجراءات سريعة", "Quick Actions")}</h2>
          <SectionErrorBoundary fallbackLabel={t("تعذّر تحميل الإجراءات السريعة", "Couldn't load quick actions")}>
            <WidgetCard title={t("إجراءات سريعة", "Quick Actions")}>
              <ul className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                <QuickAction href="/moderator/cv-review" icon={FileText} label={t("مراجعة السير الذاتية", "CV Review Queue")} />
                <QuickAction href="/moderator/sessions" icon={Eye} label={t("مراقبة الجلسات", "Observe Sessions")} />
                <QuickAction href="/moderator/evaluations" icon={ClipboardList} label={t("كل التقييمات", "All Evaluations")} />
                <QuickAction href="/moderator/audit" icon={ShieldCheck} label={t("سجل التدقيق", "Audit Log")} />
              </ul>
            </WidgetCard>
          </SectionErrorBoundary>
        </section>

        {/* Footer. */}
        <footer className="mt-10 flex flex-wrap items-center justify-between gap-3 border-t border-[var(--surface-divider,var(--surface-border))] pt-5 text-xs text-muted">
          <p>{t(`آخر تحديث ${lastRefreshLabel}`, `Last refreshed at ${lastRefreshLabel}`)}</p>
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={() => setHelpOpen(true)}
              className="inline-flex items-center gap-1.5 rounded-lg px-2 py-1 transition-colors hover:bg-foreground/5 hover:text-foreground focus-ring"
              aria-label={t("اختصارات لوحة المفاتيح", "Keyboard shortcuts")}
            >
              <Keyboard size={12} aria-hidden="true" />
              <span>{t("اختصارات", "Shortcuts")}</span>
              <kbd className="ms-1 inline-flex h-5 min-w-[18px] items-center justify-center rounded border border-[var(--surface-border)] bg-[var(--surface-light)] px-1 font-mono text-[10px]">?</kbd>
            </button>
            <button
              type="button"
              onClick={refresh}
              className="inline-flex items-center gap-1.5 rounded-lg px-2 py-1 transition-colors hover:bg-foreground/5 hover:text-foreground focus-ring"
              aria-label={t("تحديث", "Refresh")}
            >
              <RefreshCw size={12} aria-hidden="true" />
              <span>{t("تحديث", "Refresh")}</span>
            </button>
          </div>
        </footer>
      </div>

      <ShortcutsHelp open={helpOpen} onClose={() => setHelpOpen(false)} shortcuts={shortcuts} />
    </>
  );
}

function QuickAction({ href, icon: IconComp, label }: { href: string; icon: typeof FileText; label: string }) {
  return (
    <li>
      <Link
        href={href}
        className="flex flex-col items-center gap-2 rounded-xl p-4 text-center transition-colors hover:bg-[var(--surface-hover,rgba(0,0,0,0.04))] focus-ring"
      >
        <span className="inline-flex h-10 w-10 items-center justify-center rounded-xl bg-gold/10">
          <IconComp size={18} className="text-gold" aria-hidden="true" />
        </span>
        <span className="text-xs font-medium">{label}</span>
      </Link>
    </li>
  );
}

// ─── Banner shells (local — moderator doesn't have its own banner module) ──

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
        <button type="button" onClick={onDismiss} aria-label={t("إخفاء", "Dismiss")} className="absolute end-2 top-2 inline-flex h-7 w-7 items-center justify-center rounded-lg text-muted-light transition-colors hover:bg-foreground/5 hover:text-foreground focus-ring">
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
