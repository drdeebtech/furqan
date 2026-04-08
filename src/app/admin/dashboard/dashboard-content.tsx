"use client";

import Link from "next/link";
import { Users, GraduationCap, BookOpen, DollarSign, UserPlus, Clock, Plus, Bell, CalendarDays, Radio, Video } from "lucide-react";
import { useLang } from "@/lib/i18n/context";
import { StatCard } from "@/components/shared/stat-card";
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
}

export function AdminDashboardContent({ data }: { data: AdminDashboardData }) {
  const { t, dir } = useLang();
  const { studentCount, teacherList, bookingsMonth, revenueMonth, pendingCount, pendingBookings, newStudentCount, todayBookings, activeSessionCount, nameMap } = data;

  const hasAlerts = pendingCount > 0 || newStudentCount > 0;
  const formatDate = (d: string) => new Date(d).toLocaleDateString("ar-SA", { day: "numeric", month: "short" });
  const formatTime = (d: string) => new Date(d).toLocaleTimeString("ar-SA", { hour: "2-digit", minute: "2-digit" });

  return (
    <>
      <div className="h-0.5 bg-gradient-to-l from-gold/0 via-gold/30 to-gold/0" />
      <div dir={dir} className="mx-auto max-w-6xl px-4 py-8 sm:px-6">
        {/* Row 0: Title + Alerts */}
        <h1 className="text-2xl font-bold">{t("لوحة الإدارة", "Admin Dashboard")}</h1>
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
        <div className="mt-6 grid grid-cols-2 gap-3 md:grid-cols-4">
          <StatCard icon={Users} label={t("الطلاب", "Students")} value={studentCount} href="/admin/users" />
          <StatCard icon={GraduationCap} label={t("المعلمون", "Teachers")} value={teacherList.length} href="/admin/teachers" />
          <StatCard icon={BookOpen} label={t("حجوزات الشهر", "Monthly Bookings")} value={bookingsMonth} href="/admin/bookings" />
          <StatCard icon={DollarSign} label={t("إيرادات الشهر", "Monthly Revenue")} value={`$${revenueMonth.toFixed(2)}`} href="/admin/payments" />
        </div>

        {/* Row 2: Two-column layout */}
        <div className="mt-6 grid grid-cols-1 gap-4 lg:grid-cols-5">
          {/* Left: Today's Activity */}
          <div className="lg:col-span-3">
            <div className="glass-card p-4 sm:p-5">
              <h2 className="mb-4 flex items-center gap-2 text-base font-semibold">
                <CalendarDays size={18} className="text-gold" /> {t("نشاط اليوم", "Today's Activity")}
              </h2>
              {todayBookings.length === 0 ? (
                <div className="py-6 text-center">
                  <CalendarDays size={28} className="mx-auto mb-3 text-muted" />
                  <p className="text-sm text-muted">{t("لا توجد حجوزات اليوم", "No bookings today")}</p>
                </div>
              ) : (
                <div className="space-y-2">
                  {todayBookings.map(b => (
                    <div key={b.id} className="flex items-center gap-3 rounded-xl border border-white/5 p-3">
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
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* Right: Active Sessions + Quick Actions */}
          <div className="space-y-4 lg:col-span-2">
            {activeSessionCount > 0 && (
              <Link href="/admin/sessions/live" className="group flex items-center gap-3 rounded-2xl border-2 border-emerald-500/30 bg-emerald-500/5 p-4 transition-colors hover:border-emerald-500/50">
                <div className="shrink-0 rounded-xl bg-emerald-500/15 p-2.5"><Radio size={20} className="animate-pulse text-emerald-400" /></div>
                <div className="min-w-0">
                  <p className="text-sm font-bold text-emerald-400">{activeSessionCount} {t("جلسات نشطة الآن", "active sessions now")}</p>
                  <p className="mt-0.5 text-xs text-muted">{t("اضغط للمراقبة المباشرة", "Click to monitor live")}</p>
                </div>
              </Link>
            )}

            <div className="glass-card p-4 sm:p-5">
              <h2 className="mb-3 text-base font-semibold">{t("إجراءات سريعة", "Quick Actions")}</h2>
              <div className="space-y-1">
                <Link href="/admin/teachers/new" className="flex min-h-[40px] items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition-colors hover:bg-white/5">
                  <Plus size={16} className="text-gold" /> {t("إضافة معلم", "Add Teacher")}
                </Link>
                <Link href="/admin/notifications" className="flex min-h-[40px] items-center gap-3 rounded-xl px-3 py-2.5 text-sm transition-colors hover:bg-white/5">
                  <Bell size={16} className="text-gold" /> {t("إرسال إشعار", "Send Notification")}
                </Link>
                <Link href="/admin/bookings" className="flex min-h-[40px] items-center gap-3 rounded-xl px-3 py-2.5 text-sm transition-colors hover:bg-white/5">
                  <BookOpen size={16} className="text-gold" /> {t("عرض الحجوزات", "View Bookings")}
                </Link>
                <Link href="/admin/sessions" className="flex min-h-[40px] items-center gap-3 rounded-xl px-3 py-2.5 text-sm transition-colors hover:bg-white/5">
                  <Video size={16} className="text-gold" /> {t("الجلسات", "Sessions")}
                </Link>
              </div>
            </div>
          </div>
        </div>

        {/* Row 3: Teacher Management */}
        <div className="mt-6 glass-card p-4 sm:p-5">
          <div className="mb-4 flex items-center justify-between">
            <h2 className="flex items-center gap-2 text-base font-semibold">
              <GraduationCap size={18} className="text-gold" /> {t("إدارة المعلمين", "Teacher Management")}
            </h2>
            <span className="text-xs text-muted">{teacherList.length} {t("معلم", "teachers")}</span>
          </div>
          {teacherList.length === 0 ? (
            <div className="py-6 text-center">
              <GraduationCap size={28} className="mx-auto mb-3 text-muted" />
              <p className="text-sm text-muted">{t("لا يوجد معلمون بعد", "No teachers yet")}</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-white/10 text-xs text-muted">
                    <th className="pb-2 text-start font-medium">{t("المعلم", "Teacher")}</th>
                    <th className="pb-2 text-start font-medium">{t("الحالة", "Status")}</th>
                    <th className="pb-2 text-start font-medium">{t("الجلسات", "Sessions")}</th>
                    <th className="pb-2 text-start font-medium">{t("التقييم", "Rating")}</th>
                    <th className="pb-2 text-end font-medium">{t("إجراء", "Action")}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-white/5">
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
        </div>
      </div>
    </>
  );
}
