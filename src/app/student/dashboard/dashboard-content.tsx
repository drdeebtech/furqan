"use client";

import { useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { Calendar, CheckCircle, Clock, Briefcase } from "lucide-react";
import { useLang } from "@/lib/i18n/context";
import { useToast } from "@/components/shared/toast";
import { StatCard } from "@/components/shared/stat-card";
import { WidgetCard } from "@/components/shared/widget-card";
import { AnalyticsChart } from "@/components/shared/analytics-chart";
import { LiveSessionsWidget } from "@/components/shared/live-sessions-widget";
import { BreakdownBar } from "@/components/shared/breakdown-bar";
import { DataTable } from "@/components/shared/data-table";
import { GuidanceBanner } from "./guidance-banner";

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
}

export function StudentDashboardContent({ data }: { data: DashboardData }) {
  const { t, dir, lang } = useLang();
  const toast = useToast();
  const searchParams = useSearchParams();
  const {
    nextBooking, sessionId, totalSessions, monthSessions, pendingBookings,
    studyAnalytics, liveSessions, watchingRows, hwCounts, activePackages,
  } = data;

  useEffect(() => {
    if (searchParams.get("booked") === "1") {
      toast.success(t("تم الحجز بنجاح! سيتم تأكيده من المعلم", "Booking submitted! Teacher will confirm soon."));
      window.history.replaceState(null, "", "/student/dashboard");
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Stable timestamp captured at first render so SSR + first client render
  // agree (avoids hydration warning on the countdown).
  const [initialNow] = useState(() => Date.now());
  let countdownShort = "—";
  if (nextBooking) {
    const diff = new Date(nextBooking.scheduled_at).getTime() - initialNow;
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

  // KPI 1 — Active Package: sessions remaining + percent used (drives the
  // inline progress bar inside the card).
  const primaryPackage = activePackages[0] ?? null;
  const pkgRemaining = primaryPackage ? primaryPackage.sessions_total - primaryPackage.sessions_used : 0;
  const pkgPct = primaryPackage && primaryPackage.sessions_total > 0
    ? Math.round((primaryPackage.sessions_used / primaryPackage.sessions_total) * 100)
    : 0;

  return (
    <div className="student-dashboard-skin">
      <div dir={dir} className="mx-auto max-w-[1400px] px-6 py-8 sm:px-8 sm:py-10">
        {/* Empty-state guidance for students with no upcoming session and zero history */}
        {totalSessions === 0 && !nextBooking && (
          <div className="mb-8">
            <GuidanceBanner />
          </div>
        )}

        {/* 4-KPI grid — reference layout: package + progress, completed, this month, next session */}
        <div className="grid grid-cols-2 gap-6 md:grid-cols-4 stagger-children">
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
          <StatCard
            icon={CheckCircle}
            label={t("الجلسات المكتملة", "Completed")}
            value={totalSessions}
            href="/student/sessions"
            actionLabel={t("عرض الكل", "View All")}
          />
          <StatCard
            icon={Calendar}
            label={t("هذا الشهر", "This Month")}
            value={monthSessions}
            href="/student/sessions"
            actionLabel={`${pendingBookings} ${t("معلّقة", "pending")}`}
          />
          <StatCard
            icon={Clock}
            label={t("الجلسة القادمة", "Next Session")}
            value={nextBooking ? countdownShort : "—"}
            href={sessionId ? `/student/sessions/${sessionId}` : "/student/teachers"}
            actionLabel={nextBooking ? t("التفاصيل", "Details") : t("احجز", "Book")}
            statusBadge={nextBooking ? { text: t("مجدول", "Scheduled"), type: "info" } : undefined}
          />
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
              segments={[
                ...(hwCounts.completed_excellent || hwCounts.completed_good
                  ? [{
                      label: t("تم التسليم", "Total Submitted"),
                      value: (hwCounts.completed_excellent ?? 0) + (hwCounts.completed_good ?? 0),
                      color: "#10B981",
                    }]
                  : []),
                ...(hwCounts.student_ready
                  ? [{ label: t("قيد المراجعة", "In Review"), value: hwCounts.student_ready, color: "#8B5CF6" }]
                  : []),
                ...(hwCounts.assigned || hwCounts.completed_needs_work || hwCounts.completed_not_done
                  ? [{
                      label: t("متبقي", "Remaining"),
                      value: (hwCounts.assigned ?? 0) + (hwCounts.completed_needs_work ?? 0) + (hwCounts.completed_not_done ?? 0),
                      color: "#E5E7EB",
                    }]
                  : []),
              ]}
              emptyMessage={t("ابدأ تتبع الواجبات لرؤية التقدم", "Start tracking homework to see progress")}
            />
          </div>
        </div>

        {/* Continue Watching */}
        <div className="mt-10">
          <DataTable
            title={t("متابعة المشاهدة", "Continue Watching")}
            selectable
            columns={[
              { key: "id", label: t("رقم", "Id") },
              { key: "subject", label: t("الكورس", "Subject") },
              { key: "date", label: t("التاريخ", "Date"), type: "date" },
              { key: "progress", label: t("التقدم", "Progress"), type: "progress" },
              { key: "assignee", label: t("الدرس", "Lesson"), type: "assignee" },
              { key: "view", label: t("متابعة", "Resume"), type: "actions" },
            ]}
            rows={watchingRows as { id: string; [key: string]: unknown }[]}
            emptyMessage={t("لا توجد دروس قيد المشاهدة بعد", "No lessons in progress yet")}
          />
        </div>
      </div>
    </div>
  );
}
