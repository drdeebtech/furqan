"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Calendar, CheckCircle, Clock, Search, Star, Briefcase, Video } from "lucide-react";
import { useLang } from "@/lib/i18n/context";
import { useToast } from "@/components/shared/toast";
import { SESSION_TYPE_BILINGUAL } from "@/lib/constants";
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
    fullName, nextBooking, sessionId, totalSessions, monthSessions, pendingBookings,
    nameMap, studyAnalytics, liveSessions, watchingRows, hwCounts, activePackages,
  } = data;

  useEffect(() => {
    if (searchParams.get("booked") === "1") {
      toast.success(t("تم الحجز بنجاح! سيتم تأكيده من المعلم", "Booking submitted! Teacher will confirm soon."));
      window.history.replaceState(null, "", "/student/dashboard");
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Use a stable timestamp captured at first render so the SSR'd HTML and the
  // first client render agree (avoids a hydration warning on the countdown).
  const [initialNow] = useState(() => Date.now());
  let countdownLong = "";
  let countdownShort = "";
  let countdownColor = "text-muted";
  if (nextBooking) {
    const diff = new Date(nextBooking.scheduled_at).getTime() - initialNow;
    if (diff < 0) {
      countdownLong = t("الآن", "Now");
      countdownShort = t("الآن", "Now");
      countdownColor = "text-red-400";
    } else {
      const mins = Math.floor(diff / 60000);
      const hours = Math.floor(mins / 60);
      const days = Math.floor(hours / 24);
      if (mins < 60) {
        countdownLong = t(`بعد ${mins} دقيقة`, `In ${mins} min`);
        countdownShort = `${mins}m`;
        countdownColor = "text-red-400";
      } else if (hours < 24) {
        countdownLong = t(`بعد ${hours} ساعة`, `In ${hours} hours`);
        countdownShort = `${hours}h`;
        countdownColor = "text-amber-400";
      } else {
        countdownLong = t(`بعد ${days} يوم`, `In ${days} days`);
        countdownShort = lang === "ar" ? `${days} يوم` : `${days}d`;
      }
    }
  }

  const st = (type: string) => {
    const s = SESSION_TYPE_BILINGUAL[type as keyof typeof SESSION_TYPE_BILINGUAL];
    return s ? t(s.ar, s.en) : type;
  };

  // KPI 1 — Active Package: show sessions remaining + percent used.
  const primaryPackage = activePackages[0] ?? null;
  const pkgRemaining = primaryPackage ? primaryPackage.sessions_total - primaryPackage.sessions_used : 0;
  const pkgPct = primaryPackage && primaryPackage.sessions_total > 0
    ? Math.round((primaryPackage.sessions_used / primaryPackage.sessions_total) * 100)
    : 0;

  return (
    <>
      <div className="h-0.5 bg-gradient-to-l from-gold/0 via-gold/30 to-gold/0" />
      <div dir={dir} className="mx-auto max-w-6xl px-4 py-8 sm:px-6 lg:py-10">
        {/* Welcome */}
        <h1 className="font-display text-3xl font-bold sm:text-4xl">
          {t("أهلاً", "Welcome")}{fullName ? ` ${fullName}` : ""}
        </h1>
        <p className="mt-1 text-sm text-muted">{t("مرحباً بك في أكاديمية فُرقان", "Welcome to FURQAN Academy")}</p>

        {totalSessions === 0 && !nextBooking && <GuidanceBanner />}

        {/* Next session hero — only when there's a booking */}
        {nextBooking ? (
          <div className="mt-6 glass-card p-5 sm:p-8">
            <p className="mb-2 text-sm font-bold text-gold">
              <Star size={14} className="inline text-gold" /> {t("جلستك القادمة", "Your Next Session")}
            </p>
            <p className="text-lg font-bold">
              {t("مع", "With")} {nameMap[nextBooking.teacher_id] ?? t("معلم", "Teacher")}
            </p>
            <p className="mt-1 text-sm text-muted">
              {st(nextBooking.session_type)} · {nextBooking.duration_min} {t("دقيقة", "min")}
            </p>
            <p dir="ltr" className="mt-2 text-start text-sm text-muted">
              {new Date(nextBooking.scheduled_at).toLocaleDateString(lang === "ar" ? "ar" : "en-US", { weekday: "long", year: "numeric", month: "long", day: "numeric" })}
              {" · "}
              {new Date(nextBooking.scheduled_at).toLocaleTimeString(lang === "ar" ? "ar" : "en-US", { hour: "2-digit", minute: "2-digit" })}
            </p>
            <p className={`mt-2 text-sm font-medium ${countdownColor}`}>{countdownLong}</p>
            <div className="mt-4 flex flex-wrap items-center gap-3">
              {sessionId && (
                <Link href={`/student/sessions/${sessionId}`} className="flex items-center gap-2 glass-success glass-pill px-6 py-2.5 text-sm font-semibold text-white transition-colors">
                  <Video size={16} /> {t("انضم للجلسة", "Join Session")}
                </Link>
              )}
              <Link href="/student/teachers" className="text-sm text-gold hover:text-gold-hover">
                {t("احجز جلسة أخرى ←", "Book Another Session →")}
              </Link>
            </div>
          </div>
        ) : totalSessions > 0 ? (
          <div className="mt-6 glass-card border-dashed p-5 text-center sm:p-8">
            <Calendar size={28} className="mx-auto mb-3 text-muted" />
            <p className="text-muted">{t("لا توجد جلسات قادمة", "No upcoming sessions")}</p>
            <Link href="/student/teachers" className="mt-4 inline-flex items-center gap-2 glass-gold glass-pill px-6 py-2.5 text-sm font-semibold text-white transition-colors">
              <Search size={16} /> {t("احجز جلسة الآن", "Book a Session")}
            </Link>
          </div>
        ) : null}

        {/* 4-KPI grid — reference layout: package, homework, completed, next session */}
        <div className="mt-8 grid grid-cols-2 gap-4 md:grid-cols-4 md:gap-6 stagger-children">
          <StatCard
            icon={Briefcase}
            label={t("باقتي", "Active Package")}
            value={primaryPackage ? `${pkgRemaining}` : "—"}
            href="/student/packages"
            actionLabel={primaryPackage ? `${pkgPct}% ${t("مستخدم", "used")}` : t("اشتر باقة", "Buy Package")}
            statusBadge={primaryPackage ? { text: t("نشط", "Active"), type: "active" } : undefined}
            subtitle={primaryPackage ? t("جلسات متبقية", "sessions left") : undefined}
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

        {/* Chart (3fr) + Live + Breakdown (2fr) */}
        <div className="mt-8 grid grid-cols-1 gap-6 lg:grid-cols-5">
          <div className="lg:col-span-3">
            <WidgetCard title={t("ساعات الدراسة", "Study Hours")}>
              <AnalyticsChart
                data={studyAnalytics.weekly}
                dailyData={studyAnalytics.daily}
                monthlyData={studyAnalytics.monthly}
                title={t("ساعات الدراسة", "Study Hours")}
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
                ...(hwCounts.assigned ? [{ label: t("تم التكليف", "Assigned"), value: hwCounts.assigned, color: "#3B82F6" }] : []),
                ...(hwCounts.student_ready ? [{ label: t("قيد المراجعة", "In Review"), value: hwCounts.student_ready, color: "#F59E0B" }] : []),
                ...(hwCounts.completed_excellent ? [{ label: t("ممتاز", "Excellent"), value: hwCounts.completed_excellent, color: "#10B981" }] : []),
                ...(hwCounts.completed_good ? [{ label: t("جيد", "Good"), value: hwCounts.completed_good, color: "#06B6D4" }] : []),
                ...(hwCounts.completed_needs_work ? [{ label: t("يحتاج تحسين", "Needs Work"), value: hwCounts.completed_needs_work, color: "#F97316" }] : []),
                ...(hwCounts.completed_not_done ? [{ label: t("لم يُنجز", "Not Done"), value: hwCounts.completed_not_done, color: "#EF4444" }] : []),
              ]}
              emptyMessage={t("ابدأ تتبع الواجبات لرؤية التقدم", "Start tracking homework to see progress")}
            />
          </div>
        </div>

        {/* Continue Watching */}
        <div className="mt-8">
          <DataTable
            title={t("متابعة المشاهدة", "Continue Watching")}
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
    </>
  );
}
