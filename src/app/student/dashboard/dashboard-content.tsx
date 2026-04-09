"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Calendar, CheckCircle, Clock, Search, Star, TrendingUp, Video, BookOpen, FileText } from "lucide-react";
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
import { QuickActions } from "./quick-actions";

interface DashboardData {
  fullName: string | null;
  nextBooking: { id: string; teacher_id: string; scheduled_at: string; duration_min: number; session_type: string } | null;
  sessionId: string | null;
  totalSessions: number;
  monthSessions: number;
  pendingBookings: number;
  recent: { id: string; teacher_id: string; scheduled_at: string; duration_min: number; session_type: string }[];
  evaluations: { id: string; teacher_id: string; evaluation_type: string; overall_score: number; hifz_score: number | null; tajweed_score: number | null; strengths: string | null; weaknesses: string | null; recommendations: string | null; created_at: string }[];
  nameMap: Record<string, string>;
  notesMap: Record<string, { post_session_notes: string | null; homework: string | null }>;
  weeklyData: { day: string; value: number; isActive: boolean }[];
  liveSessions: { id: string; title: string; subtitle: string; initials: string; timeRemaining?: string; progressPercent?: number }[];
  recentRecordings: Record<string, unknown>[];
}

export function StudentDashboardContent({ data }: { data: DashboardData }) {
  const { t, dir, lang } = useLang();
  const toast = useToast();
  const searchParams = useSearchParams();
  const { fullName, nextBooking, sessionId, totalSessions, monthSessions, pendingBookings, recent, evaluations, nameMap, notesMap, weeklyData, liveSessions, recentRecordings } = data;

  useEffect(() => {
    if (searchParams.get("booked") === "1") {
      toast.success(t("تم الحجز بنجاح! سيتم تأكيده من المعلم", "Booking submitted! Teacher will confirm soon."));
      window.history.replaceState(null, "", "/student/dashboard");
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const pendingHomework = Object.entries(notesMap).filter(([, n]) => n.homework);

  const [initialNow] = useState(() => Date.now());
  let countdown = "";
  let countdownColor = "text-muted";
  if (nextBooking) {
    const diff = new Date(nextBooking.scheduled_at).getTime() - initialNow;
    if (diff < 0) {
      countdown = t("الآن", "Now");
      countdownColor = "text-red-400";
    } else {
      const mins = Math.floor(diff / 60000);
      const hours = Math.floor(mins / 60);
      const days = Math.floor(hours / 24);
      if (mins < 60) { countdown = t(`بعد ${mins} دقيقة`, `In ${mins} min`); countdownColor = "text-red-400"; }
      else if (hours < 24) { countdown = t(`بعد ${hours} ساعة`, `In ${hours} hours`); countdownColor = "text-amber-400"; }
      else { countdown = t(`بعد ${days} يوم`, `In ${days} days`); }
    }
  }

  const st = (type: string) => {
    const s = SESSION_TYPE_BILINGUAL[type as keyof typeof SESSION_TYPE_BILINGUAL];
    return s ? t(s.ar, s.en) : type;
  };

  return (
    <>
      <div className="h-0.5 bg-gradient-to-l from-gold/0 via-gold/30 to-gold/0" />
      <div dir={dir} className="mx-auto max-w-6xl px-4 py-8 sm:px-6">
        {/* Row 0: Welcome + Hero */}
        <h1 className="font-display text-3xl font-bold">{t("أهلاً", "Welcome")}{fullName ? ` ${fullName}` : ""}</h1>
        <p className="mt-1 text-sm text-muted">{t("مرحباً بك في أكاديمية فُرقان", "Welcome to FURQAN Academy")}</p>

        {totalSessions === 0 && !nextBooking && <GuidanceBanner />}

        {nextBooking ? (
          <div className="mt-6 glass-card p-5 sm:p-8">
            <p className="mb-2 text-sm font-bold text-gold"><Star size={14} className="inline text-gold" /> {t("جلستك القادمة", "Your Next Session")}</p>
            <p className="text-lg font-bold">{t("مع", "With")} {nameMap[nextBooking.teacher_id] ?? t("معلم", "Teacher")}</p>
            <p className="mt-1 text-sm text-muted">
              {st(nextBooking.session_type)} · {nextBooking.duration_min} {t("دقيقة", "min")}
            </p>
            <p dir="ltr" className="mt-2 text-start text-sm text-muted">
              {new Date(nextBooking.scheduled_at).toLocaleDateString(lang === "ar" ? "ar-SA" : "en-US", { weekday: "long", year: "numeric", month: "long", day: "numeric" })}
              {" · "}
              {new Date(nextBooking.scheduled_at).toLocaleTimeString(lang === "ar" ? "ar-SA" : "en-US", { hour: "2-digit", minute: "2-digit" })}
            </p>
            <p className={`mt-2 text-sm font-medium ${countdownColor}`}>{countdown}</p>
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

        {/* Row 1: 4 Stat Cards */}
        <div className="mt-6 grid grid-cols-2 gap-4 md:grid-cols-4 stagger-children">
          <StatCard
            icon={CheckCircle}
            label={t("إجمالي الجلسات", "Total Sessions")}
            value={totalSessions}
            href="/student/sessions"
            actionLabel={t("عرض الكل", "View All")}
            statusBadge={totalSessions > 0 ? { text: t("نشط", "Active"), type: "active" } : undefined}
          />
          <StatCard icon={Calendar} label={t("جلسات هذا الشهر", "This Month")} value={monthSessions} href="/student/sessions" actionLabel={t("عرض الكل", "View All")} />
          <StatCard icon={Clock} label={t("حجوزات معلّقة", "Pending Bookings")} value={pendingBookings} href="/student/bookings" actionLabel={t("عرض", "View")} />
          <StatCard icon={TrendingUp} label={t("تقدمي", "My Progress")} value={t("عرض", "View")} href="/student/progress" subtitle={t("رحلتي مع القرآن", "My Quran journey")} actionLabel={t("عرض", "View")} />
        </div>

        {/* Row 2: Chart (3fr) + Right column (2fr) */}
        <div className="mt-6 grid grid-cols-1 gap-4 lg:grid-cols-5">
          {/* Left: Analytics chart */}
          <div className="lg:col-span-3">
            <WidgetCard title={t("تحليلات التقدم", "Report Analytics")}>
              <AnalyticsChart
                data={weeklyData}
                title={t("تحليلات التقدم", "Report Analytics")}
              />
            </WidgetCard>
          </div>

          {/* Right: Two stacked widgets */}
          <div className="space-y-4 lg:col-span-2">
            <LiveSessionsWidget
              sessions={liveSessions}
              title={t("الجلسات المباشرة", "Online Classes")}
              ongoingCount={liveSessions.length}
            />
            <BreakdownBar
              title={t("توزيع الواجبات", "Assignment Breakdown")}
              segments={[]}
              emptyMessage={t("ابدأ تتبع الواجبات لرؤية التقدم", "Start tracking homework to see progress")}
            />
          </div>
        </div>

        {/* Row 3: Recent recordings table */}
        <div className="mt-6">
          <DataTable
            title={t("الحصص السابقة", "Continue Watching")}
            columns={[
              { key: "id", label: t("رقم", "Id") },
              { key: "subject", label: t("الموضوع", "Subject") },
              { key: "date", label: t("التاريخ", "Date"), type: "date" },
              { key: "progress", label: t("التقدم", "Progress"), type: "progress" },
              { key: "assignee", label: t("المدرس", "Teacher"), type: "assignee" },
              { key: "view", label: t("عرض", "View"), type: "actions" },
            ]}
            rows={recentRecordings as { id: string; [key: string]: unknown }[]}
            emptyMessage={t("لا توجد تسجيلات بعد", "No recordings yet")}
          />
        </div>

        {/* Row 4: Preserved existing sections */}
        {/* Recent Sessions table */}
        <div className="mt-6 grid grid-cols-1 gap-4 lg:grid-cols-5">
          <div className="lg:col-span-3">
            {recent.length > 0 ? (
              <WidgetCard
                title={t("آخر الجلسات", "Recent Sessions")}
                headerAction={
                  <Link href="/student/sessions" className="text-xs text-gold hover:text-gold-hover">{t("عرض الكل ←", "View All →")}</Link>
                }
              >
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-[var(--surface-border)] text-xs text-[var(--muted-light,var(--muted))]">
                        <th className="pb-2 text-start font-medium">{t("المعلم", "Teacher")}</th>
                        <th className="pb-2 text-start font-medium">{t("النوع", "Type")}</th>
                        <th className="pb-2 text-start font-medium">{t("التاريخ", "Date")}</th>
                        <th className="pb-2 text-start font-medium">{t("ملاحظات", "Notes")}</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-[var(--surface-divider,#F0F0F2)]">
                      {recent.map(r => {
                        const note = notesMap[r.id];
                        return (
                          <tr key={r.id} className="text-sm">
                            <td className="py-3 font-medium">{nameMap[r.teacher_id] ?? t("معلم", "Teacher")}</td>
                            <td className="py-3 text-[var(--muted)]">{st(r.session_type)}</td>
                            <td className="py-3 text-[var(--muted)]">{new Date(r.scheduled_at).toLocaleDateString(lang === "ar" ? "ar-SA" : "en-US", { month: "short", day: "numeric" })}</td>
                            <td className="py-3">
                              <div className="flex gap-1.5">
                                {note?.post_session_notes && (
                                  <span className="glass-badge border-gold/30 bg-gold/10 text-gold" title={note.post_session_notes}>
                                    <FileText size={10} className="inline" /> {t("ملاحظة", "Note")}
                                  </span>
                                )}
                                {note?.homework && (
                                  <span className="glass-badge border-blue-400/30 bg-blue-400/10 text-blue-400" title={note.homework}>
                                    <BookOpen size={10} className="inline" /> {t("واجب", "HW")}
                                  </span>
                                )}
                              </div>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </WidgetCard>
            ) : (
              <WidgetCard title={t("آخر الجلسات", "Recent Sessions")}>
                <div className="flex min-h-[120px] items-center justify-center text-center">
                  <div>
                    <FileText size={28} className="mx-auto mb-3 text-[var(--muted)]" />
                    <p className="text-sm text-[var(--muted)]">{t("لا توجد جلسات سابقة", "No recent sessions")}</p>
                  </div>
                </div>
              </WidgetCard>
            )}
          </div>

          {/* Right: Quick Actions + Homework */}
          <div className="space-y-4 lg:col-span-2">
            <QuickActions />

            {pendingHomework.length > 0 && (
              <WidgetCard title={t("الواجبات المنزلية", "Homework")}>
                <div className="space-y-2">
                  {pendingHomework.map(([bookingId, h]) => {
                    const booking = recent.find(r => r.id === bookingId);
                    return (
                      <div key={bookingId} className="rounded-xl border border-[var(--surface-border)] p-3">
                        <div className="flex items-start justify-between gap-2">
                          <div className="min-w-0">
                            <p className="text-xs font-medium">{booking ? nameMap[booking.teacher_id] ?? t("معلم", "Teacher") : t("معلم", "Teacher")}</p>
                            <p className="mt-1 text-xs text-[var(--muted)]">{h.homework}</p>
                          </div>
                          {booking && <p className="shrink-0 text-[10px] text-[var(--muted)]">{new Date(booking.scheduled_at).toLocaleDateString(lang === "ar" ? "ar-SA" : "en-US")}</p>}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </WidgetCard>
            )}
          </div>
        </div>

        {/* Row 5: Evaluations */}
        {evaluations.length > 0 && (
          <div className="mt-6">
            <WidgetCard title={t("تقييمات معلمك", "Teacher Evaluations")}>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-[var(--surface-border)] text-xs text-[var(--muted-light,var(--muted))]">
                      <th className="pb-2 text-start font-medium">{t("المعلم", "Teacher")}</th>
                      <th className="pb-2 text-start font-medium">{t("النوع", "Type")}</th>
                      <th className="pb-2 text-start font-medium">{t("التقييم", "Score")}</th>
                      <th className="pb-2 text-start font-medium">{t("حفظ", "Hifz")}</th>
                      <th className="pb-2 text-start font-medium">{t("تجويد", "Tajweed")}</th>
                      <th className="pb-2 text-start font-medium">{t("ملاحظات", "Notes")}</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[var(--surface-divider,#F0F0F2)]">
                    {evaluations.map(ev => (
                      <tr key={ev.id}>
                        <td className="py-3 font-medium">{nameMap[ev.teacher_id] ?? t("معلم", "Teacher")}</td>
                        <td className="py-3 text-[var(--muted)]">{ev.evaluation_type}</td>
                        <td className="py-3">
                          <span className={`glass-badge px-2 py-0.5 text-xs font-bold ${ev.overall_score >= 8 ? "text-green-400" : ev.overall_score >= 5 ? "text-amber-400" : "text-red-400"}`}>
                            {ev.overall_score}/10
                          </span>
                        </td>
                        <td className="py-3 text-[var(--muted)]">{ev.hifz_score != null ? `${ev.hifz_score}/10` : "—"}</td>
                        <td className="py-3 text-[var(--muted)]">{ev.tajweed_score != null ? `${ev.tajweed_score}/10` : "—"}</td>
                        <td className="max-w-[200px] py-3">
                          {ev.strengths && <p className="truncate text-xs"><span className="text-green-400">{t("قوة:", "S:")}</span> {ev.strengths}</p>}
                          {ev.weaknesses && <p className="truncate text-xs"><span className="text-amber-400">{t("ضعف:", "W:")}</span> {ev.weaknesses}</p>}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </WidgetCard>
          </div>
        )}
      </div>
    </>
  );
}
