import type { Metadata } from "next";
import { redirect } from "next/navigation";
import Link from "next/link";
import { Video, Inbox, Radio, BarChart3, Users, TrendingUp } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { getT } from "@/lib/i18n/server";
import { withTimeout } from "@/lib/promise-utils";
import { buildNameMap } from "@/lib/admin/name-map";
import { SessionStatus } from "@/components/shared/session-status";
import { SessionModeBadge, type SessionMode } from "@/components/sessions/SessionModeBadge";
import { StatTile } from "@/components/shared/stat-tile";
import { SessionRowActions } from "./session-row-actions";

const SESSIONS_QUERY_TIMEOUT_MS = 5000;

export const metadata: Metadata = { title: "إدارة الجلسات" };

interface SessionRow {
  id: string;
  booking_id: string | null;
  session_mode: SessionMode;
  room_url: string;
  room_name: string;
  expires_at: string | null;
  started_at: string | null;
  ended_at: string | null;
  actual_duration: number | null;
  teacher_joined: boolean;
  student_joined: boolean;
  created_at: string;
}

const VALID_MODES: SessionMode[] = ["private", "halaqa", "lecture"];

interface BookingInfo {
  id: string;
  student_id: string;
  teacher_id: string;
  scheduled_at: string;
  duration_min: number;
}

export default async function AdminSessionsPage({
  searchParams,
}: {
  searchParams: Promise<{ mode?: string }>;
}) {
  const { t, dir, lang } = await getT();
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  // Mode filter from URL. Defaults to "all" (no filter).
  const sp = await searchParams;
  const modeParam = sp.mode;
  const activeMode = (modeParam && VALID_MODES.includes(modeParam as SessionMode))
    ? (modeParam as SessionMode)
    : null;

  /* ── Parallel queries ──────────────────────────────────────────── */
  let sessionsQuery = supabase
    .from("sessions")
    .select("id, booking_id, session_mode, room_url, room_name, expires_at, started_at, ended_at, actual_duration, teacher_joined, student_joined, created_at")
    .order("created_at", { ascending: false })
    .limit(100);
  if (activeMode) sessionsQuery = sessionsQuery.eq("session_mode", activeMode);

  const [sessionsRes, activeCountRes] = await Promise.all([
    withTimeout(sessionsQuery.returns<SessionRow[]>(), SESSIONS_QUERY_TIMEOUT_MS, { data: [] } as never, "sessionsRes"),
    withTimeout(
      supabase
        .from("sessions")
        .select("id", { count: "exact", head: true })
        .not("started_at", "is", null)
        .is("ended_at", null),
      SESSIONS_QUERY_TIMEOUT_MS,
      { count: 0 } as never,
      "activeCountRes",
    ),
  ]);

  const list = sessionsRes.data ?? [];
  const activeCount = activeCountRes.count ?? 0;

  /* ── Bookings + name resolution (two sequential round-trips, data-dependent) */
  // Halaqa rows have NULL booking_id — filter before the IN() to avoid passing null.
  let bookingMap: Record<string, BookingInfo> = {};
  let nameMap: Record<string, string> = {};

  if (list.length > 0) {
    const bIds = list.map((s) => s.booking_id).filter((id): id is string => id !== null);
    if (bIds.length > 0) {
      const { data: bookings } = await withTimeout(
        supabase
          .from("bookings")
          .select("id, student_id, teacher_id, scheduled_at, duration_min")
          .in("id", bIds)
          .returns<BookingInfo[]>(),
        SESSIONS_QUERY_TIMEOUT_MS,
        { data: [] } as never,
        "bookingsRes",
      );
      if (bookings) {
        bookingMap = Object.fromEntries(bookings.map((b) => [b.id, b]));
        const profileIds = bookings.flatMap((b) => [b.student_id, b.teacher_id]);
        nameMap = await withTimeout(
          buildNameMap(supabase, profileIds),
          SESSIONS_QUERY_TIMEOUT_MS,
          {},
          "nameMapRes",
        );
      }
    }
  }

  /* ── Compute metrics ───────────────────────────────────────────── */
  const totalSessions = list.length;

  const bothJoinedCount = list.filter((s) => s.teacher_joined && s.student_joined).length;
  const completedCount = list.filter((s) => s.ended_at).length;
  const attendanceRate = completedCount > 0
    ? Math.round((bothJoinedCount / completedCount) * 100)
    : 0;

  const sessionsWithDuration = list.filter(
    (s) => s.actual_duration && s.booking_id && bookingMap[s.booking_id]?.duration_min,
  );
  const avgDurationRatio =
    sessionsWithDuration.length > 0
      ? Math.round(
          sessionsWithDuration.reduce((sum, s) => {
            const b = s.booking_id ? bookingMap[s.booking_id] : undefined;
            if (!b) return sum;
            return sum + (s.actual_duration! / b.duration_min) * 100;
          }, 0) / sessionsWithDuration.length,
        )
      : 0;

  const now = Date.now();

  return (
    <div dir={dir} className="mx-auto max-w-6xl px-4 py-8">
      {/* Header */}
      <div className="mb-6 flex flex-wrap items-center gap-3">
        <h1 className="flex items-center gap-2 text-2xl font-bold">
          <Video size={24} className="text-gold" /> {t("إدارة الجلسات", "Manage Sessions")}
        </h1>
        <Link
          href="/admin/sessions/live"
          className="me-auto inline-flex items-center gap-2 rounded-xl border border-success/30 bg-success/10 px-4 py-2 text-sm font-medium text-success transition-colors hover:bg-success/20"
        >
          <Radio size={14} className="animate-pulse" />
          {t("المراقبة المباشرة", "Live Monitor")}
          {activeCount > 0 && (
            <span className="rounded-full bg-success/20 px-2 py-0.5 text-xs font-bold">
              {activeCount}
            </span>
          )}
        </Link>
      </div>

      {/* ── Metrics Summary ─────────────────────────────────────────── */}
      <div className="mb-6 grid grid-cols-2 gap-3 md:grid-cols-4">
        <StatTile
          icon={<BarChart3 size={14} />}
          label={t("إجمالي الجلسات", "Total Sessions")}
          value={totalSessions}
        />

        <Link
          href="/admin/sessions/live"
          className="rounded-2xl border border-success/30 bg-success/5 p-4 transition-colors hover:bg-success/10"
        >
          <div className="flex items-center gap-2 text-sm text-muted">
            <Radio size={14} className="text-success" />
            {t("نشطة الآن", "Active Now")}
          </div>
          <p className="mt-1 text-2xl font-bold text-success">{activeCount}</p>
        </Link>

        <StatTile
          icon={<Users size={14} />}
          label={t("نسبة الحضور", "Attendance Rate")}
          value={`${attendanceRate}%`}
        />

        <StatTile
          icon={<TrendingUp size={14} />}
          label={t("نسبة المدة", "Duration Ratio")}
          value={`${avgDurationRatio}%`}
        />
      </div>

      {/* ── Mode Filter Chips ──────────────────────────────────────── */}
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <span className="text-xs text-muted">{t("تصفية:", "Filter:")}</span>
        <Link
          href="/admin/sessions"
          className={`rounded-full border px-3 py-1 text-xs font-medium transition-colors ${
            !activeMode
              ? "border-gold/40 bg-gold/10 text-gold"
              : "border-card-border bg-surface/40 text-muted hover:text-foreground"
          }`}
        >
          {t("الكل", "All")}
        </Link>
        {VALID_MODES.map((m) => {
          const label =
            m === "private"
              ? t("خاص", "Private")
              : m === "halaqa"
                ? t("حلقة", "Halaqa")
                : t("مجلس", "Majlis");
          return (
            <Link
              key={m}
              href={`/admin/sessions?mode=${m}`}
              className={`rounded-full border px-3 py-1 text-xs font-medium transition-colors ${
                activeMode === m
                  ? "border-gold/40 bg-gold/10 text-gold"
                  : "border-card-border bg-surface/40 text-muted hover:text-foreground"
              }`}
            >
              {label}
            </Link>
          );
        })}
      </div>

      {/* ── Sessions Table ──────────────────────────────────────────── */}
      {list.length === 0 ? (
        <div className="glass-card p-12 text-center">
          <Inbox size={32} className="mx-auto mb-3 text-muted" />
          <p className="text-muted">{t("لا توجد جلسات", "No sessions yet")}</p>
        </div>
      ) : (
        <div className="overflow-x-auto rounded-2xl glass-card">
          <table className="w-full text-sm">
            <thead>
              <tr className="glass-thead">
                <th scope="col" className="px-3 py-3 text-start font-medium text-muted">{t("الطالب", "Student")}</th>
                <th scope="col" className="px-3 py-3 text-start font-medium text-muted">{t("المعلم", "Teacher")}</th>
                <th scope="col" className="px-3 py-3 text-start font-medium text-muted">{t("الموعد", "Date")}</th>
                <th scope="col" className="px-3 py-3 text-start font-medium text-muted">{t("الحالة", "Status")}</th>
                <th scope="col" className="px-3 py-3 text-start font-medium text-muted">{t("المدة", "Duration")}</th>
                <th scope="col" className="px-3 py-3 text-start font-medium text-muted">{t("الحضور", "Attendance")}</th>
                <th scope="col" className="px-3 py-3 text-start font-medium text-muted">{t("إجراءات", "Actions")}</th>
              </tr>
            </thead>
            <tbody>
              {list.map((s) => {
                const b = s.booking_id ? bookingMap[s.booking_id] : undefined;
                const isActive = !!s.started_at && !s.ended_at;
                const isExpired =
                  s.expires_at &&
                  new Date(s.expires_at).getTime() < now &&
                  !s.ended_at;

                return (
                  <tr key={s.id} className="border-b border-white/10 last:border-b-0 hover:bg-surface-alt/50">
                    <td className="px-3 py-3">
                      <Link href={`/admin/sessions/${s.id}`} className="text-gold hover:underline">
                        {b ? nameMap[b.student_id] ?? "—" : "—"}
                      </Link>
                    </td>
                    <td className="px-3 py-3">{b ? nameMap[b.teacher_id] ?? "—" : "—"}</td>
                    <td className="px-3 py-3 text-xs text-muted">
                      {b ? new Date(b.scheduled_at).toLocaleDateString(lang === "ar" ? "ar-EG" : "en-US") : "—"}
                    </td>
                    <td className="px-3 py-3">
                      <div className="flex flex-wrap items-center gap-1.5">
                        {b ? (
                          <SessionStatus
                            scheduledAt={b.scheduled_at}
                            durationMin={b.duration_min}
                            expiresAt={s.expires_at}
                            endedAt={s.ended_at}
                          />
                        ) : (
                          <span className="text-xs text-muted">—</span>
                        )}
                        <SessionModeBadge mode={s.session_mode} size="sm" />
                      </div>
                    </td>
                    <td className="px-3 py-3 text-xs">
                      {s.actual_duration
                        ? lang === "ar" ? `${s.actual_duration} د` : `${s.actual_duration}m`
                        : s.ended_at
                          ? "—"
                          : s.started_at
                            ? <span className="text-success">{t("جارية", "live")}</span>
                            : "—"}
                    </td>
                    <td className="px-3 py-3 text-xs">
                      <span className={s.teacher_joined ? "text-success" : "text-red-400"}>
                        {lang === "ar" ? "م" : "T"}{s.teacher_joined ? "✓" : "✗"}
                      </span>{" "}
                      <span className={s.student_joined ? "text-success" : "text-red-400"}>
                        {lang === "ar" ? "ط" : "S"}{s.student_joined ? "✓" : "✗"}
                      </span>
                    </td>
                    <td className="px-3 py-3">
                      <SessionRowActions
                        sessionId={s.id}
                        isActive={isActive}
                        isExpired={!!isExpired}
                      />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
