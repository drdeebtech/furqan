"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo } from "react";
import {
  BookOpen, Bell, CalendarDays, DollarSign, GraduationCap, Keyboard,
  Plus, RefreshCw, UserPlus, Users, Video,
} from "lucide-react";
import { useLang } from "@/lib/i18n/context";
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
import { useNowTicker } from "@/lib/hooks/use-now-ticker";
import { ArchiveToggle } from "./archive-toggle";
import { AdminWelcomeHeader } from "./welcome-header";
import { AdminNextActionBanner } from "./next-action-banner";

interface TeacherRow { teacher_id: string; hourly_rate: number; rating_avg: number; total_sessions: number; is_accepting: boolean; is_archived: boolean }
interface PendingBookingRow { id: string; student_id: string; teacher_id: string; scheduled_at: string; session_type: string; created_at: string }
interface TodayBookingRow { id: string; student_id: string; teacher_id: string; scheduled_at: string; session_type: string; status: string; duration_min: number }

interface AdminDashboardData {
  studentCount: number;
  teacherList: TeacherRow[];
  bookingsMonth: number;
  revenueMonth: number;
  revenueTrend: { currentMonthUsd: number; previousMonthUsd: number; changePct: number };
  pendingCount: number;
  pendingBookings: PendingBookingRow[];
  newStudentCount: number;
  todayBookings: TodayBookingRow[];
  activeSessionCount: number;
  nameMap: Record<string, string>;
  dailyRevenue: { day: string; value: number; isActive: boolean }[];
  adminLiveSessions: { id: string; title: string; subtitle: string; initials: string; timeRemaining?: string; progressPercent?: number }[];
  bookingBreakdown: { label: string; value: number; color: string }[];
  recentBookings: { id: string; [key: string]: unknown }[];
  renderedAtMs: number;
}

export function AdminDashboardContent({ data }: { data: AdminDashboardData }) {
  const { t, dir, lang } = useLang();
  const toast = useToast();
  const locale = lang === "ar" ? "ar" : "en-US";
  const {
    studentCount, teacherList, bookingsMonth, revenueMonth, revenueTrend,
    pendingCount, pendingBookings, newStudentCount, todayBookings, activeSessionCount,
    nameMap, dailyRevenue, adminLiveSessions, bookingBreakdown, recentBookings, renderedAtMs,
  } = data;

  const formatTime = (d: string) => new Date(d).toLocaleTimeString(locale, { hour: "2-digit", minute: "2-digit" });

  // Seeded from the server render time so first client render matches SSR;
  // useNowTicker preserves the seed across initial mount, then snaps fresh
  // on visibility-resume. One shared timer instead of a local setInterval.
  const now = useNowTicker(60_000, renderedAtMs);
  const weekday = now.toLocaleDateString(locale, { weekday: "long" });
  const router = useRouter();

  const alertCount = (pendingCount > 0 ? 1 : 0) + (newStudentCount > 0 ? 1 : 0);
  const pendingPreview = useMemo(() => pendingBookings.slice(0, 3).map(b => ({
    id: b.id,
    studentName: nameMap[b.student_id] ?? null,
    teacherName: nameMap[b.teacher_id] ?? null,
    scheduledAt: b.scheduled_at,
  })), [pendingBookings, nameMap]);

  // Keyboard shortcuts.
  const [helpOpen, setHelpOpen] = useShortcutsHelp();
  const shortcuts: Shortcut[] = useMemo(() => [
    {
      combo: "j",
      description: { ar: "افتح الجلسات النشطة", en: "Open live sessions" },
      group: { ar: "إجراءات", en: "Actions" },
      onTrigger: () => {
        if (activeSessionCount > 0) router.push("/admin/sessions/live");
        else toast.info(t("لا جلسات نشطة الآن", "No live sessions"));
      },
    },
    {
      combo: "p",
      description: { ar: "الحجوزات المعلقة", en: "Pending bookings" },
      group: { ar: "إجراءات", en: "Actions" },
      onTrigger: () => router.push("/admin/bookings?status=pending"),
    },
    { combo: "g d", description: { ar: "اللوحة", en: "Dashboard" }, group: { ar: "تنقل", en: "Navigate" }, href: "/admin/dashboard" },
    { combo: "g c", description: { ar: "مركز التحكم", en: "Control Tower" }, group: { ar: "تنقل", en: "Navigate" }, href: "/admin/control-tower" },
    { combo: "g u", description: { ar: "المستخدمون", en: "Users" }, group: { ar: "تنقل", en: "Navigate" }, href: "/admin/users" },
    { combo: "g t", description: { ar: "المعلمون", en: "Teachers" }, group: { ar: "تنقل", en: "Navigate" }, href: "/admin/teachers" },
    { combo: "g b", description: { ar: "الحجوزات", en: "Bookings" }, group: { ar: "تنقل", en: "Navigate" }, href: "/admin/bookings" },
    { combo: "g s", description: { ar: "الجلسات", en: "Sessions" }, group: { ar: "تنقل", en: "Navigate" }, href: "/admin/sessions" },
    { combo: "g e", description: { ar: "التقييمات", en: "Evaluations" }, group: { ar: "تنقل", en: "Navigate" }, href: "/admin/evaluations" },
    { combo: "g $", description: { ar: "المالية", en: "Payments" }, group: { ar: "تنقل", en: "Navigate" }, href: "/admin/payments" },
    { combo: "g a", description: { ar: "سجل المراجعة", en: "Audit log" }, group: { ar: "تنقل", en: "Navigate" }, href: "/admin/audit" },
    { combo: "g n", description: { ar: "تحكم n8n", en: "n8n Control" }, group: { ar: "تنقل", en: "Navigate" }, href: "/admin/n8n" },
    { combo: "?", description: { ar: "إظهار الاختصارات", en: "Show shortcuts" }, group: { ar: "مساعدة", en: "Help" }, onTrigger: () => setHelpOpen(true) },
  ], [activeSessionCount, toast, t, setHelpOpen, router]);
  useKeyboardShortcuts(shortcuts, true);

  const lastRefreshLabel = new Date(renderedAtMs).toLocaleTimeString(locale, { hour: "2-digit", minute: "2-digit" });
  const refresh = () => window.location.reload();

  return (
    <>
      <a
        href="#admin-main"
        className="sr-only focus:not-sr-only focus:absolute focus:start-4 focus:top-4 focus:z-[200] focus:rounded focus:bg-gold focus:px-3 focus:py-2 focus:text-sm focus:font-medium focus:text-background"
      >
        {t("تخطي إلى المحتوى", "Skip to main content")}
      </a>

      <div className="h-0.5 bg-gradient-to-l from-gold/0 via-gold/30 to-gold/0" aria-hidden="true" />
      <div dir={dir} className="mx-auto max-w-7xl px-4 py-8 sm:px-6" id="admin-main">
        <AdminWelcomeHeader weekday={weekday} alertCount={alertCount} activeSessionCount={activeSessionCount} />

        {/* Smart admin banner — covers active sessions / pending backlog /
            new signups / quiet day. */}
        <SectionErrorBoundary fallbackLabel={t("تعذّر تحميل الإجراء التالي", "Couldn't load the next action")}>
          <section aria-label={t("الإجراء التالي", "Next action")} className="mb-6">
            <AdminNextActionBanner
              data={{
                pendingCount,
                activeSessionCount,
                newStudentCount,
                pendingPreview,
              }}
            />
          </section>
        </SectionErrorBoundary>

        {/* 4 Stat Cards. */}
        <SectionErrorBoundary fallbackLabel={t("تعذّر تحميل المؤشرات", "Couldn't load metrics")}>
          <section aria-label={t("مؤشرات سريعة", "Key metrics")} className="grid grid-cols-2 gap-4 md:grid-cols-4 stagger-children motion-reduce:[&>*]:animate-none">
            <StatCard icon={Users} label={t("الطلاب", "Students")} value={studentCount} href="/admin/users" actionLabel={t("عرض", "View")} />
            <StatCard icon={GraduationCap} label={t("المعلمون", "Teachers")} value={teacherList.length} href="/admin/teachers" actionLabel={t("عرض", "View")} />
            <StatCard icon={BookOpen} label={t("حجوزات الشهر", "Monthly Bookings")} value={bookingsMonth} href="/admin/bookings" actionLabel={t("عرض", "View")} />
            <StatCard
              icon={DollarSign}
              label={t("إيرادات الشهر", "Monthly Revenue")}
              value={`$${revenueMonth.toFixed(2)}`}
              href="/admin/payments"
              actionLabel={t("عرض", "View")}
              statusBadge={
                revenueTrend.previousMonthUsd > 0
                  ? {
                      text: `${revenueTrend.changePct >= 0 ? "+" : ""}${revenueTrend.changePct}% ${t("مقارنة بالشهر الماضي", "vs last month")}`,
                      type: revenueTrend.changePct >= 0 ? ("active" as const) : ("warning" as const),
                    }
                  : revenueMonth > 0
                    ? { text: t("نشط", "Active"), type: "active" as const }
                    : undefined
              }
            />
          </section>
        </SectionErrorBoundary>

        {/* Analytics + sidebar. */}
        <section aria-label={t("التحليلات", "Analytics")} className="mt-6 grid grid-cols-1 gap-4 lg:grid-cols-5">
          <div className="lg:col-span-3">
            <SectionErrorBoundary fallbackLabel={t("تعذّر تحميل الإيرادات اليومية", "Couldn't load daily revenue")}>
              <WidgetCard title={t("الإيرادات اليومية", "Daily Revenue")}>
                <AnalyticsChart data={dailyRevenue} title={t("الإيرادات", "Revenue")} unit="$" />
              </WidgetCard>
            </SectionErrorBoundary>
          </div>
          <div className="space-y-4 lg:col-span-2">
            <SectionErrorBoundary fallbackLabel={t("تعذّر تحميل الجلسات المباشرة", "Couldn't load live sessions")}>
              <LiveSessionsWidget sessions={adminLiveSessions} title={t("الجلسات المباشرة", "Live Sessions")} ongoingCount={adminLiveSessions.length} />
            </SectionErrorBoundary>
            <SectionErrorBoundary fallbackLabel={t("تعذّر تحميل توزيع الحجوزات", "Couldn't load booking breakdown")}>
              <BreakdownBar title={t("حالات الحجوزات", "Booking Status")} segments={bookingBreakdown} emptyMessage={t("لا توجد حجوزات في آخر 30 يوم", "No bookings in the last 30 days")} />
            </SectionErrorBoundary>
          </div>
        </section>

        {/* Recent bookings. */}
        <section aria-labelledby="recent-bookings-heading" className="mt-6">
          <h2 id="recent-bookings-heading" className="sr-only">{t("آخر الحجوزات", "Recent Bookings")}</h2>
          <SectionErrorBoundary fallbackLabel={t("تعذّر تحميل الحجوزات الأخيرة", "Couldn't load recent bookings")}>
            <DataTable
              title={t("آخر الحجوزات", "Recent Bookings")}
              columns={[
                { key: "subject", label: t("المبلغ / النوع", "Amount / Type") },
                { key: "date", label: t("التاريخ", "Date"), type: "date" },
                { key: "progress", label: t("الحالة", "Status"), type: "progress" },
                { key: "assignee", label: t("طالب ← معلم", "Student ← Teacher"), type: "assignee" },
                { key: "view", label: t("عرض", "View"), type: "actions" },
              ]}
              rows={recentBookings as { id: string; [key: string]: unknown }[]}
              emptyMessage={t("لا توجد حجوزات بعد", "No bookings yet")}
            />
          </SectionErrorBoundary>
        </section>

        {/* Today's activity + Quick actions. */}
        <section aria-label={t("نشاط اليوم", "Today's activity")} className="mt-6 grid grid-cols-1 gap-4 lg:grid-cols-5">
          <div className="lg:col-span-3">
            <SectionErrorBoundary fallbackLabel={t("تعذّر تحميل نشاط اليوم", "Couldn't load today's activity")}>
              <WidgetCard title={t("نشاط اليوم", "Today's Activity")} subtitle={todayBookings.length > 0 ? `${todayBookings.length}` : undefined}>
                {todayBookings.length === 0 ? (
                  <div className="flex min-h-[120px] items-center justify-center text-center">
                    <div>
                      <CalendarDays size={28} className="mx-auto mb-3 text-muted" aria-hidden="true" />
                      <p className="text-sm text-muted">{t("لا توجد حجوزات اليوم", "No bookings today")}</p>
                    </div>
                  </div>
                ) : (
                  <ul className="space-y-2">
                    {todayBookings.map(b => (
                      <li key={b.id} className="flex items-center gap-3 rounded-xl border border-[var(--surface-border)] p-3">
                        <div className="flex min-w-[3.5rem] flex-col items-center rounded-lg bg-gold/10 px-2 py-1.5">
                          <span className="text-xs font-bold text-gold">{formatTime(b.scheduled_at)}</span>
                          <span className="text-[10px] text-muted">{b.duration_min}{t("د", "m")}</span>
                        </div>
                        <div className="min-w-0 flex-1">
                          <p className="text-sm font-medium">{nameMap[b.student_id] ?? t("طالب", "Student")} <span className="text-muted">{t("مع", "with")}</span> {nameMap[b.teacher_id] ?? t("معلم", "Teacher")}</p>
                          <p className="mt-0.5 text-xs text-muted">{b.session_type}</p>
                        </div>
                        <span className={`shrink-0 glass-badge ${b.status === "confirmed" ? "border-success/30 bg-success/10 text-success" : b.status === "pending" ? "border-warning/30 bg-warning/10 text-warning" : "border-muted/30 text-muted"}`}>
                          {b.status === "confirmed" ? t("مؤكد", "Confirmed") : b.status === "pending" ? t("معلق", "Pending") : b.status}
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </WidgetCard>
            </SectionErrorBoundary>
          </div>

          <div className="space-y-4 lg:col-span-2">
            <SectionErrorBoundary fallbackLabel={t("تعذّر تحميل الإجراءات السريعة", "Couldn't load quick actions")}>
              <div className="glass-card p-4 sm:p-5">
                <h2 className="mb-3 text-base font-semibold">{t("إجراءات سريعة", "Quick Actions")}</h2>
                <ul className="space-y-1">
                  <li>
                    <Link href="/admin/teachers/new" className="flex min-h-[40px] items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition-colors hover:bg-[var(--surface-hover,rgba(0,0,0,0.04))] focus-ring">
                      <Plus size={16} className="text-gold" aria-hidden="true" /> {t("إضافة معلم", "Add Teacher")}
                    </Link>
                  </li>
                  <li>
                    <Link href="/admin/notifications" className="flex min-h-[40px] items-center gap-3 rounded-xl px-3 py-2.5 text-sm transition-colors hover:bg-[var(--surface-hover,rgba(0,0,0,0.04))] focus-ring">
                      <Bell size={16} className="text-gold" aria-hidden="true" /> {t("إرسال إشعار", "Send Notification")}
                    </Link>
                  </li>
                  <li>
                    <Link href="/admin/bookings" className="flex min-h-[40px] items-center gap-3 rounded-xl px-3 py-2.5 text-sm transition-colors hover:bg-[var(--surface-hover,rgba(0,0,0,0.04))] focus-ring">
                      <BookOpen size={16} className="text-gold" aria-hidden="true" /> {t("عرض الحجوزات", "View Bookings")}
                    </Link>
                  </li>
                  <li>
                    <Link href="/admin/sessions" className="flex min-h-[40px] items-center gap-3 rounded-xl px-3 py-2.5 text-sm transition-colors hover:bg-[var(--surface-hover,rgba(0,0,0,0.04))] focus-ring">
                      <Video size={16} className="text-gold" aria-hidden="true" /> {t("الجلسات", "Sessions")}
                    </Link>
                  </li>
                </ul>
              </div>
            </SectionErrorBoundary>
          </div>
        </section>

        {/* Teacher management. */}
        <section aria-labelledby="teacher-management-heading" className="mt-6">
          <h2 id="teacher-management-heading" className="sr-only">{t("إدارة المعلمين", "Teacher Management")}</h2>
          <SectionErrorBoundary fallbackLabel={t("تعذّر تحميل قائمة المعلمين", "Couldn't load teacher list")}>
            <WidgetCard title={t("إدارة المعلمين", "Teacher Management")} subtitle={`${teacherList.length} ${t("معلم", "teachers")}`}>
              {teacherList.length === 0 ? (
                <div className="flex min-h-[120px] items-center justify-center text-center">
                  <div>
                    <GraduationCap size={28} className="mx-auto mb-3 text-muted" aria-hidden="true" />
                    <p className="text-sm text-muted">{t("لا يوجد معلمون بعد", "No teachers yet")}</p>
                  </div>
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <caption className="sr-only">{t("إدارة المعلمين", "Teacher management")}</caption>
                    <thead>
                      <tr className="border-b border-[var(--surface-border)] text-xs text-muted-light">
                        <th scope="col" className="pb-2 text-start font-medium">{t("المعلم", "Teacher")}</th>
                        <th scope="col" className="pb-2 text-start font-medium">{t("الحالة", "Status")}</th>
                        <th scope="col" className="pb-2 text-start font-medium">{t("الجلسات", "Sessions")}</th>
                        <th scope="col" className="pb-2 text-start font-medium">{t("التقييم", "Rating")}</th>
                        <th scope="col" className="pb-2 text-end font-medium">{t("إجراء", "Action")}</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-[var(--surface-divider,#F0F0F2)]">
                      {teacherList.map(teacher => (
                        <tr key={teacher.teacher_id} className={teacher.is_archived ? "opacity-60" : ""}>
                          <td className="py-3">
                            <Link href={`/admin/users/${teacher.teacher_id}`} className="font-medium hover:text-gold focus-ring">
                              {nameMap[teacher.teacher_id] ?? t("معلم", "Teacher")}
                            </Link>
                          </td>
                          <td className="py-3">
                            {teacher.is_archived && <span className="glass-badge border-error/30 bg-error/10 text-error">{t("مؤرشف", "Archived")}</span>}
                            {!teacher.is_archived && teacher.is_accepting && <span className="glass-badge border-success/30 bg-success/10 text-success">{t("يقبل", "Open")}</span>}
                            {!teacher.is_archived && !teacher.is_accepting && <span className="glass-badge border-primary/30 bg-primary/10">{t("مشغول", "Busy")}</span>}
                          </td>
                          <td className="py-3 text-muted">{teacher.total_sessions}</td>
                          <td className="py-3 text-muted">{Number(teacher.rating_avg) > 0 ? Number(teacher.rating_avg).toFixed(1) : "—"}</td>
                          <td className="py-3 text-end">
                            <ArchiveToggle teacherId={teacher.teacher_id} isArchived={teacher.is_archived} />
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </WidgetCard>
          </SectionErrorBoundary>
        </section>

        {/* Note: pendingPreview displayed via banner above; this small alert
            kept for parity with old layout in case banner is dismissed. */}
        {newStudentCount > 0 && (
          <Link
            href="/admin/users?role=student&recent=1"
            className="mt-6 inline-flex items-center gap-3 rounded-2xl border-2 border-gold/30 bg-gold/5 p-4 transition-colors hover:border-gold/50"
          >
            <span className="rounded-xl bg-gold/15 p-2.5">
              <UserPlus size={20} className="text-gold" aria-hidden="true" />
            </span>
            <span>
              <span className="block text-sm font-semibold text-gold">{newStudentCount} {t("طلاب جدد هذا الأسبوع", "new students this week")}</span>
            </span>
          </Link>
        )}

        {/* Footer — last refresh + shortcuts trigger + refresh button. */}
        <footer className="mt-10 flex flex-wrap items-center justify-between gap-3 border-t border-[var(--surface-divider,var(--surface-border))] pt-5 text-xs text-muted">
          <p suppressHydrationWarning>{t(`آخر تحديث ${lastRefreshLabel}`, `Last refreshed at ${lastRefreshLabel}`)}</p>
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
