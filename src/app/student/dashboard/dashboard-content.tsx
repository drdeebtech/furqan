"use client";

import { useEffect } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Calendar, CheckCircle, Clock, Search, Star, TrendingUp, Video, BookOpen, FileText } from "lucide-react";
import { useLang } from "@/lib/i18n/context";
import { useToast } from "@/components/shared/toast";
import { GuidanceBanner } from "./guidance-banner";
import { QuickActions } from "./quick-actions";

const SESSION_TYPE: Record<string, { ar: string; en: string }> = {
  hifz: { ar: "حفظ", en: "Hifz" },
  muraja: { ar: "مراجعة", en: "Muraja'a" },
  tajweed: { ar: "تجويد", en: "Tajweed" },
  tilawa: { ar: "تلاوة", en: "Tilawa" },
  qiraat: { ar: "قراءات", en: "Qira'at" },
  tafsir: { ar: "تفسير", en: "Tafsir" },
  combined: { ar: "حفظ + مراجعة", en: "Hifz + Muraja'a" },
  other: { ar: "أخرى", en: "Other" },
};

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
}

export function StudentDashboardContent({ data }: { data: DashboardData }) {
  const { t, dir, lang } = useLang();
  const toast = useToast();
  const searchParams = useSearchParams();
  const { fullName, nextBooking, sessionId, totalSessions, monthSessions, pendingBookings, recent, evaluations, nameMap, notesMap } = data;

  // Show success toast after booking redirect
  useEffect(() => {
    if (searchParams.get("booked") === "1") {
      toast.success(t("تم الحجز بنجاح! سيتم تأكيده من المعلم", "Booking submitted! Teacher will confirm soon."));
      window.history.replaceState(null, "", "/student/dashboard");
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const pendingHomework = Object.entries(notesMap).filter(([, n]) => n.homework);

  let countdown = "";
  let countdownColor = "text-muted";
  if (nextBooking) {
    const diff = new Date(nextBooking.scheduled_at).getTime() - Date.now();
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
    const s = SESSION_TYPE[type];
    return s ? t(s.ar, s.en) : type;
  };

  return (
    <>
      <div className="h-0.5 bg-gradient-to-l from-gold/0 via-gold/30 to-gold/0" />
      <div dir={dir} className="mx-auto max-w-4xl px-4 py-8">
        <h1 className="text-2xl font-bold">{t("أهلاً", "Welcome")}{fullName ? ` ${fullName}` : ""}</h1>
        <p className="mt-1 text-sm text-muted">{t("مرحباً بك في أكاديمية فُرقان", "Welcome to FURQAN Academy")}</p>

        {totalSessions === 0 && !nextBooking && <GuidanceBanner />}

        {nextBooking ? (
          <div className="mt-8 rounded-2xl border border-gold/30 bg-card p-8">
            <p className="mb-2 text-sm font-bold text-gold"><Star size={14} className="inline text-gold" /> {t("جلستك القادمة", "Your Next Session")}</p>
            <p className="text-lg font-bold">{t("مع", "With")} {nameMap[nextBooking.teacher_id] ?? t("معلم", "Teacher")}</p>
            <p className="mt-1 text-sm text-muted">
              {st(nextBooking.session_type)} · {nextBooking.duration_min} {t("دقيقة", "min")}
            </p>
            <p dir="ltr" className="mt-2 text-left text-sm text-muted">
              {new Date(nextBooking.scheduled_at).toLocaleDateString(lang === "ar" ? "ar-SA" : "en-US", { weekday: "long", year: "numeric", month: "long", day: "numeric" })}
              {" · "}
              {new Date(nextBooking.scheduled_at).toLocaleTimeString(lang === "ar" ? "ar-SA" : "en-US", { hour: "2-digit", minute: "2-digit" })}
            </p>
            <p className={`mt-2 text-sm font-medium ${countdownColor}`}>{countdown}</p>
            <div className="mt-4 flex flex-wrap items-center gap-3">
              {sessionId && (
                <Link href={`/student/sessions/${sessionId}`} className="flex items-center gap-2 rounded-lg bg-green-600 px-6 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-green-700">
                  <Video size={16} /> {t("انضم للجلسة", "Join Session")}
                </Link>
              )}
              <Link href="/student/teachers" className="text-sm text-gold hover:text-gold-hover">
                {t("احجز جلسة أخرى ←", "Book Another Session →")}
              </Link>
            </div>
          </div>
        ) : totalSessions > 0 ? (
          <div className="mt-8 rounded-2xl border-2 border-dashed border-card-border p-8 text-center">
            <Calendar size={28} className="mx-auto mb-3 text-muted" />
            <p className="text-muted">{t("لا توجد جلسات قادمة", "No upcoming sessions")}</p>
            <Link href="/student/teachers" className="mt-4 inline-flex items-center gap-2 rounded-lg bg-gold px-6 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-gold-hover">
              <Search size={16} /> {t("احجز جلسة الآن", "Book a Session")}
            </Link>
          </div>
        ) : null}

        <QuickActions />

        <div className="mt-6 grid grid-cols-2 gap-3 md:grid-cols-4">
          <Link href="/student/sessions" className="rounded-xl border border-card-border bg-card p-4 transition-colors hover:border-gold/40">
            <CheckCircle size={16} className="mb-1 text-gold" />
            <p className="text-2xl font-bold text-gold">{totalSessions}</p>
            <p className="text-xs text-muted">{t("إجمالي الجلسات", "Total Sessions")}</p>
          </Link>
          <Link href="/student/sessions" className="rounded-xl border border-card-border bg-card p-4 transition-colors hover:border-gold/40">
            <Calendar size={16} className="mb-1 text-gold" />
            <p className="text-2xl font-bold text-gold">{monthSessions}</p>
            <p className="text-xs text-muted">{t("جلسات هذا الشهر", "This Month")}</p>
          </Link>
          <Link href="/student/bookings" className="rounded-xl border border-card-border bg-card p-4 transition-colors hover:border-gold/40">
            <Clock size={16} className="mb-1 text-gold" />
            <p className="text-2xl font-bold text-gold">{pendingBookings}</p>
            <p className="text-xs text-muted">{t("حجوزات معلّقة", "Pending Bookings")}</p>
          </Link>
          <Link href="/student/progress" className="rounded-xl border border-gold/20 bg-gold/5 p-4 transition-colors hover:border-gold/40">
            <TrendingUp size={16} className="mb-1 text-gold" />
            <p className="text-sm font-bold text-gold">{t("تقدمي", "My Progress")}</p>
            <p className="text-xs text-muted">{t("عرض رحلتي مع القرآن", "View my Quran journey")}</p>
          </Link>
        </div>

        {pendingHomework.length > 0 && (
          <div className="mt-8">
            <h2 className="mb-4 flex items-center gap-2 text-lg font-semibold">
              <BookOpen size={18} className="text-gold" /> {t("الواجبات المنزلية", "Homework")}
            </h2>
            <div className="space-y-2">
              {pendingHomework.map(([bookingId, h]) => {
                const booking = recent.find(r => r.id === bookingId);
                return (
                  <div key={bookingId} className="rounded-xl border border-blue-500/20 bg-blue-500/5 p-4">
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <p className="text-sm font-medium">{booking ? nameMap[booking.teacher_id] ?? t("معلم", "Teacher") : t("معلم", "Teacher")}</p>
                        <p className="mt-1 text-sm">{h.homework}</p>
                      </div>
                      {booking && <p className="shrink-0 text-xs text-muted">{new Date(booking.scheduled_at).toLocaleDateString(lang === "ar" ? "ar-SA" : "en-US")}</p>}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {evaluations.length > 0 && (
          <div className="mt-8">
            <h2 className="mb-4 flex items-center gap-2 text-lg font-semibold">
              <Star size={18} className="text-gold" /> {t("تقييمات معلمك", "Teacher Evaluations")}
            </h2>
            <div className="space-y-3">
              {evaluations.map(ev => (
                <div key={ev.id} className="rounded-xl border border-card-border bg-card p-4">
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <p className="text-sm font-medium">{nameMap[ev.teacher_id] ?? t("معلم", "Teacher")}</p>
                      <p className="mt-0.5 text-xs text-muted">{ev.evaluation_type}</p>
                    </div>
                    <span className={`rounded-full border px-3 py-1 text-sm font-bold ${ev.overall_score >= 8 ? "border-green-500/30 text-green-400" : ev.overall_score >= 5 ? "border-amber-500/30 text-amber-400" : "border-red-500/30 text-red-400"}`}>
                      {ev.overall_score}/10
                    </span>
                  </div>
                  <div className="mt-3 flex flex-wrap gap-3 text-xs">
                    {ev.hifz_score != null && <span className="rounded border border-card-border px-2 py-0.5">{t("حفظ", "Hifz")}: {ev.hifz_score}/10</span>}
                    {ev.tajweed_score != null && <span className="rounded border border-card-border px-2 py-0.5">{t("تجويد", "Tajweed")}: {ev.tajweed_score}/10</span>}
                  </div>
                  {ev.strengths && <p className="mt-2 text-xs"><span className="text-green-400">{t("نقاط القوة:", "Strengths:")}</span> {ev.strengths}</p>}
                  {ev.weaknesses && <p className="mt-1 text-xs"><span className="text-amber-400">{t("نقاط الضعف:", "Weaknesses:")}</span> {ev.weaknesses}</p>}
                  {ev.recommendations && <p className="mt-1 text-xs"><span className="text-gold">{t("توصيات:", "Recommendations:")}</span> {ev.recommendations}</p>}
                </div>
              ))}
            </div>
          </div>
        )}

        {recent.length > 0 && (
          <div className="mt-8">
            <div className="mb-4 flex items-center justify-between">
              <h2 className="flex items-center gap-2 text-lg font-semibold"><FileText size={18} className="text-gold" /> {t("آخر الجلسات", "Recent Sessions")}</h2>
              <Link href="/student/sessions" className="text-sm text-gold hover:text-gold-hover">{t("عرض الكل ←", "View All →")}</Link>
            </div>
            <div className="space-y-3">
              {recent.map(r => {
                const note = notesMap[r.id];
                return (
                  <div key={r.id} className="rounded-xl border border-card-border bg-card p-4">
                    <div className="flex items-center justify-between">
                      <div>
                        <p className="text-sm font-medium">{nameMap[r.teacher_id] ?? t("معلم", "Teacher")}</p>
                        <p className="text-xs text-muted">{st(r.session_type)} · {r.duration_min} {t("د", "min")}</p>
                      </div>
                      <p className="text-xs text-muted">{new Date(r.scheduled_at).toLocaleDateString(lang === "ar" ? "ar-SA" : "en-US")}</p>
                    </div>
                    {note?.post_session_notes && (
                      <div className="mt-2 rounded-lg border border-gold/20 bg-gold/5 p-2">
                        <p className="text-xs font-medium text-gold"><FileText size={10} className="inline" /> {t("ملاحظات المعلم:", "Teacher Notes:")}</p>
                        <p className="mt-0.5 text-xs text-muted">{note.post_session_notes.length > 120 ? note.post_session_notes.slice(0, 120) + "…" : note.post_session_notes}</p>
                      </div>
                    )}
                    {note?.homework && (
                      <div className="mt-1 rounded-lg border border-blue-500/20 bg-blue-500/5 p-2">
                        <p className="text-xs font-medium text-blue-400"><BookOpen size={10} className="inline" /> {t("واجب:", "Homework:")}</p>
                        <p className="mt-0.5 text-xs text-muted">{note.homework.length > 100 ? note.homework.slice(0, 100) + "…" : note.homework}</p>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>
    </>
  );
}
