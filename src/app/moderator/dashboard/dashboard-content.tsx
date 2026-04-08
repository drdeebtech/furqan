"use client";

import { Users, FileText, Video, ClipboardCheck } from "lucide-react";
import { useLang } from "@/lib/i18n/context";
import { StatCard } from "@/components/shared/stat-card";

interface ModeratorDashboardData {
  studentCount: number;
  teacherCount: number;
  pendingCvCount: number;
  activeSessionCount: number;
  evalCount: number;
}

export function ModeratorDashboardContent({ data }: { data: ModeratorDashboardData }) {
  const { t, dir } = useLang();
  const { studentCount, teacherCount, pendingCvCount, activeSessionCount, evalCount } = data;

  return (
    <>
      <div className="h-0.5 bg-gradient-to-l from-gold/0 via-gold/30 to-gold/0" />
      <div dir={dir} className="mx-auto max-w-6xl px-4 py-8 sm:px-6">
        <h1 className="text-2xl font-bold">{t("لوحة المشرف", "Moderator Dashboard")}</h1>
        <p className="mt-1 text-sm text-muted">{t("إدارة ومراقبة المنصة", "Platform management & monitoring")}</p>

        {/* Row 1: 4 Stat Cards */}
        <div className="mt-6 grid grid-cols-2 gap-3 md:grid-cols-4">
          <StatCard icon={Users} label={t("طلاب", "Students")} value={studentCount} href="/moderator/users" actionLabel={t("عرض", "View")} />
          <StatCard icon={Users} label={t("معلمون", "Teachers")} value={teacherCount} href="/moderator/users" actionLabel={t("عرض", "View")} />
          <StatCard icon={FileText} label={t("سير ذاتية معلقة", "Pending CVs")} value={pendingCvCount} href="/moderator/cv-review" actionLabel={t("عرض", "View")} />
          <StatCard icon={Video} label={t("جلسات نشطة", "Active Sessions")} value={activeSessionCount} href="/moderator/sessions" actionLabel={t("عرض", "View")} />
        </div>

        {/* Row 2: Additional stat */}
        <div className="mt-4 grid grid-cols-2 gap-3 md:grid-cols-4">
          <StatCard icon={ClipboardCheck} label={t("تقييمات", "Evaluations")} value={evalCount} href="/moderator/evaluations" actionLabel={t("عرض", "View")} />
        </div>
      </div>
    </>
  );
}
