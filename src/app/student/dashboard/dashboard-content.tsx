"use client";

import { useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { Calendar, CheckCircle, Clock, Briefcase, Eye } from "lucide-react";
import { useLang } from "@/lib/i18n/context";
import { useToast } from "@/components/shared/toast";
import { StatCard } from "@/components/shared/stat-card";
import { WidgetCard } from "@/components/shared/widget-card";
import { AnalyticsChart } from "@/components/shared/analytics-chart";
import { LiveSessionsWidget } from "@/components/shared/live-sessions-widget";
import { BreakdownBar } from "@/components/shared/breakdown-bar";
import { DataTable } from "@/components/shared/data-table";
import { surahName } from "@/lib/quran/surahs";
import { LessonRowActions } from "./lesson-row-actions";
import { NextActionBanner } from "./next-action-banner";

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
  lastProgress: { surah_to: number | null; ayah_to: number | null; surah_from: number | null; ayah_from: number | null; level: string; created_at: string } | null;
  resumeLesson: { lessonId: string; title: string; href: string; progressPct: number } | null;
}

export function StudentDashboardContent({ data }: { data: DashboardData }) {
  const { t, dir, lang } = useLang();
  const toast = useToast();
  const searchParams = useSearchParams();
  const {
    fullName, nextBooking, sessionId, totalSessions, monthSessions, pendingBookings, nameMap,
    studyAnalytics, liveSessions, watchingRows, hwCounts, activePackages, nextQuiz,
    lastProgress, resumeLesson,
  } = data;

  useEffect(() => {
    if (searchParams.get("booked") === "1") {
      toast.success(t("تم الحجز بنجاح! سيتم تأكيده من المعلم", "Booking submitted! Teacher will confirm soon."));
      window.history.replaceState(null, "", "/student/dashboard");
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Live ticking countdown — re-renders every 60s so the "Next Session" KPI
  // and the time-aware copy on the banner update without a reload. SSR uses
  // the initial Date.now() so first-paint hydration matches.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 60_000);
    return () => window.clearInterval(id);
  }, []);

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

  const minsUntilNext = nextBooking
    ? Math.floor((new Date(nextBooking.scheduled_at).getTime() - now) / 60_000)
    : null;
  const isImminent = minsUntilNext != null && minsUntilNext <= 30;

  // KPI 1 — Active Package: sessions remaining + percent used.
  const primaryPackage = activePackages[0] ?? null;
  const pkgRemaining = primaryPackage ? primaryPackage.sessions_total - primaryPackage.sessions_used : 0;
  const pkgPct = primaryPackage && primaryPackage.sessions_total > 0
    ? Math.round((primaryPackage.sessions_used / primaryPackage.sessions_total) * 100)
    : 0;

  // Greeting context — name (when available), localized weekday, and the
  // most recent surah/ayah waypoint from student_progress.
  const firstName = fullName ? fullName.split(" ")[0] : null;
  const today = new Date(now);
  const weekday = today.toLocaleDateString(lang === "ar" ? "ar" : "en-US", { weekday: "long" });
  const surahNum = lastProgress?.surah_to ?? lastProgress?.surah_from ?? null;
  const ayahNum = lastProgress?.ayah_to ?? lastProgress?.ayah_from ?? null;
  const surahLabel = surahName(surahNum, lang === "ar" ? "ar" : "en");
  const surahBreadcrumb = surahLabel
    ? lang === "ar"
      ? `أنت في سورة ${surahLabel}${ayahNum ? ` · الآية ${ayahNum}` : ""}`
      : `You are in Surah ${surahLabel}${ayahNum ? ` · Ayah ${ayahNum}` : ""}`
    : null;

  const teacherNameForBanner = nextBooking ? nameMap[nextBooking.teacher_id] ?? null : null;

  // Compute KPI 4 outside the render so the JSX stays flat and readable.
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

  return (
    <div className="student-dashboard-skin">
      <div dir={dir} className="mx-auto max-w-7xl px-4 py-8 sm:px-6 sm:py-10">
        {/* Welcome row — greeting + day + active surah waypoint. The page no
            longer leads with a strip of numbers; it leads with the student. */}
        <header className="mb-6">
          <h1 className="font-display text-2xl font-bold sm:text-3xl">
            {firstName
              ? t(`أهلاً، ${firstName}`, `Welcome back, ${firstName}`)
              : t("أهلاً بعودتك", "Welcome back")}
          </h1>
          <p className="mt-1 text-sm text-muted">
            {weekday}
            {surahBreadcrumb && (
              <>
                <span className="mx-2 text-muted-light" aria-hidden="true">·</span>
                <span className="text-foreground/80">{surahBreadcrumb}</span>
              </>
            )}
          </p>
        </header>

        {/* Single primary CTA — what should the student actually do right now? */}
        <div className="mb-8">
          <NextActionBanner
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
            }}
          />
        </div>

        {/* 4-KPI grid — mobile order surfaces the most-actionable KPI first.
            On phones (single column flow) Next Session leads; on desktop the
            visual order is Package → Completed → Month → Next Session. */}
        <div className="grid grid-cols-2 gap-6 md:grid-cols-4 stagger-children motion-reduce:[&>*]:animate-none">
          <div className="order-2 md:order-1">
            <StatCard
              icon={Briefcase}
              label={t("باقتي", "Active Package")}
              value={primaryPackage ? `${pkgRemaining}` : "—"}
              href="/student/packages"
              actionLabel={primaryPackage ? `${pkgPct}% ${t("مستخدم", "used")}` : t("اشتر باقة", "Buy Package")}
              statusBadge={primaryPackage ? { text: t("نشط", "Active"), type: "active" } : undefined}
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
        </div>

        {/* Report Analytics chart (3fr) + Online Classes + Assignment Breakdown (2fr) */}
        <div className="mt-10 grid grid-cols-1 gap-6 lg:grid-cols-5">
          <div className="lg:col-span-3">
            <WidgetCard title={t("تحليلات التقدم", "Report Analytics")}>
              <AnalyticsChart
                data={studyAnalytics.weekly}
                dailyData={studyAnalytics.daily}
                monthlyData={studyAnalytics.monthly}
                title={t("تحليلات التقدم", "Report Analytics")}
              />
            </WidgetCard>
          </div>

          <div className="space-y-6 lg:col-span-2">
            <LiveSessionsWidget
              sessions={liveSessions}
              title={t("الجلسات المباشرة", "Online Classes")}
              ongoingCount={liveSessions.length}
            />
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
          </div>
        </div>

        {/* Pick up where you left off — the Quran-context reframe of
            "Continue Watching". */}
        <div className="mt-10">
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
                // Recording-only rows (no lessonId): a single Resume-style link
                // with a proper Lucide icon, matching the menu trigger style.
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
        </div>
      </div>
    </div>
  );
}
