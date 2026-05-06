"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { Calendar, Clock, Hourglass, Keyboard, RefreshCw, Star, Users, type LucideIcon } from "lucide-react";
import { useLang } from "@/lib/i18n/context";
import { useToast } from "@/components/shared/toast";
import { SESSION_TYPE_BILINGUAL } from "@/lib/constants";
import { WidgetCard } from "@/components/shared/widget-card";
import { AnalyticsChart } from "@/components/shared/analytics-chart";
import { LiveSessionsWidget } from "@/components/shared/live-sessions-widget";
import { BreakdownBar } from "@/components/shared/breakdown-bar";
import { DataTable } from "@/components/shared/data-table";
import { ShortcutsHelp } from "@/components/shared/shortcuts-help";
import { SectionErrorBoundary } from "@/components/shared/section-error-boundary";
import { useKeyboardShortcuts, useShortcutsHelp, type Shortcut } from "@/lib/hooks/use-keyboard-shortcuts";
import { useNowTicker } from "@/lib/hooks/use-now-ticker";
import { BookingActions } from "./booking-actions";
import { TeacherSessionCard } from "./teacher-session-card";
import { TeacherGuidanceBanner } from "./guidance-banner";
import { TeacherQuickActions } from "./quick-actions";
import { TeacherActionQueue } from "./action-queue";
import { TeacherWelcomeHeader } from "./welcome-header";
import { TeacherNextActionBanner } from "./next-action-banner";

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
  /** Sprint #4 (2026-05-05): teacher's own grading discipline. nulls when
   *  the sample is too small (< 3 graded follow-ups in 30 days). */
  timeToGrade: { medianHours: number | null; p90Hours: number | null; sampleSize: number };
}

function StatInline({
  href, icon: Icon, label, value, accent,
}: {
  href: string; icon: LucideIcon; label: string; value: number | string; accent?: boolean;
}) {
  return (
    <Link href={href} className="group flex items-center gap-3 rounded-lg p-1 transition-colors hover:bg-foreground/5 focus-ring">
      <Icon size={18} className={accent ? "text-gold" : "text-muted"} aria-hidden="true" />
      <div className="min-w-0 flex-1">
        <dt className="truncate text-xs text-muted">{label}</dt>
        <dd className={`font-display text-lg font-bold leading-tight ${accent ? "text-gold" : ""}`}>{value}</dd>
      </div>
    </Link>
  );
}

export function TeacherDashboardContent({ data }: { data: TeacherDashboardData }) {
  const { t, dir, lang } = useLang();
  const toast = useToast();
  const locale = lang === "ar" ? "ar" : "en-US";
  const {
    fullName, cvStatus, hasProfile, hasBio, hasAvailability, uniqueStudents,
    monthSessions, pendingCount, ratingAvg, todaySessions, pending, sessionDataMap,
    nameMap, weeklyHours, liveSessions, sessionBreakdown, recentStudents, actionQueue,
    timeToGrade,
  } = data;

  // Live ticker — shared useNowTicker pauses while tab is hidden.
  const now = useNowTicker().getTime();

  // Greeting context.
  const firstName = fullName ? fullName.split(" ")[0] : null;
  const weekday = new Date(now).toLocaleDateString(locale, { weekday: "long" });

  // Imminent session — first today's session inside the 30-min window.
  const imminentSession = useMemo(() => {
    const candidate = todaySessions
      .map(b => ({ booking: b, sess: sessionDataMap[b.id] }))
      .filter(({ booking, sess }) => sess && !sess.ended_at && new Date(booking.scheduled_at).getTime() - now <= 30 * 60_000)
      .sort((a, b) => new Date(a.booking.scheduled_at).getTime() - new Date(b.booking.scheduled_at).getTime())[0];
    if (!candidate) return null;
    return {
      sessionId: candidate.sess.id,
      bookingId: candidate.booking.id,
      scheduledAt: candidate.booking.scheduled_at,
      studentName: nameMap[candidate.booking.student_id] ?? null,
    };
  }, [todaySessions, sessionDataMap, nameMap, now]);

  // Keyboard shortcuts.
  const [helpOpen, setHelpOpen] = useShortcutsHelp();
  const shortcuts: Shortcut[] = useMemo(() => [
    {
      combo: "j",
      description: { ar: "افتح الجلسة الحالية", en: "Open current session" },
      group: { ar: "إجراءات", en: "Actions" },
      onTrigger: () => {
        if (imminentSession?.sessionId) window.location.assign(`/teacher/sessions/${imminentSession.sessionId}`);
        else toast.info(t("لا توجد جلسة وشيكة", "No imminent session"));
      },
    },
    {
      combo: "c",
      description: { ar: "راجع الحجوزات المعلقة", en: "Review pending bookings" },
      group: { ar: "إجراءات", en: "Actions" },
      onTrigger: () => {
        if (pending.length > 0) {
          const target = document.getElementById("pending");
          if (target) target.scrollIntoView({ behavior: "smooth" });
          else window.location.assign("/teacher/dashboard#pending");
        } else {
          toast.info(t("لا حجوزات معلقة", "No pending bookings"));
        }
      },
    },
    { combo: "g d", description: { ar: "اللوحة", en: "Dashboard" }, group: { ar: "تنقل", en: "Navigate" }, href: "/teacher/dashboard" },
    { combo: "g a", description: { ar: "المواعيد", en: "Availability" }, group: { ar: "تنقل", en: "Navigate" }, href: "/teacher/availability" },
    { combo: "g s", description: { ar: "الجلسات", en: "Sessions" }, group: { ar: "تنقل", en: "Navigate" }, href: "/teacher/sessions" },
    { combo: "g t", description: { ar: "الطلاب", en: "Students" }, group: { ar: "تنقل", en: "Navigate" }, href: "/teacher/students" },
    { combo: "g h", description: { ar: "المتابعة", en: "Follow-up" }, group: { ar: "تنقل", en: "Navigate" }, href: "/teacher/follow-up" },
    { combo: "g c", description: { ar: "الدورات المسجلة", en: "Recorded courses" }, group: { ar: "تنقل", en: "Navigate" }, href: "/teacher/courses" },
    { combo: "g e", description: { ar: "التقييمات", en: "Evaluations" }, group: { ar: "تنقل", en: "Navigate" }, href: "/teacher/evaluations" },
    { combo: "g v", description: { ar: "السيرة الذاتية", en: "My CV" }, group: { ar: "تنقل", en: "Navigate" }, href: "/teacher/cv" },
    { combo: "g m", description: { ar: "الرسائل", en: "Messages" }, group: { ar: "تنقل", en: "Navigate" }, href: "/teacher/messages" },
    { combo: "?", description: { ar: "إظهار الاختصارات", en: "Show shortcuts" }, group: { ar: "مساعدة", en: "Help" }, onTrigger: () => setHelpOpen(true) },
  ], [imminentSession, pending.length, toast, t, setHelpOpen]);
  useKeyboardShortcuts(shortcuts, true);

  const [lastRefreshAt] = useState(() => new Date());
  const lastRefreshLabel = lastRefreshAt.toLocaleTimeString(locale, { hour: "2-digit", minute: "2-digit" });
  const refresh = () => window.location.reload();

  const st = (type: string) => {
    const s = SESSION_TYPE_BILINGUAL[type as SessionType];
    return s ? t(s.ar, s.en) : type;
  };

  return (
    <>
      <a
        href="#teacher-main"
        className="sr-only focus:not-sr-only focus:absolute focus:start-4 focus:top-4 focus:z-[200] focus:rounded focus:bg-gold focus:px-3 focus:py-2 focus:text-sm focus:font-medium focus:text-background"
      >
        {t("تخطي إلى المحتوى", "Skip to main content")}
      </a>

      <div dir={dir} className="mx-auto max-w-7xl px-4 py-8 sm:px-6" id="teacher-main">
        <TeacherWelcomeHeader
          firstName={firstName}
          weekday={weekday}
          todaySessionCount={todaySessions.length}
          uniqueStudents={uniqueStudents}
          ratingAvg={ratingAvg}
          cvStatus={cvStatus}
        />

        {/* Smart next-action banner — covers CV, availability, imminent session,
            pending confirmations, ungraded homework, unread messages. */}
        <SectionErrorBoundary fallbackLabel={t("تعذّر تحميل الإجراء التالي", "Couldn't load the next action")}>
          <section aria-label={t("الإجراء التالي", "Next action")} className="mb-6">
            <TeacherNextActionBanner
              data={{
                cvStatus,
                imminentSession,
                pendingBookings: pendingCount,
                ungradedHomework: actionQueue.pendingGrading,
                unreadMessages: actionQueue.unreadMessages,
                hasAvailability,
              }}
            />
          </section>
        </SectionErrorBoundary>

        {/* Guidance banner — kept in case CV is approved but other onboarding
            steps remain. Hidden when not relevant. */}
        <TeacherGuidanceBanner cvStatus={cvStatus} hasStudents={uniqueStudents > 0} hasProfile={hasProfile} hasBio={hasBio} hasAvailability={hasAvailability} />

        {cvStatus === "approved" && (
          <SectionErrorBoundary fallbackLabel={t("تعذّر تحميل قائمة المهام", "Couldn't load action queue")}>
            <div className="mt-4"><TeacherActionQueue data={actionQueue} /></div>
          </SectionErrorBoundary>
        )}

        {/* Stat row — distilled. */}
        <SectionErrorBoundary fallbackLabel={t("تعذّر تحميل المؤشرات", "Couldn't load stats")}>
          <section aria-label={t("مؤشرات سريعة", "Key stats")} className="mt-6 glass-card p-4 sm:p-5">
            <dl className="grid grid-cols-2 gap-x-6 gap-y-4 text-sm md:grid-cols-4">
              <StatInline href="/teacher/students" icon={Users} label={t("طلابي", "My Students")} value={uniqueStudents} accent={uniqueStudents > 0} />
              <StatInline href="/teacher/sessions" icon={Calendar} label={t("جلسات هذا الشهر", "This Month")} value={monthSessions} />
              <StatInline href="#pending" icon={Hourglass} label={t("طلبات معلّقة", "Pending")} value={pendingCount} accent={pendingCount > 0} />
              <StatInline href="/teacher/evaluations" icon={Star} label={t("التقييم", "Rating")} value={ratingAvg > 0 ? ratingAvg.toFixed(1) : "—"} />
            </dl>
          </section>
        </SectionErrorBoundary>

        {/* Discipline KPI — Sprint Improvement #4 (2026-05-05).
            Surfaces the teacher's own grading responsiveness as a public-
            to-themselves metric. Mirrors the accountability the eval-
            discipline gate enforces, but as a positive signal (not a
            block). Thresholds: green ≤ 24h, amber ≤ 72h, red beyond. */}
        <SectionErrorBoundary fallbackLabel={t("تعذّر تحميل مؤشر الانضباط", "Couldn't load discipline metric")}>
          <section aria-label={t("سرعة التقييم", "Grading discipline")} className="mt-4 glass-card p-4 sm:p-5">
            {timeToGrade.medianHours == null ? (
              <div className="flex items-center gap-3">
                <Clock size={18} className="text-muted" aria-hidden="true" />
                <div className="min-w-0 flex-1">
                  <p className="text-xs text-muted">
                    {t("متوسط وقت التقييم هذا الشهر", "Median time-to-grade this month")}
                  </p>
                  <p className="font-display text-sm text-muted">
                    {t(
                      `لم تُقيّم سوى ${timeToGrade.sampleSize} متابعة في آخر 30 يوماً — يلزم 3 على الأقل.`,
                      `Only ${timeToGrade.sampleSize} graded in the last 30 days — need 3+ to compute.`,
                    )}
                  </p>
                </div>
              </div>
            ) : (() => {
              const median = timeToGrade.medianHours;
              const tier = median <= 24 ? "success" : median <= 72 ? "warning" : "error";
              const tierClasses: Record<typeof tier, string> = {
                success: "border-success/40 bg-success/10 text-success",
                warning: "border-warning/40 bg-warning/10 text-warning",
                error: "border-error/40 bg-error/10 text-error",
              };
              const verdict =
                tier === "success"
                  ? t("ممتاز — استجابة سريعة", "Excellent — fast turnaround")
                  : tier === "warning"
                    ? t("جيد — مع إمكانية التحسين", "Good — room to improve")
                    : t("بطيء — حاول التقييم خلال 24 ساعة", "Slow — aim to grade within 24h");
              const labelMedian = lang === "ar" ? `${median} ساعة` : `${median}h`;
              const labelP90 = lang === "ar" ? `${timeToGrade.p90Hours} ساعة` : `${timeToGrade.p90Hours}h`;
              return (
                <div className="flex flex-wrap items-center gap-3">
                  <Clock size={18} className="text-muted" aria-hidden="true" />
                  <div className="min-w-0 flex-1">
                    <p className="text-xs text-muted">
                      {t("متوسط وقت التقييم (30 يوماً)", "Median time-to-grade (last 30 days)")}
                    </p>
                    <p className="font-display text-lg font-bold leading-tight">
                      {labelMedian}
                      <span className="ms-2 text-xs font-normal text-muted">
                        {t(
                          `(الشريحة الأعلى: ${labelP90} · ${timeToGrade.sampleSize} متابعة)`,
                          `(top 10%: ${labelP90} · ${timeToGrade.sampleSize} graded)`,
                        )}
                      </span>
                    </p>
                  </div>
                  <span
                    className={`inline-flex items-center rounded-full border px-2.5 py-1 text-xs font-medium ${tierClasses[tier]}`}
                    aria-label={verdict}
                  >
                    {verdict}
                  </span>
                </div>
              );
            })()}
          </section>
        </SectionErrorBoundary>

        {/* Analytics + sidebar. */}
        <section aria-label={t("التحليلات", "Analytics")} className="mt-6 grid grid-cols-1 gap-4 lg:grid-cols-5">
          <div className="lg:col-span-3">
            <SectionErrorBoundary fallbackLabel={t("تعذّر تحميل التحليلات", "Couldn't load analytics")}>
              <WidgetCard title={t("ساعات التدريس", "Teaching Hours")}>
                <AnalyticsChart data={weeklyHours} title={t("ساعات التدريس", "Teaching Hours")} />
              </WidgetCard>
            </SectionErrorBoundary>
          </div>
          <div className="space-y-4 lg:col-span-2">
            <SectionErrorBoundary fallbackLabel={t("تعذّر تحميل الجلسات المباشرة", "Couldn't load live sessions")}>
              <LiveSessionsWidget sessions={liveSessions} title={t("الجلسات المباشرة", "Live Sessions")} ongoingCount={liveSessions.length} />
            </SectionErrorBoundary>
            <SectionErrorBoundary fallbackLabel={t("تعذّر تحميل توزيع الجلسات", "Couldn't load breakdown")}>
              <BreakdownBar title={t("توزيع الجلسات", "Session Types")} segments={sessionBreakdown} emptyMessage={t("لا توجد جلسات في آخر 30 يوم", "No sessions in the last 30 days")} />
            </SectionErrorBoundary>
          </div>
        </section>

        {/* Recent students. */}
        <section aria-labelledby="recent-students-heading" className="mt-6">
          <h2 id="recent-students-heading" className="sr-only">{t("آخر الطلاب", "Recent Students")}</h2>
          <SectionErrorBoundary fallbackLabel={t("تعذّر تحميل قائمة الطلاب", "Couldn't load student list")}>
            <DataTable
              title={t("آخر الطلاب", "Recent Students")}
              columns={[
                { key: "subject", label: t("النوع", "Subject") },
                { key: "date", label: t("آخر جلسة", "Last Session"), type: "date" },
                // Raw count, not a fake percentage. Column key matches
                // the new field name returned by getTeacherRecentStudents.
                { key: "sessions", label: t("الحصص", "Sessions") },
                { key: "assignee", label: t("الطالب", "Student"), type: "assignee" },
                { key: "view", label: t("عرض", "View"), type: "actions" },
              ]}
              rows={recentStudents as { id: string; [key: string]: unknown }[]}
              emptyMessage={t("لا يوجد طلاب بعد", "No students yet")}
            />
          </SectionErrorBoundary>
        </section>

        {/* Today's sessions + Quick Actions. */}
        <section aria-label={t("جلسات اليوم", "Today")} className="mt-6 grid grid-cols-1 gap-4 lg:grid-cols-5">
          <div className="lg:col-span-3">
            <SectionErrorBoundary fallbackLabel={t("تعذّر تحميل جلسات اليوم", "Couldn't load today's sessions")}>
              <WidgetCard title={t("جلسات اليوم", "Today's Sessions")} subtitle={todaySessions.length > 0 ? `${todaySessions.length}` : undefined}>
                {todaySessions.length === 0 ? (
                  <div className="flex min-h-[120px] items-center justify-center text-center">
                    <div>
                      <Calendar size={28} className="mx-auto mb-3 text-muted" aria-hidden="true" />
                      <p className="text-sm text-muted">{t("لا توجد جلسات اليوم", "No sessions today")}</p>
                    </div>
                  </div>
                ) : (
                  <ul className="space-y-3" aria-label={t("جلسات اليوم", "Today's sessions")}>
                    {todaySessions.map(b => {
                      const sess = sessionDataMap[b.id];
                      return (
                        <li key={b.id}>
                          <TeacherSessionCard
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
                        </li>
                      );
                    })}
                  </ul>
                )}
              </WidgetCard>
            </SectionErrorBoundary>
          </div>
          <div className="lg:col-span-2">
            <SectionErrorBoundary fallbackLabel={t("تعذّر تحميل الإجراءات السريعة", "Couldn't load quick actions")}>
              <TeacherQuickActions students={Object.entries(nameMap).map(([id, name]) => ({ id, name }))} />
            </SectionErrorBoundary>
          </div>
        </section>

        {/* Pending bookings — needs your attention. */}
        <section aria-labelledby="pending-heading" id="pending" className="mt-6">
          <h2 id="pending-heading" className="sr-only">{t("حجوزات بانتظار التأكيد", "Pending bookings")}</h2>
          <SectionErrorBoundary fallbackLabel={t("تعذّر تحميل الحجوزات", "Couldn't load bookings")}>
            <WidgetCard title={t("حجوزات بانتظار التأكيد", "Pending Bookings")} subtitle={pending.length > 0 ? `${pending.length}` : undefined}>
              {uniqueStudents === 0 && pending.length > 0 && (
                <div className="glass glass-pill mb-3 p-3 text-center text-sm text-gold" role="note">
                  {t("لديك حجز جديد! اضغط تأكيد لقبول الطالب", "You have a new booking! Tap Confirm to accept.")}
                </div>
              )}
              {pending.length === 0 ? (
                <div className="flex min-h-[120px] items-center justify-center text-center">
                  <div>
                    <Clock size={24} className="mx-auto mb-2 text-muted" aria-hidden="true" />
                    <p className="text-sm text-muted">{t("لا توجد حجوزات معلقة", "No pending bookings")}</p>
                  </div>
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <caption className="sr-only">{t("حجوزات بانتظار التأكيد", "Pending bookings")}</caption>
                    <thead>
                      <tr className="border-b border-[var(--surface-border)] text-xs text-muted-light">
                        <th scope="col" className="pb-2 text-start font-medium">{t("الطالب", "Student")}</th>
                        <th scope="col" className="pb-2 text-start font-medium">{t("النوع", "Type")}</th>
                        <th scope="col" className="pb-2 text-start font-medium">{t("الموعد", "Date")}</th>
                        <th scope="col" className="pb-2 text-end font-medium">{t("إجراء", "Action")}</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-[var(--surface-divider,#F0F0F2)]">
                      {pending.map(b => (
                        <tr key={b.id}>
                          <td className="py-3 font-medium">{nameMap[b.student_id] ?? t("طالب", "Student")}</td>
                          <td className="py-3 text-muted">{st(b.session_type)} <span aria-hidden="true">·</span> {b.duration_min} {t("د", "m")}</td>
                          <td className="py-3 text-muted">
                            {new Date(b.scheduled_at).toLocaleDateString(locale, { month: "short", day: "numeric" })}{" "}
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
          </SectionErrorBoundary>
        </section>

        {/* Footer — last refresh + shortcuts trigger + refresh button. */}
        <footer className="mt-10 flex flex-wrap items-center justify-between gap-3 border-t border-[var(--surface-divider,var(--surface-border))] pt-5 text-xs text-muted">
          <p>{t(`آخر تحديث ${lastRefreshLabel}`, `Last refreshed at ${lastRefreshLabel}`)}</p>
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
