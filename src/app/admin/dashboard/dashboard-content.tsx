"use client";

import Link from "next/link";
import { Users, GraduationCap, BookOpen, DollarSign, UserPlus, Clock, Plus, Bell, CalendarDays, Radio, Video } from "lucide-react";
import { useLang } from "@/lib/i18n/context";
import { StatCard } from "@/components/shared/stat-card";
import { WidgetCard } from "@/components/shared/widget-card";
import { AnalyticsChart } from "@/components/shared/analytics-chart";
import { LiveSessionsWidget } from "@/components/shared/live-sessions-widget";
import { BreakdownBar } from "@/components/shared/breakdown-bar";
import { DataTable } from "@/components/shared/data-table";
import { ArchiveToggle } from "./archive-toggle";

interface TeacherRow { teacher_id: string; hourly_rate: number; rating_avg: number; total_sessions: number; is_accepting: boolean; is_archived: boolean }
interface PendingBookingRow { id: string; student_id: string; teacher_id: string; scheduled_at: string; session_type: string; created_at: string }
interface TodayBookingRow { id: string; student_id: string; teacher_id: string; scheduled_at: string; session_type: string; status: string; duration_min: number }

interface AdminDashboardData {
  studentCount: number;
  teacherList: TeacherRow[];
  bookingsMonth: number;
  revenueMonth: number;
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
}

export function AdminDashboardContent({ data }: { data: AdminDashboardData }) {
  const { t, dir } = useLang();
  const { studentCount, teacherList, bookingsMonth, revenueMonth, pendingCount, pendingBookings, newStudentCount, todayBookings, activeSessionCount, nameMap, dailyRevenue, adminLiveSessions, bookingBreakdown, recentBookings } = data;

  const hasAlerts = pendingCount > 0 || newStudentCount > 0;
  const formatDate = (d: string) => new Date(d).toLocaleDateString("ar-SA", { day: "numeric", month: "short" });
  const formatTime = (d: string) => new Date(d).toLocaleTimeString("ar-SA", { hour: "2-digit", minute: "2-digit" });

  return (
    <>
      <div className="h-0.5 bg-gradient-to-l from-gold/0 via-gold/30 to-gold/0" />
      <div dir={dir} className="mx-auto max-w-6xl px-4 py-8 sm:px-6">
        {/* Row 0: Title + Alerts */}
        <h1 className="font-display text-3xl font-bold">{t("لوحة الإدارة", "Admin Dashboard")}</h1>
        <p className="mt-1 text-sm text-muted">{t("مركز التحكم", "Command Center")}</p>

        {hasAlerts && (
          <div className="mt-6 grid gap-3 sm:grid-cols-2">
            {pendingCount > 0 && (
              <Link href="/admin/bookings" className="group rounded-2xl border-2 border-warning/40 bg-warning/5 p-4 transition-colors hover:border-warning/60">
                <div className="flex items-start gap-3">
                  <div className="rounded-xl bg-warning/15 p-2.5"><Clock size={20} className="text-warning" /></div>
                  <div className="min-w-0 flex-1">
                    <p className="font-semibold text-warning">{pendingCount} {t("حجوزات بانتظار التأكيد", "pending bookings")}</p>
                    {pendingBookings.length > 0 && (
                      <div className="mt-2 space-y-1">
                        {pendingBookings.map(b => (
                          <p key={b.id} className="text-xs text-muted">
                            {nameMap[b.student_id] ?? t("طالب", "Student")} {t("مع", "with")} {nameMap[b.teacher_id] ?? t("معلم", "Teacher")} — {formatDate(b.scheduled_at)}
                          </p>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              </Link>
            )}
            {newStudentCount > 0 && (
              <Link href="/admin/users" className="group rounded-2xl border-2 border-gold/30 bg-gold/5 p-4 transition-colors hover:border-gold/50">
                <div className="flex items-start gap-3">
                  <div className="rounded-xl bg-gold/15 p-2.5"><UserPlus size={20} className="text-gold" /></div>
                  <div>
                    <p className="font-semibold text-gold">{newStudentCount} {t("طلاب جدد هذا الأسبوع", "new students this week")}</p>
                  </div>
                </div>
              </Link>
            )}
          </div>
        )}

        {/* Row 1: 4 Stat Cards */}
        <div className="mt-6 grid grid-cols-2 gap-4 md:grid-cols-4 stagger-children">
          <StatCard icon={Users} label={t("الطلاب", "Students")} value={studentCount} href="/admin/users" actionLabel={t("عرض", "View")} />
          <StatCard icon={GraduationCap} label={t("المعلمون", "Teachers")} value={teacherList.length} href="/admin/teachers" actionLabel={t("عرض", "View")} />
          <StatCard icon={BookOpen} label={t("حجوزات الشهر", "Monthly Bookings")} value={bookingsMonth} href="/admin/bookings" actionLabel={t("عرض", "View")} />
          <StatCard icon={DollarSign} label={t("إيرادات الشهر", "Monthly Revenue")} value={`$${revenueMonth.toFixed(2)}`} href="/admin/payments" actionLabel={t("عرض", "View")} statusBadge={revenueMonth > 0 ? { text: t("نشط", "Active"), type: "active" as const } : undefined} />
        </div>

        {/* Row 2: Analytics chart + Right widgets */}
        <div className="mt-6 grid grid-cols-1 gap-4 lg:grid-cols-5">
          <div className="lg:col-span-3">
            <WidgetCard title={t("الإيرادات اليومية", "Daily Revenue")}>
              <AnalyticsChart data={dailyRevenue} title={t("الإيرادات", "Revenue")} unit="$" />
            </WidgetCard>
          </div>
          <div className="space-y-4 lg:col-span-2">
            <LiveSessionsWidget
              sessions={adminLiveSessions}
              title={t("الجلسات المباشرة", "Live Sessions")}
              ongoingCount={adminLiveSessions.length}
            />
            <BreakdownBar
              title={t("حالات الحجوزات", "Booking Status")}
              segments={bookingBreakdown}
              emptyMessage={t("لا توجد حجوزات في آخر 30 يوم", "No bookings in the last 30 days")}
            />
          </div>
        </div>

        {/* Row 3: Recent Bookings data table */}
        <div className="mt-6">
          <DataTable
            title={t("آخر الحجوزات", "Recent Bookings")}
            columns={[
              { key: "id", label: t("رقم", "Id") },
              { key: "subject", label: t("المبلغ / النوع", "Amount / Type") },
              { key: "date", label: t("التاريخ", "Date"), type: "date" },
              { key: "progress", label: t("الحالة", "Status"), type: "progress" },
              { key: "assignee", label: t("طالب ← معلم", "Student ← Teacher"), type: "assignee" },
              { key: "view", label: t("عرض", "View"), type: "actions" },
            ]}
            rows={recentBookings as { id: string; [key: string]: unknown }[]}
            emptyMessage={t("لا توجد حجوزات بعد", "No bookings yet")}
          />
        </div>

        {/* Row 4: Today's Activity + Active Sessions + Quick Actions */}
        <div className="mt-6 grid grid-cols-1 gap-4 lg:grid-cols-5">
          <div className="lg:col-span-3">
            <WidgetCard title={t("نشاط اليوم", "Today's Activity")}>
              {todayBookings.length === 0 ? (
                <div className="flex min-h-[120px] items-center justify-center text-center">
                  <div>
                    <CalendarDays size={28} className="mx-auto mb-3 text-[var(--muted)]" />
                    <p className="text-sm text-[var(--muted)]">{t("لا توجد حجوزات اليوم", "No bookings today")}</p>
                  </div>
                </div>
              ) : (
                <div className="space-y-2">
                  {todayBookings.map(b => (
                    <div key={b.id} className="flex items-center gap-3 rounded-xl border border-[var(--surface-border)] p-3">
                      <div className="flex min-w-[3.5rem] flex-col items-center rounded-lg bg-gold/10 px-2 py-1.5">
                        <span className="text-xs font-bold text-gold">{formatTime(b.scheduled_at)}</span>
                        <span className="text-[10px] text-[var(--muted)]">{b.duration_min}{t("د", "m")}</span>
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-medium">{nameMap[b.student_id] ?? t("طالب", "Student")} <span className="text-[var(--muted)]">{t("مع", "with")}</span> {nameMap[b.teacher_id] ?? t("معلم", "Teacher")}</p>
                        <p className="mt-0.5 text-xs text-[var(--muted)]">{b.session_type}</p>
                      </div>
                      <span className={`shrink-0 glass-badge ${b.status === "confirmed" ? "border-success/30 bg-success/10 text-success" : b.status === "pending" ? "border-warning/30 bg-warning/10 text-warning" : "border-muted/30 text-muted"}`}>
                        {b.status === "confirmed" ? t("مؤكد", "Confirmed") : b.status === "pending" ? t("معلق", "Pending") : b.status}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </WidgetCard>
          </div>

          <div className="space-y-4 lg:col-span-2">
            {activeSessionCount > 0 && (
              <Link href="/admin/sessions/live" className="group flex items-center gap-3 rounded-2xl border-2 border-emerald-500/30 bg-emerald-500/5 p-4 transition-colors hover:border-emerald-500/50">
                <div className="shrink-0 rounded-xl bg-emerald-500/15 p-2.5"><Radio size={20} className="animate-pulse text-emerald-400" /></div>
                <div className="min-w-0">
                  <p className="text-sm font-bold text-emerald-400">{activeSessionCount} {t("جلسات نشطة الآن", "active sessions now")}</p>
                  <p className="mt-0.5 text-xs text-[var(--muted)]">{t("اضغط للمراقبة المباشرة", "Click to monitor live")}</p>
                </div>
              </Link>
            )}

            <div className="glass-card p-4 sm:p-5">
              <h2 className="mb-3 text-base font-semibold">{t("إجراءات سريعة", "Quick Actions")}</h2>
              <div className="space-y-1">
                <Link href="/admin/teachers/new" className="flex min-h-[40px] items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition-colors hover:bg-[var(--surface-hover,rgba(0,0,0,0.04))]">
                  <Plus size={16} className="text-gold" /> {t("إضافة معلم", "Add Teacher")}
                </Link>
                <Link href="/admin/notifications" className="flex min-h-[40px] items-center gap-3 rounded-xl px-3 py-2.5 text-sm transition-colors hover:bg-[var(--surface-hover,rgba(0,0,0,0.04))]">
                  <Bell size={16} className="text-gold" /> {t("إرسال إشعار", "Send Notification")}
                </Link>
                <Link href="/admin/bookings" className="flex min-h-[40px] items-center gap-3 rounded-xl px-3 py-2.5 text-sm transition-colors hover:bg-[var(--surface-hover,rgba(0,0,0,0.04))]">
                  <BookOpen size={16} className="text-gold" /> {t("عرض الحجوزات", "View Bookings")}
                </Link>
                <Link href="/admin/sessions" className="flex min-h-[40px] items-center gap-3 rounded-xl px-3 py-2.5 text-sm transition-colors hover:bg-[var(--surface-hover,rgba(0,0,0,0.04))]">
                  <Video size={16} className="text-gold" /> {t("الجلسات", "Sessions")}
                </Link>
              </div>
            </div>
          </div>
        </div>

        {/* Row 5: Teacher Management */}
        <div className="mt-6">
          <WidgetCard title={t("إدارة المعلمين", "Teacher Management")} subtitle={`${teacherList.length} ${t("معلم", "teachers")}`}>
            {teacherList.length === 0 ? (
              <div className="flex min-h-[120px] items-center justify-center text-center">
                <div>
                  <GraduationCap size={28} className="mx-auto mb-3 text-[var(--muted)]" />
                  <p className="text-sm text-[var(--muted)]">{t("لا يوجد معلمون بعد", "No teachers yet")}</p>
                </div>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-[var(--surface-border)] text-xs text-[var(--muted-light,var(--muted))]">
                      <th className="pb-2 text-start font-medium">{t("المعلم", "Teacher")}</th>
                      <th className="pb-2 text-start font-medium">{t("الحالة", "Status")}</th>
                      <th className="pb-2 text-start font-medium">{t("الجلسات", "Sessions")}</th>
                      <th className="pb-2 text-start font-medium">{t("التقييم", "Rating")}</th>
                      <th className="pb-2 text-end font-medium">{t("إجراء", "Action")}</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[var(--surface-divider,#F0F0F2)]">
                    {teacherList.map(teacher => (
                      <tr key={teacher.teacher_id} className={teacher.is_archived ? "opacity-60" : ""}>
                        <td className="py-3">
                          <Link href={`/admin/users/${teacher.teacher_id}`} className="font-medium hover:text-gold">
                            {nameMap[teacher.teacher_id] ?? t("معلم", "Teacher")}
                          </Link>
                        </td>
                        <td className="py-3">
                          {teacher.is_archived && <span className="glass-badge border-error/30 bg-error/10 text-error">{t("مؤرشف", "Archived")}</span>}
                          {!teacher.is_archived && teacher.is_accepting && <span className="glass-badge border-success/30 bg-success/10 text-success">{t("يقبل", "Open")}</span>}
                          {!teacher.is_archived && !teacher.is_accepting && <span className="glass-badge border-primary/30 bg-primary/10">{t("مشغول", "Busy")}</span>}
                        </td>
                        <td className="py-3 text-[var(--muted)]">{teacher.total_sessions}</td>
                        <td className="py-3 text-[var(--muted)]">{Number(teacher.rating_avg) > 0 ? Number(teacher.rating_avg).toFixed(1) : "—"}</td>
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
        </div>
      </div>
    </>
  );
}
