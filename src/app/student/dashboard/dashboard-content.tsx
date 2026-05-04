"use client";

import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { Calendar, CheckCircle, Clock, Briefcase, Eye, Keyboard, RefreshCw, Sparkles } from "lucide-react";
import { useLang } from "@/lib/i18n/context";
import { useToast } from "@/components/shared/toast";
import { StatCard } from "@/components/shared/stat-card";
import { WidgetCard } from "@/components/shared/widget-card";
import { AnalyticsChart } from "@/components/shared/analytics-chart";
import { LiveSessionsWidget } from "@/components/shared/live-sessions-widget";
import { BreakdownBar } from "@/components/shared/breakdown-bar";
import { DataTable } from "@/components/shared/data-table";
import { surahName } from "@/lib/quran/surahs";
import { useKeyboardShortcuts, useShortcutsHelp, type Shortcut } from "@/lib/hooks/use-keyboard-shortcuts";
import { ShortcutsHelp } from "@/components/shared/shortcuts-help";
import { SectionErrorBoundary } from "@/components/shared/section-error-boundary";
import { LessonRowActions } from "./lesson-row-actions";
import { NextActionBanner } from "./next-action-banner";
import { WelcomeHeader } from "./welcome-header";
import { TodaysPlan } from "./todays-plan";
import { MurajaahCard } from "./murajaah-card";
import type { MurajaahWindow } from "@/lib/dashboard-queries";

interface ChartDataPoint {
  day: string;
  value: number;
  isActive: boolean;
}

interface DashboardData {
  fullName: string | null;
  nextBooking: { id: string; teacher_id: string; scheduled_at: string; duration_min: number; session_type: string } | null;
  sessionId: string | null;
  totalSessions: number;
  monthSessions: number;
  pendingBookings: number;
  nameMap: Record<string, string>;
  studyAnalytics: { daily: ChartDataPoint[]; weekly: ChartDataPoint[]; monthly: ChartDataPoint[] };
  liveSessions: { id: string; title: string; subtitle: string; initials: string; timeRemaining?: string; progressPercent?: number }[];
  watchingRows: Record<string, unknown>[];
  hwCounts: Record<string, number>;
  activePackages: { id: string; sessions_total: number; sessions_used: number; status: string; expires_at: string | null }[];
  nextQuiz: { id: string; title: string; due_at: string | null } | null;
  lastProgress: { surah_to: number | null; ayah_to: number | null; surah_from: number | null; ayah_from: number | null; level: string; recitation_standard: string | null; created_at: string } | null;
  resumeLesson: { lessonId: string; title: string; href: string; progressPct: number } | null;
  streakInfo: { streak: number; weeklyMinutes: number; weeklyDelta: number; loggedToday: boolean };
  homeworkPulse: { overdue: number; dueToday: number; dueThisWeek: number; nextItem: { id: string; description: string | null; dueDate: string | null; type: string } | null };
  todaySessions: { id: string; teacher_id: string; scheduled_at: string; duration_min: number; session_type: string; status: string }[];
  todayHomework: { id: string; description: string | null; due_date: string | null; homework_type: string; status: string }[];
  latestEvaluation: { recommendations: string | null; evaluation_type: string; created_at: string } | null;
  murajaahPlan: {
    yesterday: MurajaahWindow | null;
    lastWeek: MurajaahWindow | null;
    lastMonth: MurajaahWindow | null;
    reviewedToday: boolean;
  };
  renderedAtMs: number;
}

export function StudentDashboardContent({ data }: { data: DashboardData }) {
  const { t, dir, lang } = useLang();
  const toast = useToast();
  const searchParams = useSearchParams();
  const {
    fullName, nextBooking, sessionId, totalSessions, monthSessions, pendingBookings, nameMap,
    studyAnalytics, liveSessions, watchingRows, hwCounts, activePackages, nextQuiz,
    lastProgress, resumeLesson, streakInfo, homeworkPulse, todaySessions, todayHomework,
    latestEvaluation, murajaahPlan, renderedAtMs,
  } = data;

  // Booking-success toast on ?booked=1 — replace the URL afterwards so a
  // refresh doesn't re-toast.
  useEffect(() => {
    if (searchParams.get("booked") === "1") {
      toast.success(t("تم الحجز بنجاح! سيتم تأكيده من المعلم", "Booking submitted! Teacher will confirm soon."));
      window.history.replaceState(null, "", "/student/dashboard");
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Live ticker — every 60s. Seed from the server render time so the first
  // countdown render matches SSR, then let the browser advance it.
  const [now, setNow] = useState(renderedAtMs);
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 60_000);
    return () => window.clearInterval(id);
  }, []);

  const refresh = () => window.location.reload();

  // Countdown to next session (used by KPI 4).
  const minsUntilNext = nextBooking
    ? Math.floor((new Date(nextBooking.scheduled_at).getTime() - now) / 60_000)
    : null;
  const isImminent = minsUntilNext != null && minsUntilNext <= 30;

  let countdownShort = "—";
  if (nextBooking) {
    const diff = new Date(nextBooking.scheduled_at).getTime() - now;
    if (diff < 0) {
      countdownShort = t("الآن", "Now");
    } else {
      const mins = Math.floor(diff / 60000);
      const hours = Math.floor(mins / 60);
      const days = Math.floor(hours / 24);
      if (mins < 60) countdownShort = `${mins}m`;
      else if (hours < 24) countdownShort = `${hours}h`;
      else countdownShort = lang === "ar" ? `${days} يوم` : `${days}d`;
    }
  }

  // KPI 1 — Active Package: sessions remaining + percent used.
  const primaryPackage = activePackages[0] ?? null;
  const pkgRemaining = primaryPackage ? primaryPackage.sessions_total - primaryPackage.sessions_used : 0;
  const pkgPct = primaryPackage && primaryPackage.sessions_total > 0
    ? Math.round((primaryPackage.sessions_used / primaryPackage.sessions_total) * 100)
    : 0;

  // Greeting context. The `today` Date wraps `now` so it stays stable inside
  // useMemo dependencies (useMemo dep is `now` directly, not the Date object).
  const firstName = fullName ? fullName.split(" ")[0] : null;
  const weekday = new Date(now).toLocaleDateString(lang === "ar" ? "ar" : "en-US", { weekday: "long" });
  const surahNum = lastProgress?.surah_to ?? lastProgress?.surah_from ?? null;
  const ayahNum = lastProgress?.ayah_to ?? lastProgress?.ayah_from ?? null;
  const surahLabel = surahName(surahNum, lang === "ar" ? "ar" : "en");

  const teacherNameForBanner = nextBooking ? nameMap[nextBooking.teacher_id] ?? null : null;

  // Today's Plan items — sorted chronologically.
  const todaysPlanItems = useMemo(() => {
    const items: { id: string; kind: "session" | "homework" | "quiz"; title: string; detail: string; href: string; at: string | null; urgent?: boolean }[] = [];
    for (const s of todaySessions) {
      const teacherName = nameMap[s.teacher_id] ?? t("معلمك", "your teacher");
      items.push({
        id: `s:${s.id}`,
        kind: "session",
        title: t(`جلسة مع ${teacherName}`, `Session with ${teacherName}`),
        detail: t(`${s.duration_min} دقيقة`, `${s.duration_min} min · ${s.session_type}`),
        href: `/student/bookings/${s.id}`,
        at: s.scheduled_at,
        urgent: new Date(s.scheduled_at).getTime() - now <= 30 * 60_000,
      });
    }
    for (const h of todayHomework) {
      items.push({
        id: `h:${h.id}`,
        kind: "homework",
        title: h.description ?? t("واجب", "Assignment"),
        detail: t(`نوع: ${h.homework_type}`, `Type: ${h.homework_type}`),
        href: "/student/homework",
        at: h.due_date,
        urgent: true,
      });
    }
    if (nextQuiz?.due_at) {
      const dueDate = new Date(nextQuiz.due_at);
      const todayStart = new Date(now); todayStart.setHours(0, 0, 0, 0);
      const todayEnd = new Date(now); todayEnd.setHours(23, 59, 59, 999);
      if (dueDate >= todayStart && dueDate <= todayEnd) {
        items.push({
          id: `q:${nextQuiz.id}`,
          kind: "quiz",
          title: nextQuiz.title,
          detail: t("اختبار", "Quiz"),
          href: `/student/quizzes/${nextQuiz.id}/take`,
          at: nextQuiz.due_at,
          urgent: true,
        });
      }
    }
    items.sort((a, b) => {
      if (!a.at) return 1;
      if (!b.at) return -1;
      return new Date(a.at).getTime() - new Date(b.at).getTime();
    });
    return items;
  }, [todaySessions, todayHomework, nextQuiz, nameMap, now, t]);

  // Keyboard shortcuts — navigation, join-session, help overlay.
  const [helpOpen, setHelpOpen] = useShortcutsHelp();
  const shortcuts: Shortcut[] = useMemo(() => [
    {
      combo: "j",
      description: { ar: "انضم للجلسة القادمة", en: "Join next session" },
      group: { ar: "إجراءات", en: "Actions" },
      onTrigger: () => {
        if (sessionId && isImminent) window.location.assign(`/student/sessions/${sessionId}`);
        else toast.info(t("لا توجد جلسة وشيكة", "No imminent session"));
      },
    },
    { combo: "g d", description: { ar: "اللوحة", en: "Dashboard" }, group: { ar: "تنقل", en: "Navigate" }, href: "/student/dashboard" },
    { combo: "g s", description: { ar: "الجلسات", en: "Sessions" }, group: { ar: "تنقل", en: "Navigate" }, href: "/student/sessions" },
    { combo: "g c", description: { ar: "الدورات", en: "Courses" }, group: { ar: "تنقل", en: "Navigate" }, href: "/student/courses" },
    { combo: "g h", description: { ar: "الواجبات", en: "Homework" }, group: { ar: "تنقل", en: "Navigate" }, href: "/student/homework" },
    { combo: "g q", description: { ar: "الاختبارات", en: "Quizzes" }, group: { ar: "تنقل", en: "Navigate" }, href: "/student/quizzes" },
    { combo: "g p", description: { ar: "تقدمي", en: "Progress" }, group: { ar: "تنقل", en: "Navigate" }, href: "/student/progress" },
    { combo: "g t", description: { ar: "المعلمون", en: "Teachers" }, group: { ar: "تنقل", en: "Navigate" }, href: "/student/teachers" },
    { combo: "g m", description: { ar: "الرسائل", en: "Messages" }, group: { ar: "تنقل", en: "Navigate" }, href: "/student/messages" },
    { combo: "g k", description: { ar: "التقويم", en: "Calendar" }, group: { ar: "تنقل", en: "Navigate" }, href: "/student/calendar" },
    { combo: "?", description: { ar: "إظهار الاختصارات", en: "Show shortcuts" }, group: { ar: "مساعدة", en: "Help" }, onTrigger: () => setHelpOpen(true) },
  ], [sessionId, isImminent, toast, t, setHelpOpen]);
  useKeyboardShortcuts(shortcuts, true);

  // Last refresh marker — derived from the server render time.
  const lastRefreshLabel = new Date(renderedAtMs).toLocaleTimeString(lang === "ar" ? "ar" : "en-US", { hour: "2-digit", minute: "2-digit" });

  // KPI 4 — quiz takes priority, else next session, else "no upcoming".
  const kpi4 = (() => {
    if (nextQuiz) {
      const dueDate = nextQuiz.due_at ? new Date(nextQuiz.due_at) : null;
      const daysLeft = dueDate
        ? Math.max(0, Math.ceil((dueDate.getTime() - now) / 86400_000))
        : null;
      const valueLabel = daysLeft != null
        ? (daysLeft === 0 ? t("اليوم", "Today") : `${daysLeft} ${daysLeft === 1 ? t("يوم", "Day") : t("أيام", "Days")}`)
        : t("متاح", "Open");
      return (
        <StatCard
          icon={Clock}
          label={t("الاختبار القادم", "Upcoming Quiz")}
          value={valueLabel}
          href={`/student/quizzes/${nextQuiz.id}/take`}
          actionLabel={t("ابدأ", "Start")}
          statusBadge={{ text: t("مفتوح", "Open"), type: "info" }}
        />
      );
    }
    return (
      <StatCard
        icon={Clock}
        label={t("الجلسة القادمة", "Next Session")}
        value={nextBooking ? countdownShort : "—"}
        href={sessionId ? `/student/sessions/${sessionId}` : "/student/teachers"}
        actionLabel={
          nextBooking
            ? (isImminent ? t("انضم الآن", "Join now") : t("التفاصيل", "Details"))
            : t("احجز", "Book")
        }
        statusBadge={
          nextBooking
            ? { text: isImminent ? t("جاهز", "Ready") : t("مجدول", "Scheduled"), type: isImminent ? "active" : "info" }
            : undefined
        }
      />
    );
  })();

  // Empty-state hint for the Active Package KPI when no package is bought.
  const isEmptyShell = !primaryPackage && totalSessions === 0 && !nextBooking;

  return (
    <div className="student-dashboard-skin">
      {/* Skip link — visible only on focus, jumps screen-reader users past
          the topbar utilities and directly to the dashboard's main region. */}
      <a
        href="#student-main"
        className="sr-only focus:not-sr-only focus:absolute focus:start-4 focus:top-4 focus:z-[200] focus:rounded focus:bg-gold focus:px-3 focus:py-2 focus:text-sm focus:font-medium focus:text-background"
      >
        {t("تخطي إلى المحتوى", "Skip to main content")}
      </a>

      <div dir={dir} className="mx-auto max-w-7xl px-4 py-8 sm:px-6 sm:py-10" id="student-main">
        <WelcomeHeader
          firstName={firstName}
          weekday={weekday}
          surahLabel={surahLabel}
          ayahNum={ayahNum}
          surahNum={surahNum}
          streak={streakInfo.streak}
          loggedToday={streakInfo.loggedToday}
          recitationStandard={lastProgress?.recitation_standard ?? null}
          level={lastProgress?.level ?? null}
        />

        {/* Single primary CTA — smart resolution covers 8 priority states. */}
        <SectionErrorBoundary fallbackLabel={t("تعذّر تحميل الإجراء التالي", "Couldn't load the next action")}>
          <section aria-label={t("الإجراء التالي", "Next action")} className="mb-8">
            <NextActionBanner
              renderedAtMs={renderedAtMs}
              data={{
                nextBooking: nextBooking
                  ? {
                      sessionId,
                      bookingId: nextBooking.id,
                      scheduledAt: nextBooking.scheduled_at,
                      teacherName: teacherNameForBanner,
                    }
                  : null,
                resumeLesson,
                homework: homeworkPulse,
                nextQuiz,
              }}
            />
          </section>
        </SectionErrorBoundary>

        {/* "Your focus this week" — surfaces the latest evaluation's
            recommendations text right at the top of the dashboard so the
            student opens the app and sees what their teacher said to work
            on. The full evaluation (strengths/weaknesses/scores) lives on
            /student/progress; this card is the actionable next-step only. */}
        {latestEvaluation?.recommendations && (
          <SectionErrorBoundary fallbackLabel={t("تعذّر تحميل التركيز", "Couldn't load focus")}>
            <section
              aria-label={t("تركيز الأسبوع من معلمك", "Your teacher's focus for this week")}
              className="mb-8 rounded-2xl border border-gold/30 bg-gold/5 p-5"
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h2 className="flex items-center gap-2 text-sm font-semibold text-gold">
                  <Sparkles size={14} aria-hidden="true" />
                  {t("تركيز معلمك لهذا الأسبوع", "Your teacher's focus this week")}
                </h2>
                <a
                  href="/student/progress"
                  className="text-xs text-muted-light hover:text-gold focus-ring rounded"
                >
                  {t("عرض التقييم الكامل ←", "View full evaluation →")}
                </a>
              </div>
              <p className="mt-2 text-base leading-relaxed text-foreground">
                {latestEvaluation.recommendations}
              </p>
            </section>
          </SectionErrorBoundary>
        )}

        {/* 4-KPI grid — mobile order leads with the actionable one. */}
        <SectionErrorBoundary fallbackLabel={t("تعذّر تحميل المؤشرات", "Couldn't load KPIs")}>
          <section
            aria-label={t("مؤشرات سريعة", "Key metrics")}
            className="grid grid-cols-2 gap-6 md:grid-cols-4 stagger-children motion-reduce:[&>*]:animate-none"
          >
            <div className="order-2 md:order-1">
              <StatCard
                icon={Briefcase}
                label={t("باقتي", "Active Package")}
                value={primaryPackage ? `${pkgRemaining}` : "—"}
                href="/student/packages"
                actionLabel={primaryPackage ? `${pkgPct}% ${t("مستخدم", "used")}` : t("اشتر باقة", "Buy Package")}
                statusBadge={primaryPackage
                  ? { text: t("نشط", "Active"), type: "active" }
                  : isEmptyShell ? { text: t("ابدأ", "Start"), type: "info" } : undefined}
                subtitle={primaryPackage ? t("جلسات متبقية", "sessions left") : undefined}
                progressPct={primaryPackage ? pkgPct : undefined}
              />
            </div>
            <div className="order-3 md:order-2">
              <StatCard
                icon={CheckCircle}
                label={t("الجلسات المكتملة", "Completed")}
                value={totalSessions}
                href="/student/sessions"
                actionLabel={t("عرض الكل", "View All")}
              />
            </div>
            <div className="order-4 md:order-3">
              <StatCard
                icon={Calendar}
                label={t("هذا الشهر", "This Month")}
                value={monthSessions}
                href="/student/sessions"
                actionLabel={`${pendingBookings} ${t("معلّقة", "pending")}`}
              />
            </div>
            <div className="order-1 md:order-4">{kpi4}</div>
          </section>
        </SectionErrorBoundary>

        {/* Today's Plan — unified what's-on-my-plate-now surface. */}
        <section aria-labelledby="todays-plan-heading" className="mt-10">
          <h2 id="todays-plan-heading" className="sr-only">
            {t("خطة اليوم", "Today's Plan")}
          </h2>
          <SectionErrorBoundary fallbackLabel={t("تعذّر تحميل خطة اليوم", "Couldn't load Today's Plan")}>
            <TodaysPlan items={todaysPlanItems} homeworkPulse={homeworkPulse} />
          </SectionErrorBoundary>
        </section>

        {/* Murajaah daily prompt — scaffolds memorization-decay protection
            via three review windows (yesterday / last week / last month).
            The component hides itself when the student is brand-new (no
            'new' progress entries) or has already logged review today,
            so it doesn't nag. */}
        <section aria-labelledby="murajaah-heading" className="mt-6">
          <h2 id="murajaah-heading" className="sr-only">
            {t("مراجعة اليوم", "Today's Murajaah")}
          </h2>
          <SectionErrorBoundary fallbackLabel={t("تعذّر تحميل المراجعة", "Couldn't load Murajaah")}>
            <MurajaahCard
              yesterday={murajaahPlan.yesterday}
              lastWeek={murajaahPlan.lastWeek}
              lastMonth={murajaahPlan.lastMonth}
              reviewedToday={murajaahPlan.reviewedToday}
            />
          </SectionErrorBoundary>
        </section>

        {/* Analytics + sidebar widgets. */}
        <section aria-label={t("التحليلات", "Analytics")} className="mt-10 grid grid-cols-1 gap-6 lg:grid-cols-5">
          <div className="lg:col-span-3">
            <SectionErrorBoundary fallbackLabel={t("تعذّر تحميل التحليلات", "Couldn't load analytics")}>
              <WidgetCard
                title={t("تحليلات التقدم", "Report Analytics")}
                subtitle={streakInfo.weeklyMinutes > 0
                  ? t(
                      `${streakInfo.weeklyMinutes} د هذا الأسبوع${streakInfo.weeklyDelta !== 0 ? ` (${streakInfo.weeklyDelta > 0 ? "+" : ""}${streakInfo.weeklyDelta}%)` : ""}`,
                      `${streakInfo.weeklyMinutes} min this week${streakInfo.weeklyDelta !== 0 ? ` (${streakInfo.weeklyDelta > 0 ? "+" : ""}${streakInfo.weeklyDelta}%)` : ""}`,
                    )
                  : undefined}
              >
                <AnalyticsChart
                  data={studyAnalytics.weekly}
                  dailyData={studyAnalytics.daily}
                  monthlyData={studyAnalytics.monthly}
                  title={t("تحليلات التقدم", "Report Analytics")}
                />
              </WidgetCard>
            </SectionErrorBoundary>
          </div>

          <div className="space-y-6 lg:col-span-2">
            <SectionErrorBoundary fallbackLabel={t("تعذّر تحميل الجلسات المباشرة", "Couldn't load live sessions")}>
              <LiveSessionsWidget
                sessions={liveSessions}
                title={t("الجلسات المباشرة", "Online Classes")}
                ongoingCount={liveSessions.length}
              />
            </SectionErrorBoundary>
            <SectionErrorBoundary fallbackLabel={t("تعذّر تحميل توزيع الواجبات", "Couldn't load homework breakdown")}>
              <BreakdownBar
                title={t("توزيع الواجبات", "Assignment Breakdown")}
                infoTooltip={t("توزيع حالة الواجبات", "Distribution of homework status")}
                flat
                segments={[
                  ...(hwCounts.completed_excellent || hwCounts.completed_good
                    ? [{
                        label: t("تم التسليم", "Total Submitted"),
                        value: (hwCounts.completed_excellent ?? 0) + (hwCounts.completed_good ?? 0),
                        color: "var(--success)",
                      }]
                    : []),
                  ...(hwCounts.student_ready
                    ? [{ label: t("قيد المراجعة", "In Review"), value: hwCounts.student_ready, color: "var(--accent-purple)" }]
                    : []),
                  ...(hwCounts.assigned || hwCounts.completed_needs_work || hwCounts.completed_not_done
                    ? [{
                        label: t("متبقي", "Remaining"),
                        value: (hwCounts.assigned ?? 0) + (hwCounts.completed_needs_work ?? 0) + (hwCounts.completed_not_done ?? 0),
                        color: "var(--surface-divider)",
                      }]
                    : []),
                ]}
                emptyMessage={t("ابدأ تتبع الواجبات لرؤية التقدم", "Start tracking homework to see progress")}
              />
            </SectionErrorBoundary>
          </div>
        </section>

        {/* Pick up where you left off. */}
        <section aria-labelledby="pick-up-heading" className="mt-10">
          <h2 id="pick-up-heading" className="sr-only">
            {t("أكمل من حيث توقفت", "Pick up where you left off")}
          </h2>
          <SectionErrorBoundary fallbackLabel={t("تعذّر تحميل القائمة", "Couldn't load this list")}>
            <DataTable
              title={t("أكمل من حيث توقفت", "Pick up where you left off")}
              selectable
              simpleProgress
              columns={[
                { key: "subject", label: t("الكورس", "Subject") },
                { key: "date", label: t("التاريخ", "Date"), type: "date" },
                { key: "progress", label: t("التقدم", "Progress"), type: "progress" },
                { key: "assignee", label: t("الفريق", "Assignee"), type: "assignee" },
                { key: "view", label: t("الإجراءات", "Actions"), type: "actions" },
              ]}
              rows={watchingRows as { id: string; [key: string]: unknown }[]}
              renderRowActions={(row) => {
                const lessonId = row._lessonId as string | undefined;
                const href = (row._href as string | undefined) ?? "/student/courses";
                if (!lessonId) {
                  return (
                    <a
                      href={href}
                      aria-label={t("عرض", "View")}
                      className="inline-flex h-7 w-7 items-center justify-center rounded text-[var(--muted-light,#9CA3AF)] hover:text-foreground"
                    >
                      <Eye size={14} aria-hidden="true" />
                    </a>
                  );
                }
                return <LessonRowActions lessonId={lessonId} href={href} />;
              }}
              emptyMessage={t("لا توجد دروس قيد المتابعة بعد", "No lessons in progress yet")}
            />
          </SectionErrorBoundary>
        </section>

        {/* Footer — last refresh + shortcut hint + refresh button. Keeps the
            page feeling alive without consuming visual real estate above the
            fold. */}
        <footer className="mt-10 flex flex-wrap items-center justify-between gap-3 border-t border-[var(--surface-divider,var(--surface-border))] pt-5 text-xs text-muted">
          <p suppressHydrationWarning>
            {t(`آخر تحديث ${lastRefreshLabel}`, `Last refreshed at ${lastRefreshLabel}`)}
          </p>
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={() => setHelpOpen(true)}
              className="inline-flex items-center gap-1.5 rounded-lg px-2 py-1 transition-colors hover:bg-foreground/5 hover:text-foreground focus-ring"
              aria-label={t("اختصارات لوحة المفاتيح", "Keyboard shortcuts")}
            >
              <Keyboard size={12} aria-hidden="true" />
              <span>{t("اختصارات", "Shortcuts")}</span>
              <kbd className="ms-1 inline-flex h-5 min-w-[18px] items-center justify-center rounded border border-[var(--surface-border)] bg-[var(--surface-light)] px-1 font-mono text-[10px]">
                ?
              </kbd>
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
    </div>
  );
}
