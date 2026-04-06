"use client";

import Link from "next/link";
import { Users, GraduationCap, BookOpen, DollarSign, AlertTriangle, UserPlus, Clock, Plus, Bell, CalendarDays, Radio, Video } from "lucide-react";
import { useLang } from "@/lib/i18n/context";
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
      <div dir={dir} className="mx-auto max-w-5xl px-4 py-8">
        <h1 className="text-2xl font-bold">{t("لوحة الإدارة", "Admin Dashboard")}</h1>
        <p className="mt-1 text-sm text-muted">{t("مركز التحكم", "Command Center")}</p>

        {hasAlerts && (
          <div className="mt-8 space-y-3">
            <h2 className="flex items-center gap-2 text-sm font-semibold text-gold">
              <AlertTriangle size={16} /> {t("تنبيهات تحتاج إجراء", "Action Required")}
            </h2>
            <div className="grid gap-3 sm:grid-cols-2">
              {pendingCount > 0 && (
                <Link href="/admin/bookings" className="group rounded-2xl border-2 border-warning/40 bg-warning/5 p-5 transition-colors hover:border-warning/60">
                  <div className="flex items-start gap-3">
                    <div className="rounded-xl bg-warning/15 p-2.5"><Clock size={20} className="text-warning" /></div>
                    <div className="min-w-0 flex-1">
                      <p className="font-semibold text-warning">{pendingCount} {t("حجوزات بانتظار التأكيد", "pending bookings")}</p>
                      {pendingBookings.length > 0 && (
                        <div className="mt-3 space-y-1.5">
                          {pendingBookings.map(b => (
                            <p key={b.id} className="text-xs text-muted">
                              {nameMap[b.student_id] ?? t("طالب", "Student")} {t("مع", "with")} {nameMap[b.teacher_id] ?? t("معلم", "Teacher")} — {formatDate(b.scheduled_at)}
                            </p>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                  <p className="mt-3 text-xs font-medium text-warning/80">{t("عرض الحجوزات المعلقة ←", "View Pending Bookings →")}</p>
                </Link>
              )}
              {newStudentCount > 0 && (
                <Link href="/admin/users" className="group rounded-2xl border-2 border-gold/30 bg-gold/5 p-5 transition-colors hover:border-gold/50">
                  <div className="flex items-start gap-3">
                    <div className="rounded-xl bg-gold/15 p-2.5"><UserPlus size={20} className="text-gold" /></div>
                    <div>
                      <p className="font-semibold text-gold">{newStudentCount} {t("طلاب جدد هذا الأسبوع", "new students this week")}</p>
                    </div>
                  </div>
                  <p className="mt-3 text-xs font-medium text-gold/80">{t("عرض الطلاب ←", "View Students →")}</p>
                </Link>
              )}
            </div>
          </div>
        )}

        <div className="mt-8 grid grid-cols-2 gap-3 md:grid-cols-4">
          {[
            { icon: Users, ar: "الطلاب", en: "Students", value: studentCount },
            { icon: GraduationCap, ar: "المعلمون", en: "Teachers", value: teacherList.length },
            { icon: BookOpen, ar: "حجوزات الشهر", en: "Monthly Bookings", value: bookingsMonth },
            { icon: DollarSign, ar: "إيرادات الشهر", en: "Monthly Revenue", value: `$${revenueMonth.toFixed(2)}` },
          ].map(s => (
            <div key={s.en} className="rounded-2xl border border-card-border bg-card elevation-2 p-3 sm:p-5">
              <div className="flex items-center gap-2 text-xs text-muted sm:text-sm"><s.icon size={16} />{t(s.ar, s.en)}</div>
              <p className="mt-1 text-xl font-bold text-gold sm:text-2xl">{s.value}</p>
            </div>
          ))}
        </div>

        <div className="mt-10">
          <h2 className="mb-4 flex items-center gap-2 text-lg font-semibold">
            <CalendarDays size={20} className="text-gold" /> {t("نشاط اليوم", "Today's Activity")}
          </h2>
          {todayBookings.length === 0 ? (
            <div className="rounded-2xl border border-card-border bg-card p-5 text-center sm:p-8">
              <CalendarDays size={28} className="mx-auto mb-3 text-muted" />
              <p className="text-muted">{t("لا توجد حجوزات اليوم", "No bookings today")}</p>
            </div>
          ) : (
            <div className="space-y-2">
              {todayBookings.map(b => (
                <div key={b.id} className="flex flex-col gap-3 rounded-xl border border-card-border bg-card p-3 sm:flex-row sm:items-center sm:gap-4 sm:p-4">
                  <div className="flex min-w-[4.5rem] flex-row items-center gap-2 sm:flex-col sm:gap-0 sm:rounded-lg sm:bg-gold/10 sm:px-3 sm:py-2">
                    <span className="text-sm font-bold text-gold">{formatTime(b.scheduled_at)}</span>
                    <span className="text-[10px] text-muted">{b.duration_min} {t("د", "m")}</span>
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium">{nameMap[b.student_id] ?? t("طالب", "Student")} <span className="text-muted">{t("مع", "with")}</span> {nameMap[b.teacher_id] ?? t("معلم", "Teacher")}</p>
                    <p className="mt-0.5 text-xs text-muted">{b.session_type}</p>
                  </div>
                  <span className={`w-fit shrink-0 rounded-full border px-2 py-0.5 text-xs ${b.status === "confirmed" ? "border-success/30 bg-success/10 text-success" : b.status === "pending" ? "border-warning/30 bg-warning/10 text-warning" : "border-muted/30 text-muted"}`}>
                    {b.status === "confirmed" ? t("مؤكد", "Confirmed") : b.status === "pending" ? t("معلق", "Pending") : b.status}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>

        {activeSessionCount > 0 && (
          <div className="mt-6">
            <Link href="/admin/sessions/live" className="group flex items-center gap-3 rounded-2xl border-2 border-emerald-500/30 bg-emerald-500/5 p-4 transition-colors hover:border-emerald-500/50 sm:gap-4 sm:p-5">
              <div className="shrink-0 rounded-xl bg-emerald-500/15 p-2.5 sm:p-3"><Radio size={24} className="animate-pulse text-emerald-400" /></div>
              <div className="min-w-0">
                <p className="text-base font-bold text-emerald-400 sm:text-lg">{activeSessionCount} {t("جلسات نشطة الآن", "active sessions now")}</p>
                <p className="mt-0.5 text-xs text-muted sm:text-sm">{t("اضغط للمراقبة المباشرة", "Click to monitor live")}</p>
              </div>
            </Link>
          </div>
        )}

        <div className="mt-10">
          <h2 className="mb-4 text-lg font-semibold">{t("إجراءات سريعة", "Quick Actions")}</h2>
          <div className="grid grid-cols-2 gap-3 sm:flex sm:flex-wrap">
            <Link href="/admin/teachers/new" className="neu-btn inline-flex min-h-[44px] items-center justify-center gap-2 rounded-xl bg-gold px-5 py-2.5 text-sm font-semibold text-background hover:bg-gold-hover">
              <Plus size={16} /> {t("إضافة معلم", "Add Teacher")}
            </Link>
            <Link href="/admin/notifications" className="neu-btn inline-flex min-h-[44px] items-center justify-center gap-2 rounded-xl border border-card-border px-5 py-2.5 text-sm font-medium hover:bg-surface-alt">
              <Bell size={16} /> {t("إرسال إشعار", "Send Notification")}
            </Link>
            <Link href="/admin/bookings" className="neu-btn inline-flex min-h-[44px] items-center justify-center gap-2 rounded-xl border border-card-border px-5 py-2.5 text-sm font-medium hover:bg-surface-alt">
              <BookOpen size={16} /> {t("عرض الحجوزات", "View Bookings")}
            </Link>
            <Link href="/admin/sessions" className="neu-btn inline-flex min-h-[44px] items-center justify-center gap-2 rounded-xl border border-card-border px-5 py-2.5 text-sm font-medium hover:bg-surface-alt">
              <Video size={16} /> {t("الجلسات", "Sessions")}
            </Link>
          </div>
        </div>

        <div className="mt-10">
          <h2 className="mb-4 flex items-center gap-2 text-lg font-semibold">
            <GraduationCap size={20} className="text-gold" /> {t("إدارة المعلمين", "Teacher Management")}
            <span className="text-sm font-normal text-muted">{teacherList.length} {t("معلم", "teachers")}</span>
          </h2>
          {teacherList.length === 0 ? (
            <div className="rounded-2xl border border-card-border bg-card p-5 text-center sm:p-8">
              <GraduationCap size={28} className="mx-auto mb-3 text-muted" />
              <p className="text-muted">{t("لا يوجد معلمون بعد", "No teachers yet")}</p>
            </div>
          ) : (
            <div className="space-y-3">
              {teacherList.map(teacher => (
                <div key={teacher.teacher_id} className={`rounded-xl border bg-card p-3 sm:p-4 ${teacher.is_archived ? "border-error/20 opacity-60" : "border-card-border"}`}>
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between sm:gap-4">
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <Link href={`/admin/users/${teacher.teacher_id}`} className="font-medium hover:text-gold">{nameMap[teacher.teacher_id] ?? t("معلم", "Teacher")}</Link>
                        {teacher.is_archived && <span className="rounded-full border border-error/30 bg-error/10 px-2 py-0.5 text-xs text-error">{t("مؤرشف", "Archived")}</span>}
                        {!teacher.is_archived && teacher.is_accepting && <span className="rounded-full border border-success/30 bg-success/10 px-2 py-0.5 text-xs text-success">{t("يقبل طلاب", "Accepting")}</span>}
                        {!teacher.is_archived && !teacher.is_accepting && <span className="rounded-full border border-primary/30 bg-primary/10 px-2 py-0.5 text-xs">{t("مشغول", "Busy")}</span>}
                      </div>
                      <p className="mt-1 text-sm text-muted">
                        {teacher.total_sessions} {t("جلسة", "sessions")} · {t("تقييم", "Rating")} {Number(teacher.rating_avg) > 0 ? Number(teacher.rating_avg).toFixed(1) : "—"}
                      </p>
                    </div>
                    <ArchiveToggle teacherId={teacher.teacher_id} isArchived={teacher.is_archived} />
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </>
  );
}
