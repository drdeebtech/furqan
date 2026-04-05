import type { Metadata } from "next";
import { redirect } from "next/navigation";
import Link from "next/link";
import {
  Users,
  GraduationCap,
  BookOpen,
  DollarSign,
  AlertTriangle,
  UserPlus,
  Clock,
  Plus,
  Bell,
  CalendarDays,
  Radio,
  Video,
} from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { ArchiveToggle } from "./archive-toggle";

export const metadata: Metadata = { title: "لوحة الإدارة" };

/* ── Row types for .returns<T[]>() ─────────────────────────────── */

interface TeacherRow {
  teacher_id: string;
  hourly_rate: number;
  rating_avg: number;
  total_sessions: number;
  is_accepting: boolean;
  is_archived: boolean;
}

interface PendingBookingRow {
  id: string;
  student_id: string;
  teacher_id: string;
  scheduled_at: string;
  session_type: string;
  created_at: string;
}

interface TodayBookingRow {
  id: string;
  student_id: string;
  teacher_id: string;
  scheduled_at: string;
  session_type: string;
  status: string;
  duration_min: number;
}

interface RevenueRow {
  amount_usd: number;
}

interface ProfileNameRow {
  id: string;
  full_name: string | null;
}

export default async function AdminDashboardPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  /* ── Date boundaries ─────────────────────────────────────────── */
  const now = new Date();

  const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();

  const sevenDaysAgo = new Date(now);
  sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
  const sevenDaysAgoISO = sevenDaysAgo.toISOString();

  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString();
  const todayEnd = new Date(
    now.getFullYear(),
    now.getMonth(),
    now.getDate(),
    23,
    59,
    59,
    999,
  ).toISOString();

  /* ── Parallel queries ────────────────────────────────────────── */
  const [
    studentsRes,
    teachersRes,
    bookingsMonthRes,
    revenueMonthRes,
    pendingCountRes,
    pendingListRes,
    newStudentsRes,
    todayBookingsRes,
    activeSessionsRes,
  ] = await Promise.all([
    /* Stats: total students */
    supabase
      .from("profiles")
      .select("id", { count: "exact", head: true })
      .eq("role", "student"),

    /* Stats + teacher list */
    supabase
      .from("teacher_profiles")
      .select(
        "teacher_id, hourly_rate, rating_avg, total_sessions, is_accepting, is_archived",
      )
      .order("is_archived", { ascending: true })
      .order("total_sessions", { ascending: false })
      .returns<TeacherRow[]>(),

    /* Stats: bookings this month */
    supabase
      .from("bookings")
      .select("id", { count: "exact", head: true })
      .gte("created_at", startOfMonth),

    /* Stats: revenue this month */
    supabase
      .from("bookings")
      .select("amount_usd")
      .eq("status", "completed")
      .gte("created_at", startOfMonth)
      .returns<RevenueRow[]>(),

    /* Alerts: pending bookings count */
    supabase
      .from("bookings")
      .select("id", { count: "exact", head: true })
      .eq("status", "pending"),

    /* Alerts: latest 5 pending bookings */
    supabase
      .from("bookings")
      .select("id, student_id, teacher_id, scheduled_at, session_type, created_at")
      .eq("status", "pending")
      .order("created_at", { ascending: false })
      .limit(5)
      .returns<PendingBookingRow[]>(),

    /* Alerts: new students this week */
    supabase
      .from("profiles")
      .select("id", { count: "exact", head: true })
      .eq("role", "student")
      .gte("created_at", sevenDaysAgoISO),

    /* Today's activity */
    supabase
      .from("bookings")
      .select("id, student_id, teacher_id, scheduled_at, session_type, status, duration_min")
      .gte("scheduled_at", todayStart)
      .lte("scheduled_at", todayEnd)
      .order("scheduled_at", { ascending: true })
      .returns<TodayBookingRow[]>(),

    /* Active sessions count */
    supabase
      .from("sessions")
      .select("id", { count: "exact", head: true })
      .not("started_at", "is", null)
      .is("ended_at", null),
  ]);

  /* ── Derived values ──────────────────────────────────────────── */
  const studentCount = studentsRes.count ?? 0;
  const teacherList = teachersRes.data ?? [];
  const bookingsMonth = bookingsMonthRes.count ?? 0;
  const revenueMonth = (revenueMonthRes.data ?? []).reduce(
    (sum, b) => sum + Number(b.amount_usd),
    0,
  );
  const pendingCount = pendingCountRes.count ?? 0;
  const pendingBookings = pendingListRes.data ?? [];
  const newStudentCount = newStudentsRes.count ?? 0;
  const todayBookings = todayBookingsRes.data ?? [];
  const activeSessionCount = activeSessionsRes.count ?? 0;

  /* ── Name resolution (two-query pattern) ─────────────────────── */
  const allIds = new Set<string>();

  for (const t of teacherList) allIds.add(t.teacher_id);
  for (const b of pendingBookings) {
    allIds.add(b.student_id);
    allIds.add(b.teacher_id);
  }
  for (const b of todayBookings) {
    allIds.add(b.student_id);
    allIds.add(b.teacher_id);
  }

  let nameMap: Record<string, string> = {};
  const idsArray = Array.from(allIds);
  if (idsArray.length > 0) {
    const { data: profiles } = await supabase
      .from("profiles")
      .select("id, full_name")
      .in("id", idsArray)
      .returns<ProfileNameRow[]>();
    if (profiles) {
      nameMap = Object.fromEntries(
        profiles.map((p) => [p.id, p.full_name ?? "مستخدم"]),
      );
    }
  }

  /* ── Helpers ─────────────────────────────────────────────────── */
  const hasAlerts = pendingCount > 0 || newStudentCount > 0;

  const formatDate = (d: string) =>
    new Date(d).toLocaleDateString("ar-SA", {
      day: "numeric",
      month: "short",
    });

  const formatTime = (d: string) =>
    new Date(d).toLocaleTimeString("ar-SA", {
      hour: "2-digit",
      minute: "2-digit",
    });

  return (
    <>
      <div className="h-0.5 bg-gradient-to-l from-gold/0 via-gold/30 to-gold/0" />
      <div dir="rtl" className="mx-auto max-w-5xl px-4 py-8">
        <h1 className="text-2xl font-bold">لوحة الإدارة</h1>
        <p className="mt-1 text-sm text-muted">Admin command center</p>

        {/* ═══════ Section 1 — Alerts / Action Items ═══════ */}
        {hasAlerts && (
          <div className="mt-8 space-y-3">
            <h2 className="flex items-center gap-2 text-sm font-semibold text-gold">
              <AlertTriangle size={16} />
              تنبيهات تحتاج إجراء
            </h2>

            <div className="grid gap-3 sm:grid-cols-2">
              {/* Pending bookings alert */}
              {pendingCount > 0 && (
                <Link
                  href="/admin/bookings"
                  className="group rounded-2xl border-2 border-warning/40 bg-warning/5 p-5 transition-colors hover:border-warning/60 hover:bg-warning/10"
                >
                  <div className="flex items-start gap-3">
                    <div className="rounded-xl bg-warning/15 p-2.5">
                      <Clock size={20} className="text-warning" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="font-semibold text-warning">
                        {pendingCount} حجوزات بانتظار التأكيد
                      </p>
                      <p className="mt-1 text-xs text-muted">
                        {pendingCount} pending bookings
                      </p>
                      {pendingBookings.length > 0 && (
                        <div className="mt-3 space-y-1.5">
                          {pendingBookings.map((b) => (
                            <p key={b.id} className="text-xs text-muted">
                              {nameMap[b.student_id] ?? "طالب"} مع{" "}
                              {nameMap[b.teacher_id] ?? "معلم"} &mdash;{" "}
                              {formatDate(b.scheduled_at)}
                            </p>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                  <p className="mt-3 text-xs font-medium text-warning/80 group-hover:text-warning">
                    عرض الحجوزات المعلقة &larr;
                  </p>
                </Link>
              )}

              {/* New students alert */}
              {newStudentCount > 0 && (
                <Link
                  href="/admin/users"
                  className="group rounded-2xl border-2 border-gold/30 bg-gold/5 p-5 transition-colors hover:border-gold/50 hover:bg-gold/10"
                >
                  <div className="flex items-start gap-3">
                    <div className="rounded-xl bg-gold/15 p-2.5">
                      <UserPlus size={20} className="text-gold" />
                    </div>
                    <div>
                      <p className="font-semibold text-gold">
                        {newStudentCount} طلاب جدد هذا الأسبوع
                      </p>
                      <p className="mt-1 text-xs text-muted">
                        {newStudentCount} new students this week
                      </p>
                    </div>
                  </div>
                  <p className="mt-3 text-xs font-medium text-gold/80 group-hover:text-gold">
                    عرض الطلاب &larr;
                  </p>
                </Link>
              )}
            </div>
          </div>
        )}

        {/* ═══════ Section 2 — Stats Row ═══════ */}
        <div className="mt-8 grid grid-cols-2 gap-3 md:grid-cols-4 md:gap-4">
          {[
            {
              icon: Users,
              label: "الطلاب",
              value: studentCount,
              en: "Total students",
            },
            {
              icon: GraduationCap,
              label: "المعلمون",
              value: teacherList.length,
              en: "Teachers",
            },
            {
              icon: BookOpen,
              label: "حجوزات الشهر",
              value: bookingsMonth,
              en: "Bookings this month",
            },
            {
              icon: DollarSign,
              label: "إيرادات الشهر",
              value: `$${revenueMonth.toFixed(2)}`,
              en: "Revenue this month",
            },
          ].map((s) => (
            <div
              key={s.en}
              className="rounded-2xl border border-card-border bg-card elevation-2 p-5"
            >
              <div className="flex items-center gap-2 text-sm text-muted">
                <s.icon size={16} />
                {s.label}
              </div>
              <p className="mt-1 text-2xl font-bold text-gold">{s.value}</p>
              <p className="mt-1 text-xs text-muted">{s.en}</p>
            </div>
          ))}
        </div>

        {/* ═══════ Section 3 — Today's Activity ═══════ */}
        <div className="mt-10">
          <h2 className="mb-4 flex items-center gap-2 text-lg font-semibold">
            <CalendarDays size={20} className="text-gold" />
            نشاط اليوم
            <span className="text-sm font-normal text-muted">
              Today&apos;s activity
            </span>
          </h2>

          {todayBookings.length === 0 ? (
            <div className="rounded-2xl border border-card-border bg-card elevation-2 p-8 text-center">
              <CalendarDays size={28} className="mx-auto mb-3 text-muted" />
              <p className="text-muted">لا توجد حجوزات اليوم</p>
              <p className="mt-1 text-xs text-muted">No bookings today</p>
            </div>
          ) : (
            <div className="space-y-2">
              {todayBookings.map((b) => (
                <div
                  key={b.id}
                  className="flex items-center gap-4 rounded-xl border border-card-border bg-card p-4"
                >
                  {/* Time badge */}
                  <div className="flex min-w-[4.5rem] flex-col items-center rounded-lg bg-gold/10 px-3 py-2">
                    <span className="text-sm font-bold text-gold">
                      {formatTime(b.scheduled_at)}
                    </span>
                    <span className="text-[10px] text-muted">
                      {b.duration_min} د
                    </span>
                  </div>

                  {/* Details */}
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium">
                      {nameMap[b.student_id] ?? "طالب"}{" "}
                      <span className="text-muted">مع</span>{" "}
                      {nameMap[b.teacher_id] ?? "معلم"}
                    </p>
                    <p className="mt-0.5 text-xs text-muted">
                      {b.session_type}
                    </p>
                  </div>

                  {/* Status chip */}
                  <span
                    className={`rounded-full border px-2 py-0.5 text-xs ${
                      b.status === "confirmed"
                        ? "border-success/30 bg-success/10 text-success"
                        : b.status === "pending"
                          ? "border-warning/30 bg-warning/10 text-warning"
                          : "border-muted/30 bg-muted/10 text-muted"
                    }`}
                  >
                    {b.status === "confirmed"
                      ? "مؤكد"
                      : b.status === "pending"
                        ? "معلق"
                        : b.status}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* ═══════ Section 3.5 — Active Sessions ═══════ */}
        {activeSessionCount > 0 && (
          <div className="mt-6">
            <Link
              href="/admin/sessions/live"
              className="group flex items-center gap-4 rounded-2xl border-2 border-emerald-500/30 bg-emerald-500/5 p-5 transition-colors hover:border-emerald-500/50 hover:bg-emerald-500/10"
            >
              <div className="rounded-xl bg-emerald-500/15 p-3">
                <Radio size={24} className="animate-pulse text-emerald-400" />
              </div>
              <div>
                <p className="text-lg font-bold text-emerald-400">
                  {activeSessionCount} جلسات نشطة الآن
                </p>
                <p className="mt-0.5 text-sm text-muted">
                  {activeSessionCount} active sessions — click to monitor
                </p>
              </div>
              <span className="mr-auto text-sm font-medium text-emerald-400/80 group-hover:text-emerald-400">
                المراقبة المباشرة &larr;
              </span>
            </Link>
          </div>
        )}

        {/* ═══════ Section 4 — Quick Actions ═══════ */}
        <div className="mt-10">
          <h2 className="mb-4 text-lg font-semibold">إجراءات سريعة</h2>
          <div className="flex flex-wrap gap-3">
            <Link
              href="/admin/teachers/new"
              className="neu-btn inline-flex items-center gap-2 rounded-xl bg-gold px-5 py-2.5 text-sm font-semibold text-background transition-colors hover:bg-gold-hover"
            >
              <Plus size={16} />
              إضافة معلم
            </Link>
            <Link
              href="/admin/notifications"
              className="neu-btn inline-flex items-center gap-2 rounded-xl border border-card-border px-5 py-2.5 text-sm font-medium text-foreground transition-colors hover:bg-surface-alt"
            >
              <Bell size={16} />
              إرسال إشعار
            </Link>
            <Link
              href="/admin/bookings"
              className="neu-btn inline-flex items-center gap-2 rounded-xl border border-card-border px-5 py-2.5 text-sm font-medium text-foreground transition-colors hover:bg-surface-alt"
            >
              <BookOpen size={16} />
              عرض الحجوزات
            </Link>
            <Link
              href="/admin/sessions"
              className="neu-btn inline-flex items-center gap-2 rounded-xl border border-card-border px-5 py-2.5 text-sm font-medium text-foreground transition-colors hover:bg-surface-alt"
            >
              <Video size={16} />
              الجلسات
            </Link>
          </div>
        </div>

        {/* ═══════ Section 5 — Teacher Management ═══════ */}
        <div className="mt-10">
          <h2 className="mb-4 flex items-center gap-2 text-lg font-semibold">
            <GraduationCap size={20} className="text-gold" />
            إدارة المعلمين
            <span className="text-sm font-normal text-muted">
              {teacherList.length} معلم
            </span>
          </h2>

          {teacherList.length === 0 ? (
            <div className="rounded-2xl border border-card-border bg-card elevation-2 p-8 text-center">
              <GraduationCap size={28} className="mx-auto mb-3 text-muted" />
              <p className="text-muted">لا يوجد معلمون بعد</p>
            </div>
          ) : (
            <div className="space-y-3">
              {teacherList.map((teacher) => (
                <div
                  key={teacher.teacher_id}
                  className={`rounded-xl border bg-card p-4 ${
                    teacher.is_archived
                      ? "border-error/20 opacity-60"
                      : "border-card-border"
                  }`}
                >
                  <div className="flex items-center justify-between gap-4">
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="font-medium">
                          {nameMap[teacher.teacher_id] ?? "معلم"}
                        </p>
                        {teacher.is_archived && (
                          <span className="rounded-full border border-error/30 bg-error/10 px-2 py-0.5 text-xs text-error">
                            مؤرشف
                          </span>
                        )}
                        {!teacher.is_archived && teacher.is_accepting && (
                          <span className="rounded-full border border-success/30 bg-success/10 px-2 py-0.5 text-xs text-success">
                            يقبل طلاب
                          </span>
                        )}
                        {!teacher.is_archived && !teacher.is_accepting && (
                          <span className="rounded-full border border-primary/30 bg-primary/10 px-2 py-0.5 text-xs text-foreground">
                            مشغول
                          </span>
                        )}
                      </div>
                      <p className="mt-1 text-sm text-muted">
                        ${teacher.hourly_rate}/ساعة
                        <span className="mx-2">&middot;</span>
                        {teacher.total_sessions} جلسة
                        <span className="mx-2">&middot;</span>
                        تقييم{" "}
                        {Number(teacher.rating_avg) > 0
                          ? Number(teacher.rating_avg).toFixed(1)
                          : "—"}
                      </p>
                    </div>
                    <ArchiveToggle
                      teacherId={teacher.teacher_id}
                      isArchived={teacher.is_archived}
                    />
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
