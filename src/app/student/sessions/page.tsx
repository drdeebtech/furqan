import type { Metadata } from "next";
import { redirect } from "next/navigation";
import Link from "next/link";
import { Video, Inbox, Calendar, CheckCircle, AlertTriangle, Sparkles } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { fetchNameMap } from "@/lib/supabase/helpers";
import { SESSION_TYPE_AR, STATUS_STYLE } from "@/lib/constants";
import { getT } from "@/lib/i18n/server";
import type { BookingStatus, SessionType, SessionMode } from "@/types/database";
import { LiveBadge } from "./live-badge";
import { SessionModeBadge } from "@/components/sessions/SessionModeBadge";
import { EmptyState } from "@/components/shared/empty-state";
import { AttestationButtons } from "./attestation-buttons";

export const metadata: Metadata = { title: "جلساتي" };

const SESSION_TYPE_EN: Record<SessionType, string> = {
  hifz: "Hifz", muraja: "Review", tajweed: "Tajweed", tilawa: "Tilawa",
  qiraat: "Qiraat", tafsir: "Tafsir", combined: "Hifz + Review", other: "Other",
};

interface SessionRow {
  id: string;
  booking_id: string;
  room_url: string;
  session_mode: SessionMode;
  started_at: string | null;
  ended_at: string | null;
  actual_duration: number | null;
  post_session_notes: string | null;
  homework: string | null;
}

interface BookingRow {
  id: string;
  scheduled_at: string;
  duration_min: number;
  status: BookingStatus;
  session_type: SessionType;
  teacher_id: string;
}

// Capture render time outside the component to avoid react-hooks/purity lint
const getRenderTime = () => Date.now();

export default async function StudentSessionsPage() {
  const { t, dir, lang } = await getT();
  const locale = lang === "ar" ? "ar-EG" : "en-US";
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const renderTime = getRenderTime();

  // Get confirmed/completed bookings that have sessions
  const { data: bookings } = await supabase
    .from("bookings")
    .select("id, scheduled_at, duration_min, status, session_type, teacher_id")
    .eq("student_id", user.id)
    .in("status", ["confirmed", "completed"])
    .order("scheduled_at", { ascending: false })
    .limit(100)
    .returns<BookingRow[]>();

  const list = bookings ?? [];

  // Fetch sessions for these bookings
  let sessionMap: Record<string, SessionRow> = {};
  if (list.length > 0) {
    const bookingIds = list.map((b) => b.id);
    const { data: sessions } = await supabase
      .from("sessions")
      .select("id, booking_id, room_url, session_mode, started_at, ended_at, actual_duration, post_session_notes, homework")
      .in("booking_id", bookingIds)
      .returns<SessionRow[]>();
    if (sessions) {
      sessionMap = Object.fromEntries(sessions.map((s) => [s.booking_id, s]));
    }
  }

  // Fetch teacher names
  const nameMap = await fetchNameMap(
    supabase,
    list.map((b) => b.teacher_id),
    t("معلم", "Teacher"),
  );

  return (
    <div dir={dir} className="mx-auto max-w-4xl px-4 py-8">
      <h1 className="mb-6 flex items-center gap-2 font-display text-2xl font-bold">
        <Video size={24} className="text-gold" />
        {t("جلساتي", "My Sessions")}
      </h1>

      {list.length === 0 ? (
        <EmptyState
          variant="glass-card"
          icon={<Inbox size={32} className="text-muted" />}
          message={t("لا توجد جلسات بعد", "No sessions yet")}
          hint={t("ستظهر هنا بعد تأكيد حجوزاتك", "They'll appear here once your bookings are confirmed")}
          action={
            <Link
              href="/student/teachers"
              className="inline-block glass-gold glass-pill px-5 py-2.5 text-sm font-semibold text-white transition-colors focus-ring"
            >
              {t("تصفح المعلمين", "Browse Teachers")}
            </Link>
          }
        />
      ) : (() => {
        // Bucket sessions by state so the page stops being a flat
        // chronological dump. The "needs attention" bucket surfaces past
        // confirmed sessions that should have transitioned to completed
        // or no_show — a cron-silence detector that the student sees
        // before the support team does.
        const live: BookingRow[] = [];
        const upcoming: BookingRow[] = [];
        const completed: BookingRow[] = [];
        const needsAttention: BookingRow[] = [];

        for (const b of list) {
          const startMs = new Date(b.scheduled_at).getTime();
          const endMs = startMs + b.duration_min * 60000;
          const isPast = endMs < renderTime;
          if (b.status === "completed") {
            completed.push(b);
          } else if (b.status === "confirmed") {
            if (isPast) {
              needsAttention.push(b);
            } else if (renderTime >= startMs) {
              live.push(b);
            } else {
              upcoming.push(b);
            }
          }
        }
        // Order each bucket: live newest-first, upcoming soonest-first,
        // completed newest-first, needsAttention newest-first.
        upcoming.sort((a, b) => new Date(a.scheduled_at).getTime() - new Date(b.scheduled_at).getTime());

        const renderCard = (booking: BookingRow) => {
          const date = new Date(booking.scheduled_at);
          const session = sessionMap[booking.id];
          const statusInfo = STATUS_STYLE[booking.status];
          const startMs = date.getTime();
          const endMs = startMs + booking.duration_min * 60000;
          const nowMs = renderTime;
          const isUpcoming = booking.status === "confirmed" && startMs > nowMs;
          const isLive = booking.status === "confirmed" && nowMs >= startMs && nowMs < endMs;
          const isPastConfirmed = booking.status === "confirmed" && endMs < nowMs;

          return (
            <div
              key={booking.id}
              className={`glass-card p-4 ${isLive ? "border-gold/40" : isPastConfirmed ? "border-warning/40 bg-warning/5" : ""}`}
            >
              <div className="flex items-start justify-between gap-4">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="font-medium">{nameMap[booking.teacher_id] ?? t("معلم", "Teacher")}</p>
                    <SessionModeBadge mode={sessionMap[booking.id]?.session_mode} size="sm" />
                  </div>
                  <p className="mt-1 text-sm text-gold">
                    {lang === "ar" ? SESSION_TYPE_AR[booking.session_type] : SESSION_TYPE_EN[booking.session_type]}
                    <span className="me-2 text-muted">· {booking.duration_min} {t("دقيقة", "min")}</span>
                  </p>
                  <p dir="ltr" className="mt-2 text-left text-sm text-muted">
                    {date.toLocaleDateString(locale, { weekday: "long", year: "numeric", month: "long", day: "numeric" })}
                    <span className="mx-2">·</span>
                    {date.toLocaleTimeString(locale, { hour: "2-digit", minute: "2-digit" })}
                  </p>

                  {/* Past-confirmed framing — surfaces a session whose
                      auto-complete cron didn't fire so the student knows
                      to follow up rather than stare at a "confirmed"
                      label that's been wrong for weeks. */}
                  {isPastConfirmed && (
                    <div className="mt-3 rounded-lg border border-warning/30 bg-warning/10 p-3">
                      <p className="flex items-center gap-1.5 text-sm font-medium text-warning">
                        <AlertTriangle size={14} aria-hidden="true" />
                        {t("بانتظار التأكيد", "Awaiting confirmation")}
                      </p>
                      <p className="mt-1 text-xs text-muted">
                        {t(
                          "هذا الموعد قد مرّ ولم يُحدَّث بعد. أخبر معلمك هل تمّت الجلسة لتقفل دورتها.",
                          "This time has passed without an update. Tell your teacher whether it happened so the session lifecycle can resolve.",
                        )}
                      </p>
                      {/* F10: student attestation — sends notification to teacher
                          with the student's claim. Does NOT mutate the session
                          row; teacher still owns the lifecycle. */}
                      <AttestationButtons bookingId={booking.id} />
                      <div className="mt-2 flex flex-wrap gap-2">
                        <Link
                          href="/student/messages"
                          className="text-xs text-gold hover:text-gold-hover focus-ring rounded"
                        >
                          {t("راسل المعلم ←", "Message teacher →")}
                        </Link>
                        <span className="text-muted-light">·</span>
                        <Link
                          href="/student/teachers"
                          className="text-xs text-gold hover:text-gold-hover focus-ring rounded"
                        >
                          {t("احجز جلسة بديلة ←", "Book a replacement →")}
                        </Link>
                      </div>
                    </div>
                  )}

                  {/* Post-session content */}
                  {session?.post_session_notes && (
                    <div className="mt-3 glass rounded-lg p-3">
                      <p className="mb-1 text-xs font-medium text-gold">{t("ملاحظات المعلم", "Teacher Notes")}</p>
                      <p className="text-sm text-muted">{session.post_session_notes}</p>
                    </div>
                  )}
                  {session?.homework && (
                    <div className="mt-2 glass rounded-lg p-3">
                      <p className="mb-1 text-xs font-medium text-gold">{t("المتابعة", "Follow-up")}</p>
                      <p className="text-sm text-muted">{session.homework}</p>
                    </div>
                  )}
                  {/* Pre-session prep nudge — for the next confirmed
                      session: link to /student/progress so the student
                      can review the latest evaluation's recommendations
                      before walking in. */}
                  {isUpcoming && (
                    <p className="mt-3 text-xs text-muted">
                      <Sparkles size={11} className="me-1 inline-block text-gold" aria-hidden="true" />
                      {t("استعد:", "Prep:")}{" "}
                      <Link href="/student/progress" className="text-gold hover:text-gold-hover focus-ring rounded">
                        {t("راجع توصية معلمك السابقة", "review your teacher's last recommendation")}
                      </Link>
                    </p>
                  )}
                </div>

                <div className="flex flex-col items-end gap-2">
                  <LiveBadge
                    scheduledAt={booking.scheduled_at}
                    durationMin={booking.duration_min}
                    defaultLabel={statusInfo.label}
                    className={`glass-badge px-2.5 py-0.5 text-xs ${statusInfo.className}`}
                  />

                  {session?.room_url && (isUpcoming || isLive) && (
                    <Link
                      href={`/student/sessions/${session.id}`}
                      className="flex items-center gap-1.5 glass-gold glass-pill px-3 py-1.5 text-xs font-semibold text-white transition-colors focus-ring"
                    >
                      <Video size={14} />
                      {isLive ? t("انضم الآن", "Join Now") : t("غرفة الجلسة", "Session Room")}
                    </Link>
                  )}

                  {session && booking.status === "completed" && session.actual_duration && (
                    <span className="text-xs text-muted">{session.actual_duration} {t("دقيقة فعلية", "actual min")}</span>
                  )}
                </div>
              </div>
            </div>
          );
        };

        const Section = ({
          icon: Icon, titleAr, titleEn, items, emphasis,
        }: {
          icon: typeof Video;
          titleAr: string;
          titleEn: string;
          items: BookingRow[];
          emphasis?: "live" | "warning";
        }) => {
          if (items.length === 0) return null;
          const tint = emphasis === "live"
            ? "text-gold"
            : emphasis === "warning"
            ? "text-warning"
            : "text-muted";
          return (
            <section className="space-y-3">
              <h2 className={`flex items-center gap-2 text-xs font-medium uppercase tracking-wider ${tint}`}>
                <Icon size={14} aria-hidden="true" />
                {t(titleAr, titleEn)}
                <span className="rounded-full border border-card-border bg-card/40 px-2 py-0.5 text-[10px] tabular-nums text-muted">
                  {items.length}
                </span>
              </h2>
              <div className="space-y-3">{items.map(renderCard)}</div>
            </section>
          );
        };

        return (
          <div className="space-y-8">
            {list.length >= 100 && (
              <p className="rounded-xl border border-card-border bg-card/40 px-4 py-2.5 text-center text-xs text-muted">
                {t("يُعرض آخر 100 جلسة", "Showing your 100 most recent sessions")}
              </p>
            )}
            <Section icon={Video} titleAr="جلسات مباشرة الآن" titleEn="Live now" items={live} emphasis="live" />
            <Section icon={Calendar} titleAr="جلسات قادمة" titleEn="Upcoming" items={upcoming} />
            {needsAttention.length > 0 && (
              <Section icon={AlertTriangle} titleAr="بانتظار التأكيد" titleEn="Awaiting confirmation" items={needsAttention} emphasis="warning" />
            )}
            <Section icon={CheckCircle} titleAr="جلسات سابقة" titleEn="Past sessions" items={completed} />
          </div>
        );
      })()}
    </div>
  );
}
