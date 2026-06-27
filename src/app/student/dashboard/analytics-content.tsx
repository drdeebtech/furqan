"use client";

import { Eye } from "lucide-react";
import { useLang } from "@/lib/i18n/context";
import { WidgetCard } from "@/components/shared/widget-card";
import { AnalyticsChart } from "@/components/shared/analytics-chart";
import { LiveSessionsWidget } from "@/components/shared/live-sessions-widget";
import { BreakdownBar } from "@/components/shared/breakdown-bar";
import { DataTable } from "@/components/shared/data-table";
import { SectionErrorBoundary } from "@/components/shared/section-error-boundary";
import { HonorBoardCard } from "./honor-board-card";
import { LessonRowActions } from "./lesson-row-actions";
import type { StudentAnalyticsWidgetData } from "@/lib/views/student-dashboard";

interface Props extends StudentAnalyticsWidgetData {
  weeklyMinutes: number;
  weeklyDelta: number;
}

export function StudentAnalyticsContent({
  studyAnalytics, liveSessions, hwCounts, watchingRows, continueIsLessons,
  weeklyMinutes, weeklyDelta,
}: Props) {
  const { t } = useLang();

  return (
    <>
      {/* Analytics + sidebar widgets. */}
      <section aria-label={t("التحليلات", "Analytics")} className="mt-10 grid grid-cols-1 gap-6 lg:grid-cols-5">
        <div className="lg:col-span-3">
          <SectionErrorBoundary fallbackLabel={t("تعذّر تحميل التحليلات", "Couldn't load analytics")}>
            <WidgetCard
              title={t("تحليلات التقدم", "Report Analytics")}
              subtitle={weeklyMinutes > 0
                ? t(
                    `${weeklyMinutes} د هذا الأسبوع${weeklyDelta !== 0 ? ` (${weeklyDelta > 0 ? "+" : ""}${weeklyDelta}%)` : ""}`,
                    `${weeklyMinutes} min this week${weeklyDelta !== 0 ? ` (${weeklyDelta > 0 ? "+" : ""}${weeklyDelta}%)` : ""}`,
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
          <SectionErrorBoundary fallbackLabel={t("تعذّر تحميل لوحة الشرف", "Couldn't load Honor Board")}>
            <HonorBoardCard />
          </SectionErrorBoundary>
          <SectionErrorBoundary fallbackLabel={t("تعذّر تحميل توزيع المتابعات", "Couldn't load follow-up breakdown")}>
            <BreakdownBar
              title={t("توزيع المتابعات", "Follow-up Breakdown")}
              infoTooltip={t("توزيع حالة المتابعات", "Distribution of follow-up status")}
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
              emptyMessage={t("ستظهر المتابعات هنا بعد تعيينها من معلمك", "Follow-ups will appear here once your teacher assigns them")}
            />
          </SectionErrorBoundary>
        </div>
      </section>

      {/* Continue watching / recent recordings table. */}
      <div className="mt-10">
        <SectionErrorBoundary fallbackLabel={t("تعذّر تحميل القائمة", "Couldn't load this list")}>
          <DataTable
            title={continueIsLessons
              ? t("أكمل من حيث توقفت", "Pick up where you left off")
              : t("تسجيلات جلساتك الأخيرة", "Your recent session recordings")}
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
            emptyMessage={t("ستظهر تسجيلات جلساتك هنا بعد جلستك الأولى", "Your session recordings will appear here after your first session")}
          />
        </SectionErrorBoundary>
      </div>
    </>
  );
}
