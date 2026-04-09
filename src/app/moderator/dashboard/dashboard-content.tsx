"use client";

import Link from "next/link";
import { FileCheck, Video, Star, ClipboardList, FileText, Eye, ShieldCheck } from "lucide-react";
import { useLang } from "@/lib/i18n/context";
import { StatCard } from "@/components/shared/stat-card";
import { WidgetCard } from "@/components/shared/widget-card";
import { AnalyticsChart } from "@/components/shared/analytics-chart";
import { LiveSessionsWidget } from "@/components/shared/live-sessions-widget";
import { BreakdownBar } from "@/components/shared/breakdown-bar";
import { DataTable } from "@/components/shared/data-table";

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
  const { t, dir } = useLang();
  const { pendingCvCount, activeSessionCount, evalCount, flaggedEvalCount, weeklyCVActivity, liveSessions, ratingDistribution, flaggedEvaluations } = data;

  return (
    <>
      <div className="h-0.5 bg-gradient-to-l from-gold/0 via-gold/30 to-gold/0" />
      <div dir={dir} className="mx-auto max-w-6xl px-4 py-8 sm:px-6">
        {/* Row 0: Welcome */}
        <h1 className="text-2xl font-bold">{t("لوحة المشرف", "Moderator Dashboard")}</h1>
        <p className="mt-1 text-sm text-muted">{t("مراقبة الجودة ومراجعة المحتوى", "Quality monitoring & content review")}</p>

        {/* Row 1: 4 Stat Cards */}
        <div className="mt-6 grid grid-cols-2 gap-3 md:grid-cols-4">
          <StatCard
            icon={FileCheck}
            label={t("السير الذاتية المعلقة", "Pending CVs")}
            value={pendingCvCount}
            href="/moderator/cv-review"
            actionLabel={t("مراجعة", "Review")}
            statusBadge={pendingCvCount > 0 ? { text: t("عاجل", "Urgent"), type: "active" as const } : undefined}
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
            href="/moderator/evaluations"
            actionLabel={t("عرض", "View")}
          />
          <StatCard
            icon={ClipboardList}
            label={t("إجمالي التقييمات", "Total Evaluations")}
            value={evalCount}
            href="/moderator/evaluations"
            actionLabel={t("عرض", "View")}
          />
        </div>

        {/* Row 2: Chart + right widgets */}
        <div className="mt-6 grid grid-cols-1 gap-4 lg:grid-cols-5">
          <div className="lg:col-span-3">
            <WidgetCard title={t("نشاط السير الذاتية", "CV Submissions Activity")}>
              <AnalyticsChart data={weeklyCVActivity} title={t("السير المقدمة", "Submissions")} />
            </WidgetCard>
          </div>
          <div className="space-y-4 lg:col-span-2">
            <LiveSessionsWidget
              sessions={liveSessions}
              title={t("الجلسات المباشرة", "Live Sessions")}
              ongoingCount={liveSessions.length}
            />
            <BreakdownBar
              title={t("توزيع التقييمات", "Rating Distribution")}
              segments={ratingDistribution}
              emptyMessage={t("لا توجد تقييمات في آخر 30 يوم", "No evaluations in the last 30 days")}
            />
          </div>
        </div>

        {/* Row 3: Flagged Evaluations table */}
        <div className="mt-6">
          <DataTable
            title={t("التقييمات المنخفضة (آخر 7 أيام)", "Flagged Evaluations (Last 7 Days)")}
            columns={[
              { key: "id", label: t("رقم", "Id") },
              { key: "subject", label: t("النوع", "Type") },
              { key: "date", label: t("التاريخ", "Date"), type: "date" },
              { key: "progress", label: t("التقييم", "Score"), type: "progress" },
              { key: "assignee", label: t("المعلم", "Teacher"), type: "assignee" },
              { key: "view", label: t("عرض", "View"), type: "actions" },
            ]}
            rows={flaggedEvaluations as { id: string; [key: string]: unknown }[]}
            emptyMessage={t("لا توجد تقييمات منخفضة", "No flagged evaluations")}
          />
        </div>

        {/* Row 4: Quick Actions */}
        <div className="mt-6">
          <WidgetCard title={t("إجراءات سريعة", "Quick Actions")}>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              <Link href="/moderator/cv-review" className="flex flex-col items-center gap-2 rounded-xl p-4 text-center transition-colors hover:bg-[var(--surface-hover,rgba(0,0,0,0.04))]">
                <FileText size={20} className="text-gold" />
                <span className="text-xs font-medium">{t("مراجعة السير الذاتية", "CV Review Queue")}</span>
              </Link>
              <Link href="/moderator/sessions" className="flex flex-col items-center gap-2 rounded-xl p-4 text-center transition-colors hover:bg-[var(--surface-hover,rgba(0,0,0,0.04))]">
                <Eye size={20} className="text-gold" />
                <span className="text-xs font-medium">{t("مراقبة الجلسات", "Observe Sessions")}</span>
              </Link>
              <Link href="/moderator/evaluations" className="flex flex-col items-center gap-2 rounded-xl p-4 text-center transition-colors hover:bg-[var(--surface-hover,rgba(0,0,0,0.04))]">
                <ClipboardList size={20} className="text-gold" />
                <span className="text-xs font-medium">{t("كل التقييمات", "All Evaluations")}</span>
              </Link>
              <Link href="/moderator/audit" className="flex flex-col items-center gap-2 rounded-xl p-4 text-center transition-colors hover:bg-[var(--surface-hover,rgba(0,0,0,0.04))]">
                <ShieldCheck size={20} className="text-gold" />
                <span className="text-xs font-medium">{t("سجل التدقيق", "Audit Log")}</span>
              </Link>
            </div>
          </WidgetCard>
        </div>
      </div>
    </>
  );
}
