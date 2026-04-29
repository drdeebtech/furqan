"use client";

import Link from "next/link";
import { Calendar, Clock, Hourglass, Star, Users, type LucideIcon } from "lucide-react";
import { useLang } from "@/lib/i18n/context";
import { SESSION_TYPE_BILINGUAL } from "@/lib/constants";
import { WidgetCard } from "@/components/shared/widget-card";
import { AnalyticsChart } from "@/components/shared/analytics-chart";
import { LiveSessionsWidget } from "@/components/shared/live-sessions-widget";
import { BreakdownBar } from "@/components/shared/breakdown-bar";
import { DataTable } from "@/components/shared/data-table";
import { BookingActions } from "./booking-actions";
import { TeacherSessionCard } from "./teacher-session-card";
import { TeacherGuidanceBanner } from "./guidance-banner";
import { TeacherQuickActions } from "./quick-actions";
import { TeacherActionQueue } from "./action-queue";

interface SessionData { id: string; room_url: string; expires_at: string | null; started_at: string | null; ended_at: string | null }
import type { SessionType } from "@/types/database";
interface PendingBooking { id: string; scheduled_at: string; duration_min: number; session_type: SessionType; amount_usd: number; student_id: string }

interface TeacherDashboardData {
  fullName: string | null;
  cvStatus: "draft" | "pending_review" | "approved" | "rejected";
  hasProfile: boolean;
  hasBio: boolean;
  hasAvailability: boolean;
  uniqueStudents: number;
  monthSessions: number;
  pendingCount: number;
  ratingAvg: number;
  todaySessions: PendingBooking[];
  pending: PendingBooking[];
  sessionDataMap: Record<string, SessionData>;
  nameMap: Record<string, string>;
  weeklyHours: { day: string; value: number; isActive: boolean }[];
  liveSessions: { id: string; title: string; subtitle: string; initials: string; timeRemaining?: string; progressPercent?: number }[];
  sessionBreakdown: { label: string; value: number; color: string }[];
  recentStudents: { id: string; [key: string]: unknown }[];
  actionQueue: { pendingGrading: number; overdueEvals: number; unreadMessages: number; todaySessionCount: number; lowAvailability: boolean };
}

function StatInline({
  href,
  icon: Icon,
  label,
  value,
  accent,
}: {
  href: string;
  icon: LucideIcon;
  label: string;
  value: number | string;
  accent?: boolean;
}) {
  return (
    <Link
      href={href}
      className="group flex items-center gap-3 rounded-lg p-1 transition-colors hover:bg-foreground/5"
    >
      <Icon size={18} className={accent ? "text-gold" : "text-muted"} aria-hidden="true" />
      <div className="min-w-0 flex-1">
        <dt className="truncate text-xs text-muted">{label}</dt>
        <dd className={`font-display text-lg font-bold leading-tight ${accent ? "text-gold" : ""}`}>
          {value}
        </dd>
      </div>
    </Link>
  );
}

export function TeacherDashboardContent({ data }: { data: TeacherDashboardData }) {
  const { t, dir, lang } = useLang();
  const locale = lang === "ar" ? "ar" : "en-US";
  const { fullName, cvStatus, hasProfile, hasBio, hasAvailability, uniqueStudents, monthSessions, pendingCount, ratingAvg, todaySessions, pending, sessionDataMap, nameMap, weeklyHours, liveSessions, sessionBreakdown, recentStudents, actionQueue } = data;

  const st = (type: string) => {
    const s = SESSION_TYPE_BILINGUAL[type as SessionType];
    return s ? t(s.ar, s.en) : type;
  };

  return (
    <div dir={dir} className="mx-auto max-w-7xl px-4 py-8 sm:px-6">
        {/* Row 0: Welcome + Banner */}
        <h1 className="font-display text-2xl font-bold sm:text-3xl">{t("أهلاً", "Welcome")}{fullName ? ` ${fullName}` : ""}</h1>
        <p className="mt-1 text-sm text-muted">{t("مرحباً بك في لوحة المعلم", "Welcome to the Teacher Dashboard")}</p>

        <TeacherGuidanceBanner cvStatus={cvStatus} hasStudents={uniqueStudents > 0} hasProfile={hasProfile} hasBio={hasBio} hasAvailability={hasAvailability} />

        {/* Action Queue — shows only when there are pending actions */}
        {cvStatus === "approved" && <div className="mt-4"><TeacherActionQueue data={actionQueue} /></div>}

        {/* Row 1: tight stat row — distilled from a 4-card hero grid into a single
            info bar. Same data, less "AI dashboard silhouette". */}
        <div className="mt-6 glass-card p-4 sm:p-5">
          <dl className="grid grid-cols-2 gap-x-6 gap-y-4 text-sm md:grid-cols-4">
            <StatInline href="/teacher/students" icon={Users} label={t("طلابي", "My Students")} value={uniqueStudents} accent={uniqueStudents > 0} />
            <StatInline href="/teacher/sessions" icon={Calendar} label={t("جلسات هذا الشهر", "This Month")} value={monthSessions} />
            <StatInline href="#pending" icon={Hourglass} label={t("طلبات معلّقة", "Pending")} value={pendingCount} accent={pendingCount > 0} />
            <StatInline href="/teacher/evaluations" icon={Star} label={t("التقييم", "Rating")} value={ratingAvg > 0 ? ratingAvg.toFixed(1) : "—"} />
          </dl>
        </div>

        {/* Row 2: Analytics chart + Right widgets */}
        <div className="mt-6 grid grid-cols-1 gap-4 lg:grid-cols-5">
          <div className="lg:col-span-3">
            <WidgetCard title={t("ساعات التدريس", "Teaching Hours")}>
              <AnalyticsChart data={weeklyHours} title={t("ساعات التدريس", "Teaching Hours")} />
            </WidgetCard>
          </div>
          <div className="space-y-4 lg:col-span-2">
            <LiveSessionsWidget
              sessions={liveSessions}
              title={t("الجلسات المباشرة", "Live Sessions")}
              ongoingCount={liveSessions.length}
            />
            <BreakdownBar
              title={t("توزيع الجلسات", "Session Types")}
              segments={sessionBreakdown}
              emptyMessage={t("لا توجد جلسات في آخر 30 يوم", "No sessions in the last 30 days")}
            />
          </div>
        </div>

        {/* Row 3: Recent Students data table */}
        <div className="mt-6">
          <DataTable
            title={t("آخر الطلاب", "Recent Students")}
            columns={[
              { key: "id", label: t("رقم", "Id") },
              { key: "subject", label: t("النوع", "Subject") },
              { key: "date", label: t("آخر جلسة", "Last Session"), type: "date" },
              { key: "progress", label: t("الحصص", "Sessions"), type: "progress" },
              { key: "assignee", label: t("الطالب", "Student"), type: "assignee" },
              { key: "view", label: t("عرض", "View"), type: "actions" },
            ]}
            rows={recentStudents as { id: string; [key: string]: unknown }[]}
            emptyMessage={t("لا يوجد طلاب بعد", "No students yet")}
          />
        </div>

        {/* Row 4: Today's Sessions + Quick Actions */}
        <div className="mt-6 grid grid-cols-1 gap-4 lg:grid-cols-5">
          <div className="lg:col-span-3">
            {todaySessions.length > 0 ? (
              <WidgetCard title={t("جلسات اليوم", "Today's Sessions")}>
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
              </WidgetCard>
            ) : (
              <WidgetCard title={t("جلسات اليوم", "Today's Sessions")}>
                <div className="flex min-h-[120px] items-center justify-center text-center">
                  <div>
                    <Calendar size={28} className="mx-auto mb-3 text-muted" />
                    <p className="text-sm text-muted">{t("لا توجد جلسات اليوم", "No sessions today")}</p>
                  </div>
                </div>
              </WidgetCard>
            )}
          </div>
          <div className="lg:col-span-2">
            <TeacherQuickActions students={Object.entries(nameMap).map(([id, name]) => ({ id, name }))} />
          </div>
        </div>

        {/* Row 5: Pending Bookings */}
        <div id="pending" className="mt-6">
          <WidgetCard title={t("حجوزات بانتظار التأكيد", "Pending Bookings")}>
            {uniqueStudents === 0 && pending.length > 0 && (
              <div className="glass glass-pill mb-3 p-3 text-center text-sm text-gold">
                {t("لديك حجز جديد! اضغط تأكيد لقبول الطالب", "You have a new booking! Tap Confirm to accept.")}
              </div>
            )}
            {pending.length === 0 ? (
              <div className="flex min-h-[120px] items-center justify-center text-center">
                <div>
                  <Clock size={24} className="mx-auto mb-2 text-muted" />
                  <p className="text-sm text-muted">{t("لا توجد حجوزات معلقة", "No pending bookings")}</p>
                </div>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-[var(--surface-border)] text-xs text-muted-light">
                      <th className="pb-2 text-start font-medium">{t("الطالب", "Student")}</th>
                      <th className="pb-2 text-start font-medium">{t("النوع", "Type")}</th>
                      <th className="pb-2 text-start font-medium">{t("الموعد", "Date")}</th>
                      <th className="pb-2 text-end font-medium">{t("إجراء", "Action")}</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[var(--surface-divider,#F0F0F2)]">
                    {pending.map(b => (
                      <tr key={b.id}>
                        <td className="py-3 font-medium">{nameMap[b.student_id] ?? t("طالب", "Student")}</td>
                        <td className="py-3 text-muted">{st(b.session_type)} <span aria-hidden="true">·</span> {b.duration_min} {t("د", "m")}</td>
                        <td className="py-3 text-muted">
                          {new Date(b.scheduled_at).toLocaleDateString(locale, { month: "short", day: "numeric" })}
                          {" "}
                          {new Date(b.scheduled_at).toLocaleTimeString(locale, { hour: "2-digit", minute: "2-digit" })}
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
          </WidgetCard>
        </div>
      </div>
  );
}
