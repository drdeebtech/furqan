"use client";

import Link from "next/link";
import { Calendar, Clock, Hourglass, Star, Users } from "lucide-react";
import { useLang } from "@/lib/i18n/context";
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
      <div dir={dir} className="mx-auto max-w-4xl px-4 py-8">
        <h1 className="text-2xl font-bold">{t("أهلاً", "Welcome")}{fullName ? ` ${fullName}` : ""}</h1>
        <p className="mt-1 text-sm text-muted">{t("مرحباً بك في لوحة المعلم", "Welcome to the Teacher Dashboard")}</p>

        <TeacherGuidanceBanner cvStatus={cvStatus} hasStudents={uniqueStudents > 0} />

        {todaySessions.length > 0 && (
          <div className="mt-8">
            <h2 className="mb-4 flex items-center gap-2 text-lg font-semibold"><Calendar size={18} className="text-gold" /> {t("جلسات اليوم", "Today's Sessions")}</h2>
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
        )}

        <TeacherQuickActions students={Object.entries(nameMap).map(([id, name]) => ({ id, name }))} />

        <div className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Link href="/teacher/students" className="rounded-xl border border-card-border bg-card p-4 transition-colors hover:border-gold/40">
            <Users size={16} className="mb-1 text-gold" />
            <p className="text-2xl font-bold text-gold">{uniqueStudents}</p>
            <p className="text-xs text-muted">{t("طلابي", "My Students")}</p>
          </Link>
          <Link href="/teacher/sessions" className="rounded-xl border border-card-border bg-card p-4 transition-colors hover:border-gold/40">
            <Calendar size={16} className="mb-1 text-gold" />
            <p className="text-2xl font-bold text-gold">{monthSessions}</p>
            <p className="text-xs text-muted">{t("جلسات هذا الشهر", "This Month")}</p>
          </Link>
          <Link href="#pending" className="rounded-xl border border-card-border bg-card p-4 transition-colors hover:border-gold/40">
            <Hourglass size={16} className="mb-1 text-gold" />
            <p className="text-2xl font-bold text-gold">{pendingCount}</p>
            <p className="text-xs text-muted">{t("طلبات معلّقة", "Pending Requests")}</p>
          </Link>
          <Link href="/teacher/evaluations" className="rounded-xl border border-card-border bg-card p-4 transition-colors hover:border-gold/40">
            <Star size={16} className="mb-1 text-gold" />
            <p className="text-2xl font-bold text-gold">{ratingAvg > 0 ? ratingAvg.toFixed(1) : "—"}</p>
            <p className="text-xs text-muted">{t("التقييم", "Rating")}</p>
          </Link>
        </div>

        <div id="pending" className="mt-8">
          <h2 className="mb-4 flex items-center gap-2 text-lg font-semibold"><Clock size={18} className="text-gold" /> {t("حجوزات بانتظار التأكيد", "Pending Bookings")}</h2>
          {pending.length === 0 ? (
            <div className="rounded-xl border border-card-border bg-card p-8 text-center">
              <Clock size={24} className="mx-auto mb-2 text-muted" />
              <p className="text-sm text-muted">{t("لا توجد حجوزات معلقة", "No pending bookings")}</p>
            </div>
          ) : (
            <div className="space-y-3">
              {pending.map(b => (
                <div key={b.id} className="rounded-xl border border-card-border bg-card p-4">
                  <div className="flex items-start justify-between gap-4">
                    <div className="min-w-0 flex-1">
                      <p className="font-medium">{nameMap[b.student_id] ?? t("طالب", "Student")}</p>
                      <p className="mt-1 text-sm text-gold">{st(b.session_type)} · {b.duration_min} {t("دقيقة", "min")} · ${b.amount_usd}</p>
                      <p dir="ltr" className="mt-1 text-left text-sm text-muted">
                        {new Date(b.scheduled_at).toLocaleDateString("ar-SA", { weekday: "long", year: "numeric", month: "long", day: "numeric" })}
                        {" · "}
                        {new Date(b.scheduled_at).toLocaleTimeString("ar-SA", { hour: "2-digit", minute: "2-digit" })}
                      </p>
                    </div>
                    <BookingActions bookingId={b.id} />
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
