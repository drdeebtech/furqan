"use client";

import Link from "next/link";
import { Suspense, useEffect, useMemo, type ReactNode } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Calendar, CheckCircle, Clock, Briefcase, Keyboard, MessageSquare, RefreshCw, Sparkles } from "lucide-react";
import { useLang } from "@/lib/i18n/context";
import { useToast } from "@/components/shared/toast";
import { StatCard } from "@/components/shared/stat-card";
import { surahName } from "@/lib/quran/surahs";
import { useKeyboardShortcuts, useShortcutsHelp, type Shortcut } from "@/lib/hooks/use-keyboard-shortcuts";
import { useNowTicker } from "@/lib/hooks/use-now-ticker";
import { ShortcutsHelp } from "@/components/shared/shortcuts-help";
import { SectionErrorBoundary } from "@/components/shared/section-error-boundary";
import { NextActionBanner } from "./next-action-banner";
import { WelcomeHeader } from "./welcome-header";
import { TodaysPlan } from "./todays-plan";
import { GoalCard } from "./goal-card";
import { AchievementShelf } from "./achievement-shelf";
import { UpgradeNudgeCard } from "./upgrade-nudge-card";
import { PrepaidWalletCard, type PrepaidWalletData } from "./prepaid-wallet-card";
import type { GoalDashboardData } from "@/lib/domains/goals/goals";

interface DashboardData {
  fullName: string | null;
  // Spec 022: scheduled_at may be NULL for single-session assessment/specialized
  // bookings (slot chosen after creation). Display sites treat NULL as
  // "Unscheduled" and exclude from countdowns.
  nextBooking: { id: string; teacher_id: string; scheduled_at: string | null; duration_min: number; session_type: string } | null;
  sessionId: string | null;
  totalSessions: number;
  monthSessions: number;
  pendingBookings: number;
  nameMap: Record<string, string>;
  activePackages: { id: string; sessions_total: number; sessions_used: number; status: string; expires_at: string | null }[];
  nextQuiz: { id: string; title: string; due_at: string | null } | null;
  lastProgress: { surah_to: number | null; ayah_to: number | null; surah_from: number | null; ayah_from: number | null; level: string; recitation_standard: string | null; created_at: string } | null;
  resumeLesson: { lessonId: string; title: string; href: string; progressPct: number } | null;
  streakInfo: { streak: number; weeklyMinutes: number; weeklyDelta: number; loggedToday: boolean };
  homeworkPulse: { overdue: number; dueToday: number; dueThisWeek: number; nextItem: { id: string; description: string | null; dueDate: string | null; type: string } | null };
  todaySessions: { id: string; teacher_id: string; scheduled_at: string | null; duration_min: number; session_type: string; status: string }[];
  todayHomework: { id: string; description: string | null; due_date: string | null; homework_type: string; status: string }[];
  latestEvaluation: { overall_score: number | null; strengths: string | null; next_goals: string | null; evaluation_type: string; created_at: string } | null;
  subscription: { planName: string | null; status: string; currentPeriodEnd: string | null; cancelAtPeriodEnd: boolean } | null;
  unreadMessages: number;
  goal: GoalDashboardData | null;
  achievements: { type: string; metadata_json: Record<string, unknown>; unlocked_at: string }[];
  // Spec 038 — null when the student has no active prepaid lots; subscription-
  // only students never see the wallet widget.
  prepaidWallet: PrepaidWalletData | null;
  renderedAtMs: number;
}

export function StudentDashboardContent({
  data,
  murajaahSlot,
  analyticsSlot,
}: {
  data: DashboardData;
  murajaahSlot: ReactNode;
  analyticsSlot: ReactNode;
}) {
  return (
    <Suspense fallback={null}>
      <StudentDashboardContentInner data={data} murajaahSlot={murajaahSlot} analyticsSlot={analyticsSlot} />
    </Suspense>
  );
}

function StudentDashboardContentInner({
  data,
  murajaahSlot,
  analyticsSlot,
}: {
  data: DashboardData;
  murajaahSlot: ReactNode;
  analyticsSlot: ReactNode;
}) {
  const router = useRouter();
  const { t, dir, lang } = useLang();
  const toast = useToast();
  const searchParams = useSearchParams();
  const {
    fullName, nextBooking, sessionId, totalSessions, monthSessions, pendingBookings, nameMap,
    activePackages, nextQuiz, lastProgress, resumeLesson, streakInfo,
    homeworkPulse, todaySessions, todayHomework, latestEvaluation,
    goal, achievements, prepaidWallet, subscription, unreadMessages, renderedAtMs,
  } = data;

  useEffect(() => {
    const sub = searchParams.get("subscription");
    const prepaid = searchParams.get("prepaid_hours");
    const timers: ReturnType<typeof setTimeout>[] = [];
    // The grant is webhook-driven and async — it may not have landed by the time
    // Stripe redirects back. Re-fetch shortly after so the newly-granted access
    // (subscription / wallet) appears without the student reloading manually.
    const pollForGrant = () => {
      timers.push(setTimeout(() => router.refresh(), 2500));
      timers.push(setTimeout(() => router.refresh(), 6000));
    };
    if (searchParams.get("booked") === "1") {
      toast.success(t("تم الحجز بنجاح! سيتم تأكيده من المعلم", "Booking submitted! Teacher will confirm soon."));
      window.history.replaceState(null, "", "/student/dashboard");
    } else if (sub === "success") {
      // Honest copy: the grant is async, so say "activating", not "activated".
      toast.success(t("تم استلام الدفع — يتم تفعيل وصولك الآن", "Payment received — activating your access now."));
      window.history.replaceState(null, "", "/student/dashboard");
      pollForGrant();
    } else if (sub === "cancelled") {
      toast.info(t("تم إلغاء عملية الدفع", "Payment was cancelled."));
      window.history.replaceState(null, "", "/student/dashboard");
    } else if (prepaid === "success") {
      // Spec 038 — Stripe success_url for the prepaid-hours checkout.
      toast.success(
        t("تم استلام الدفع — يتم إضافة ساعاتك الآن", "Payment received — adding your hours now."),
      );
      window.history.replaceState(null, "", "/student/dashboard");
      pollForGrant();
    } else if (prepaid === "cancelled") {
      toast.info(
        t("تم إلغاء شراء الساعات", "Hours purchase was cancelled."),
      );
      window.history.replaceState(null, "", "/student/dashboard");
    }
    return () => timers.forEach(clearTimeout);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const now = useNowTicker(60_000, renderedAtMs).getTime();

  const refresh = () => router.refresh();

  const minsUntilNext = nextBooking && nextBooking.scheduled_at
    ? Math.floor((new Date(nextBooking.scheduled_at).getTime() - now) / 60_000)
    : null;
  const isImminent = minsUntilNext != null && minsUntilNext <= 30;

  let countdownShort = "—";
  if (nextBooking && nextBooking.scheduled_at) {
    const diff = new Date(nextBooking.scheduled_at).getTime() - now;
    if (diff < 0) {
      countdownShort = t("الآن", "Now");
    } else {
      const mins = Math.floor(diff / 60000);
      const hours = Math.floor(mins / 60);
      const days = Math.floor(hours / 24);
      if (mins < 60) countdownShort = `${mins}m`;
      else if (hours < 24) countdownShort = `${hours}h`;
      else countdownShort = lang === "ar" ? `${days} يوم` : `${days}d`;
    }
  } else if (nextBooking && !nextBooking.scheduled_at) {
    countdownShort = lang === "ar" ? "غير مُجدوَل" : "Unscheduled";
  }

  const primaryPackage = activePackages[0] ?? null;
  const pkgRemaining = primaryPackage ? primaryPackage.sessions_total - primaryPackage.sessions_used : 0;
  const pkgPct = primaryPackage && primaryPackage.sessions_total > 0
    ? Math.round((primaryPackage.sessions_used / primaryPackage.sessions_total) * 100)
    : 0;

  const firstName = fullName ? fullName.split(" ")[0] : null;
  const weekday = new Date(now).toLocaleDateString(lang === "ar" ? "ar-EG" : "en-US", { weekday: "long" });
  const surahNum = lastProgress?.surah_to ?? lastProgress?.surah_from ?? null;
  const ayahNum = lastProgress?.ayah_to ?? lastProgress?.ayah_from ?? null;
  const surahLabel = surahName(surahNum, lang === "ar" ? "ar" : "en");

  const teacherNameForBanner = nextBooking ? nameMap[nextBooking.teacher_id] ?? null : null;

  // Today's Plan items — sorted chronologically.
  const todaysPlanItems = useMemo(() => {
    const items: { id: string; kind: "session" | "homework" | "quiz"; title: string; detail: string; href: string; at: string | null; urgent?: boolean }[] = [];
    const localTodayStart = new Date(now); localTodayStart.setHours(0, 0, 0, 0);
    const localTodayEnd = new Date(now); localTodayEnd.setHours(23, 59, 59, 999);
    for (const s of todaySessions) {
      if (!s.scheduled_at) continue;
      const sessionTime = new Date(s.scheduled_at).getTime();
      if (sessionTime < localTodayStart.getTime() || sessionTime > localTodayEnd.getTime()) continue;
      const teacherName = nameMap[s.teacher_id] ?? t("معلمك", "your teacher");
      items.push({
        id: `s:${s.id}`,
        kind: "session",
        title: t(`جلسة مع ${teacherName}`, `Session with ${teacherName}`),
        detail: t(`${s.duration_min} دقيقة`, `${s.duration_min} min · ${s.session_type}`),
        href: `/student/bookings/${s.id}`,
        at: s.scheduled_at,
        urgent: new Date(s.scheduled_at).getTime() - now <= 30 * 60_000,
      });
    }
    for (const h of todayHomework) {
      items.push({
        id: `h:${h.id}`,
        kind: "homework",
        title: h.description ?? t("متابعة", "Assignment"),
        detail: t(`نوع: ${h.homework_type}`, `Type: ${h.homework_type}`),
        href: "/student/follow-up",
        at: h.due_date,
        urgent: true,
      });
    }
    if (nextQuiz?.due_at) {
      const dueDate = new Date(nextQuiz.due_at);
      const todayStart = new Date(now); todayStart.setHours(0, 0, 0, 0);
      const todayEnd = new Date(now); todayEnd.setHours(23, 59, 59, 999);
      if (dueDate >= todayStart && dueDate <= todayEnd) {
        items.push({
          id: `q:${nextQuiz.id}`,
          kind: "quiz",
          title: nextQuiz.title,
          detail: t("اختبار", "Quiz"),
          href: `/student/quizzes/${nextQuiz.id}/take`,
          at: nextQuiz.due_at,
          urgent: true,
        });
      }
    }
    items.sort((a, b) => {
      if (!a.at) return 1;
      if (!b.at) return -1;
      return new Date(a.at).getTime() - new Date(b.at).getTime();
    });
    return items;
  }, [todaySessions, todayHomework, nextQuiz, nameMap, now, t]);

  const [helpOpen, setHelpOpen] = useShortcutsHelp();
  const shortcuts: Shortcut[] = useMemo(() => [
    {
      combo: "j",
      description: { ar: "انضم للجلسة القادمة", en: "Join next session" },
      group: { ar: "إجراءات", en: "Actions" },
      onTrigger: () => {
        if (sessionId && isImminent) window.location.assign(`/student/sessions/${sessionId}`);
        else toast.info(t("لا توجد جلسة قادمة قريبًا", "No upcoming session soon"));
      },
    },
    { combo: "g d", description: { ar: "اللوحة", en: "Dashboard" }, group: { ar: "تنقل", en: "Navigate" }, href: "/student/dashboard" },
    { combo: "g s", description: { ar: "الجلسات", en: "Sessions" }, group: { ar: "تنقل", en: "Navigate" }, href: "/student/sessions" },
    { combo: "g c", description: { ar: "الدورات", en: "Courses" }, group: { ar: "تنقل", en: "Navigate" }, href: "/student/courses" },
    { combo: "g h", description: { ar: "المتابعة", en: "Follow-up" }, group: { ar: "تنقل", en: "Navigate" }, href: "/student/follow-up" },
    { combo: "g q", description: { ar: "الاختبارات", en: "Quizzes" }, group: { ar: "تنقل", en: "Navigate" }, href: "/student/quizzes" },
    { combo: "g p", description: { ar: "تقدمي", en: "Progress" }, group: { ar: "تنقل", en: "Navigate" }, href: "/student/progress" },
    { combo: "g t", description: { ar: "المعلمون", en: "Teachers" }, group: { ar: "تنقل", en: "Navigate" }, href: "/student/teachers" },
    { combo: "g m", description: { ar: "الرسائل", en: "Messages" }, group: { ar: "تنقل", en: "Navigate" }, href: "/student/messages" },
    { combo: "g k", description: { ar: "التقويم", en: "Calendar" }, group: { ar: "تنقل", en: "Navigate" }, href: "/student/calendar" },
    { combo: "?", description: { ar: "إظهار الاختصارات", en: "Show shortcuts" }, group: { ar: "مساعدة", en: "Help" }, onTrigger: () => setHelpOpen(true) },
  ], [sessionId, isImminent, toast, t, setHelpOpen]);
  useKeyboardShortcuts(shortcuts, true);

  const lastRefreshLabel = new Date(renderedAtMs).toLocaleTimeString(lang === "ar" ? "ar-EG" : "en-US", { hour: "2-digit", minute: "2-digit" });

  const kpi4 = (() => {
    if (nextQuiz) {
      const dueDate = nextQuiz.due_at ? new Date(nextQuiz.due_at) : null;
      const daysLeft = dueDate
        ? Math.max(0, Math.ceil((dueDate.getTime() - now) / 86400_000))
        : null;
      const valueLabel = daysLeft != null
        ? (daysLeft === 0 ? t("اليوم", "Today") : `${daysLeft} ${daysLeft === 1 ? t("يوم", "Day") : t("أيام", "Days")}`)
        : t("متاح", "Open");
      return (
        <StatCard
          icon={Clock}
          label={t("الاختبار القادم", "Upcoming Quiz")}
          value={valueLabel}
          href={`/student/quizzes/${nextQuiz.id}/take`}
          actionLabel={t("ابدأ", "Start")}
          statusBadge={{ text: t("مفتوح", "Open"), type: "info", icon: <Sparkles size={11} /> }}
        />
      );
    }
    return (
      <StatCard
        icon={Clock}
        label={t("الجلسة القادمة", "Next Session")}
        value={nextBooking ? countdownShort : "—"}
        href={sessionId ? `/student/sessions/${sessionId}` : "/student/teachers"}
        actionLabel={
          nextBooking
            ? (isImminent ? t("انضم الآن", "Join now") : t("التفاصيل", "Details"))
            : t("احجز", "Book")
        }
        statusBadge={
          nextBooking
            ? !nextBooking.scheduled_at
              ? { text: t("غير مُجدوَل", "Unscheduled"), type: "info", icon: <Calendar size={11} /> }
              : isImminent
                ? { text: t("جاهز", "Ready"), type: "active", icon: <Sparkles size={11} /> }
                : { text: t("مجدول", "Scheduled"), type: "info", icon: <Calendar size={11} /> }
            : undefined
        }
      />
    );
  })();

  const isEmptyShell = !primaryPackage && totalSessions === 0 && !nextBooking;

  return (
    <div className="student-dashboard-skin">
      <a
        href="#student-main"
        className="sr-only focus:not-sr-only focus:absolute focus:start-4 focus:top-4 focus:z-[200] focus:rounded focus:bg-gold focus:px-3 focus:py-2 focus:text-sm focus:font-medium focus:text-background"
      >
        {t("تخطي إلى المحتوى", "Skip to main content")}
      </a>

      <div dir={dir} className="mx-auto max-w-7xl px-4 py-8 sm:px-6 sm:py-10" id="student-main">
        <WelcomeHeader
          firstName={firstName}
          weekday={weekday}
          surahLabel={surahLabel}
          ayahNum={ayahNum}
          surahNum={surahNum}
          streak={streakInfo.streak}
          loggedToday={streakInfo.loggedToday}
          recitationStandard={lastProgress?.recitation_standard ?? null}
          level={lastProgress?.level ?? null}
        />

        <AchievementShelf achievements={achievements} />

        {/* S2 — unread-messages indicator (parity with the teacher dashboard). */}
        {unreadMessages > 0 && (
          <div className="mb-6">
            <Link
              href="/student/messages"
              className="inline-flex min-h-11 items-center gap-2 rounded-full border border-gold/30 bg-gold/5 px-4 py-2 text-sm font-medium text-gold transition-colors hover:bg-gold/10 focus-ring"
            >
              <MessageSquare size={16} aria-hidden="true" />
              {t(`${unreadMessages} رسائل غير مقروءة`, `${unreadMessages} unread message${unreadMessages === 1 ? "" : "s"}`)}
            </Link>
          </div>
        )}

        <SectionErrorBoundary fallbackLabel={t("تعذّر تحميل الإجراء التالي", "Couldn't load the next action")}>
          <section aria-label={t("الإجراء التالي", "Next action")} className="mb-8">
            <NextActionBanner
              renderedAtMs={renderedAtMs}
              data={{
                nextBooking: nextBooking
                  ? {
                      sessionId,
                      bookingId: nextBooking.id,
                      scheduledAt: nextBooking.scheduled_at,
                      teacherName: teacherNameForBanner,
                    }
                  : null,
                resumeLesson,
                homework: homeworkPulse,
                nextQuiz,
              }}
            />
          </section>
        </SectionErrorBoundary>

        <div className="mt-8">
          <SectionErrorBoundary fallbackLabel={t("تعذّر تحميل هدفك", "Couldn't load your goal")}>
            <GoalCard goal={goal} />
          </SectionErrorBoundary>
        </div>

        {/* S1 — active-subscription summary. Null unless the student has an
            active subscription, so package/prepaid-only students don't see it. */}
        {subscription && (
          <div className="mt-8">
            <SectionErrorBoundary fallbackLabel={t("تعذّر تحميل الاشتراك", "Couldn't load subscription")}>
              <section aria-label={t("اشتراكي", "My subscription")} className="rounded-2xl border border-gold/30 bg-gold/5 p-5">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div className="flex items-center gap-3">
                    <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-gold/15">
                      <Sparkles size={20} className="text-gold" aria-hidden="true" />
                    </div>
                    <div className="min-w-0">
                      <p className="text-xs text-muted">{t("اشتراكي", "My Subscription")}</p>
                      <p className="font-display text-lg font-bold leading-tight">
                        {subscription.planName ?? t("خطة نشطة", "Active plan")}
                      </p>
                    </div>
                  </div>
                  <span
                    className={`inline-flex items-center rounded-full border px-2.5 py-1 text-xs font-medium ${
                      subscription.cancelAtPeriodEnd
                        ? "border-warning/40 bg-warning/10 text-warning"
                        : "border-success/40 bg-success/10 text-success"
                    }`}
                  >
                    {subscription.cancelAtPeriodEnd ? t("يُلغى نهاية الفترة", "Cancels at period end") : t("نشط", "Active")}
                  </span>
                </div>
                {subscription.currentPeriodEnd && (
                  <p className="mt-3 text-sm text-muted">
                    {subscription.cancelAtPeriodEnd ? t("ينتهي في", "Ends on") : t("يتجدد في", "Renews on")}{" "}
                    <span className="font-medium text-foreground">
                      {new Date(subscription.currentPeriodEnd).toLocaleDateString(lang === "ar" ? "ar-EG" : "en-US", { year: "numeric", month: "long", day: "numeric", timeZone: "UTC" })}
                    </span>
                  </p>
                )}
              </section>
            </SectionErrorBoundary>
          </div>
        )}

        {/* Spec 038 — prepaid-hour wallet. Renders only when the student owns
            active prepaid lots; subscription-only students never see it. */}
        {prepaidWallet && (
          <div className="mt-8">
            <SectionErrorBoundary fallbackLabel={t("تعذّر تحميل محفظة الساعات", "Couldn't load your hours wallet")}>
              <PrepaidWalletCard wallet={prepaidWallet} />
            </SectionErrorBoundary>
          </div>
        )}

        {latestEvaluation && (latestEvaluation.overall_score != null || latestEvaluation.strengths || latestEvaluation.next_goals) && (
          <SectionErrorBoundary fallbackLabel={t("تعذّر تحميل التركيز", "Couldn't load focus")}>
            <section
              aria-label={t("تركيز الأسبوع من معلمك", "Your teacher's focus for this week")}
              className="mb-8 rounded-2xl border border-gold/30 bg-gold/5 p-5"
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h2 className="flex items-center gap-2 text-sm font-semibold text-gold">
                  <Sparkles size={14} aria-hidden="true" />
                  {t("تركيز معلمك لهذا الأسبوع", "Your teacher's focus this week")}
                </h2>
                <Link
                  href="/student/progress"
                  className="text-xs text-muted-light hover:text-gold focus-ring rounded"
                >
                  {t("عرض التقييم الكامل ←", "View full evaluation →")}
                </Link>
              </div>
              {latestEvaluation.overall_score != null && (
                <div className="mt-2 flex items-center gap-2">
                  <span className="text-xs text-muted">{t("التقييم العام", "Overall rating")}</span>
                  <span className="inline-flex items-center rounded-full bg-gold/15 px-2.5 py-0.5 text-sm font-bold text-gold tabular-nums">
                    {latestEvaluation.overall_score}/10
                  </span>
                </div>
              )}
              {latestEvaluation.strengths && (
                <div className="mt-3">
                  <p className="text-xs font-medium text-muted">{t("نقاط قوتك", "Your strengths")}</p>
                  <p className="mt-0.5 text-sm leading-relaxed text-foreground">{latestEvaluation.strengths}</p>
                </div>
              )}
              {latestEvaluation.next_goals && (
                <div className="mt-3">
                  <p className="text-xs font-medium text-muted">{t("التركيز القادم", "Next focus")}</p>
                  <p className="mt-0.5 text-base leading-relaxed text-foreground">{latestEvaluation.next_goals}</p>
                </div>
              )}
            </section>
          </SectionErrorBoundary>
        )}

        <SectionErrorBoundary fallbackLabel={t("تعذّر تحميل المؤشرات", "Couldn't load KPIs")}>
          <section
            aria-label={t("مؤشرات سريعة", "Key metrics")}
            className="grid grid-cols-2 gap-6 md:grid-cols-4 stagger-children motion-reduce:[&>*]:animate-none"
          >
            <div className="order-2 md:order-1">
              <StatCard
                icon={Briefcase}
                label={t("باقتي", "Active Package")}
                value={primaryPackage ? `${pkgRemaining}` : "—"}
                href="/student/sessions"
                actionLabel={primaryPackage ? `${pkgPct}% ${t("مستخدم", "used")}` : undefined}
                statusBadge={primaryPackage
                  ? { text: t("نشط", "Active"), type: "active", icon: <CheckCircle size={11} /> }
                  : isEmptyShell ? { text: t("ابدأ", "Start"), type: "info", icon: <Sparkles size={11} /> } : undefined}
                subtitle={primaryPackage ? t("جلسات متبقية", "sessions left") : undefined}
                progressPct={primaryPackage ? pkgPct : undefined}
              />
            </div>
            <div className="order-3 md:order-2">
              <StatCard
                icon={CheckCircle}
                label={t("الجلسات المكتملة", "Completed")}
                value={totalSessions}
                href="/student/sessions"
                actionLabel={t("عرض الكل", "View All")}
              />
            </div>
            <div className="order-4 md:order-3">
              <StatCard
                icon={Calendar}
                label={t("هذا الشهر", "This Month")}
                value={monthSessions}
                href="/student/sessions"
                actionLabel={`${pendingBookings} ${t("معلّقة", "pending")}`}
              />
            </div>
            <div className="order-1 md:order-4">{kpi4}</div>
          </section>
        </SectionErrorBoundary>

        {/* Issue #546 — upgrade nudge when exactly 1 session credit remains. */}
        <div className="mt-8">
          <UpgradeNudgeCard
            remainingCredits={pkgRemaining}
            packageId={primaryPackage ? primaryPackage.id : null}
          />
        </div>

        {/* Today's Plan — fast, above-fold, data from core view. */}
        <div className="mt-10">
          <SectionErrorBoundary fallbackLabel={t("تعذّر تحميل خطة اليوم", "Couldn't load Today's Plan")}>
            <TodaysPlan items={todaysPlanItems} homeworkPulse={homeworkPulse} />
          </SectionErrorBoundary>
        </div>

        {/* Murajaah — streamed independently below the fold. */}
        {murajaahSlot}

        {/* Analytics chart + live sessions + hwCounts + DataTable — slowest queries,
            streamed independently so the KPI grid and Today's Plan are never blocked. */}
        {analyticsSlot}

        <footer className="mt-10 flex flex-wrap items-center justify-between gap-3 border-t border-[var(--surface-divider,var(--surface-border))] pt-5 text-xs text-muted">
          <p suppressHydrationWarning>
            {t(`آخر تحديث ${lastRefreshLabel}`, `Last refreshed at ${lastRefreshLabel}`)}
          </p>
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={() => setHelpOpen(true)}
              className="inline-flex items-center gap-1.5 rounded-lg px-2 py-1 transition-colors hover:bg-foreground/5 hover:text-foreground focus-ring"
              aria-label={t("اختصارات لوحة المفاتيح", "Keyboard shortcuts")}
            >
              <Keyboard size={12} aria-hidden="true" />
              <span>{t("اختصارات", "Shortcuts")}</span>
              <kbd className="ms-1 inline-flex h-5 min-w-[18px] items-center justify-center rounded border border-[var(--surface-border)] bg-[var(--surface-light)] px-1 font-mono text-[10px]">
                ?
              </kbd>
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
    </div>
  );
}
