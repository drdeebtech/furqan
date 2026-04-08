"use client";

import { Calendar, Clock, Hourglass, Star, Users } from "lucide-react";
import { useLang } from "@/lib/i18n/context";
import { StatCard } from "@/components/shared/stat-card";
import { BookingActions } from "./booking-actions";
import { TeacherSessionCard } from "./teacher-session-card";
import { TeacherGuidanceBanner } from "./guidance-banner";
import { TeacherQuickActions } from "./quick-actions";

const SESSION_TYPE: Record<string, { ar: string; en: string }> = {
  hifz: { ar: "حفظ", en: "Hifz" }, muraja: { ar: "مراجعة", en: "Muraja'a" },
  tajweed: { ar: "تجويد", en: "Tajweed" }, tilawa: { ar: "تلاوة", en: "Tilawa" },
  qiraat: { ar: "قراءات", en: "Qira'at" }, tafsir: { ar: "تفسير", en: "Tafsir" },
  combined: { ar: "حفظ + مراجعة", en: "Hifz + Muraja'a" }, other: { ar: "أخرى", en: "Other" },
};

interface SessionData { id: string; room_url: string; expires_at: string | null; started_at: string | null; ended_at: string | null }
import type { SessionType } from "@/types/database";
interface PendingBooking { id: string; scheduled_at: string; duration_min: number; session_type: SessionType; amount_usd: number; student_id: string }

interface TeacherDashboardData {
  fullName: string | null;
  cvStatus: "draft" | "pending_review" | "approved" | "rejected";
  uniqueStudents: number;
  monthSessions: number;
  pendingCount: number;
  ratingAvg: number;
  todaySessions: PendingBooking[];
  pending: PendingBooking[];
  sessionDataMap: Record<string, SessionData>;
  nameMap: Record<string, string>;
}

export function TeacherDashboardContent({ data }: { data: TeacherDashboardData }) {
  const { t, dir } = useLang();
  const { fullName, cvStatus, uniqueStudents, monthSessions, pendingCount, ratingAvg, todaySessions, pending, sessionDataMap, nameMap } = data;

  const st = (type: string) => { const s = SESSION_TYPE[type]; return s ? t(s.ar, s.en) : type; };

  return (
    <>
      <div className="h-0.5 bg-gradient-to-l from-gold/0 via-gold/30 to-gold/0" />
      <div dir={dir} className="mx-auto max-w-6xl px-4 py-8 sm:px-6">
        {/* Row 0: Welcome + Banner */}
        <h1 className="text-2xl font-bold">{t("أهلاً", "Welcome")}{fullName ? ` ${fullName}` : ""}</h1>
        <p className="mt-1 text-sm text-muted">{t("مرحباً بك في لوحة المعلم", "Welcome to the Teacher Dashboard")}</p>

        <TeacherGuidanceBanner cvStatus={cvStatus} hasStudents={uniqueStudents > 0} />

        {/* Row 1: 4 Stat Cards */}
        <div className="mt-6 grid grid-cols-2 gap-3 md:grid-cols-4">
          <StatCard icon={Users} label={t("طلابي", "My Students")} value={uniqueStudents} href="/teacher/students" />
          <StatCard icon={Calendar} label={t("جلسات هذا الشهر", "This Month")} value={monthSessions} href="/teacher/sessions" />
          <StatCard icon={Hourglass} label={t("طلبات معلّقة", "Pending Requests")} value={pendingCount} href="#pending" />
          <StatCard icon={Star} label={t("التقييم", "Rating")} value={ratingAvg > 0 ? ratingAvg.toFixed(1) : "—"} href="/teacher/evaluations" />
        </div>

        {/* Row 2: Two-column layout */}
        <div className="mt-6 grid grid-cols-1 gap-4 lg:grid-cols-5">
          {/* Left: Today's Sessions */}
          <div className="lg:col-span-3">
            {todaySessions.length > 0 ? (
              <div className="glass-card p-4 sm:p-5">
                <h2 className="mb-4 flex items-center gap-2 text-base font-semibold">
                  <Calendar size={18} className="text-gold" /> {t("جلسات اليوم", "Today's Sessions")}
                </h2>
                <div className="space-y-3">
                  {todaySessions.map(b => {
                    const sess = sessionDataMap[b.id];
                    return (
                      <TeacherSessionCard
                        key={b.id}
                        sessionId={sess?.id ?? null}
                        bookingId={b.id}
                        studentName={nameMap[b.student_id] ?? t("طالب", "Student")}
                        sessionType={b.session_type}
                        scheduledAt={b.scheduled_at}
                        durationMin={b.duration_min}
                        roomUrl={sess?.room_url ?? null}
                        expiresAt={sess?.expires_at ?? null}
                        startedAt={sess?.started_at ?? null}
                        endedAt={sess?.ended_at ?? null}
                      />
                    );
                  })}
                </div>
              </div>
            ) : (
              <div className="glass-card flex min-h-[200px] items-center justify-center p-5 text-center">
                <div>
                  <Calendar size={28} className="mx-auto mb-3 text-muted" />
                  <p className="text-sm text-muted">{t("لا توجد جلسات اليوم", "No sessions today")}</p>
                </div>
              </div>
            )}
          </div>

          {/* Right: Quick Actions */}
          <div className="lg:col-span-2">
            <TeacherQuickActions students={Object.entries(nameMap).map(([id, name]) => ({ id, name }))} />
          </div>
        </div>

        {/* Row 3: Pending Bookings */}
        <div id="pending" className="mt-6 glass-card p-4 sm:p-5">
          <h2 className="mb-4 flex items-center gap-2 text-base font-semibold">
            <Clock size={18} className="text-gold" /> {t("حجوزات بانتظار التأكيد", "Pending Bookings")}
          </h2>
          {uniqueStudents === 0 && pending.length > 0 && (
            <div className="glass glass-pill mb-3 p-3 text-center text-sm text-gold">
              {t("🎉 لديك حجز جديد! اضغط تأكيد لقبول الطالب", "🎉 You have a new booking! Tap Confirm to accept.")}
            </div>
          )}
          {pending.length === 0 ? (
            <div className="py-6 text-center">
              <Clock size={24} className="mx-auto mb-2 text-muted" />
              <p className="text-sm text-muted">{t("لا توجد حجوزات معلقة", "No pending bookings")}</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-white/10 text-xs text-muted">
                    <th className="pb-2 text-start font-medium">{t("الطالب", "Student")}</th>
                    <th className="pb-2 text-start font-medium">{t("النوع", "Type")}</th>
                    <th className="pb-2 text-start font-medium">{t("الموعد", "Date")}</th>
                    <th className="pb-2 text-end font-medium">{t("إجراء", "Action")}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-white/5">
                  {pending.map(b => (
                    <tr key={b.id}>
                      <td className="py-3 font-medium">{nameMap[b.student_id] ?? t("طالب", "Student")}</td>
                      <td className="py-3 text-muted">{st(b.session_type)} · {b.duration_min} {t("د", "m")}</td>
                      <td className="py-3 text-muted">
                        {new Date(b.scheduled_at).toLocaleDateString("ar-SA", { month: "short", day: "numeric" })}
                        {" "}
                        {new Date(b.scheduled_at).toLocaleTimeString("ar-SA", { hour: "2-digit", minute: "2-digit" })}
                      </td>
                      <td className="py-3 text-end">
                        <BookingActions bookingId={b.id} isFirst={uniqueStudents === 0} />
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
