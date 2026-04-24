import { redirect } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getT } from "@/lib/i18n/server";
import { TabBar } from "./tab-bar";
import { AccountForm } from "./account-form";
import { TeacherProfileForm } from "./teacher-profile-form";
import { CvPanel } from "./cv-panel";
import { IjazasEditor } from "./ijazas-editor";
import { AvailabilityEditor } from "./availability-editor";

interface Props {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ tab?: string }>;
}

export default async function TeacherDetailPage({ params, searchParams }: Props) {
  const { id } = await params;
  const { tab } = await searchParams;
  const activeTab = tab ?? "overview";

  const { t, dir } = await getT();
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  // Fetch everything in parallel
  const [
    tpRes,
    profileRes,
    ijazasRes,
    availabilityRes,
    exceptionsRes,
    bookingCountRes,
    authUserRes,
  ] = await Promise.all([
    supabase
      .from("teacher_profiles")
      .select(
        "teacher_id, bio, bio_en, specialties, hourly_rate, gender, languages, recitation_standards, is_accepting, is_archived, max_active_students, total_sessions, rating_avg, intro_video_url, cv_status, cv_submitted_at, cv_rejection_reason",
      )
      .eq("teacher_id", id)
      .single(),
    supabase
      .from("profiles")
      .select(
        "id, full_name, phone, country, timezone, lang, avatar_url, date_of_birth, parent_name, parent_phone, parent_email, is_active",
      )
      .eq("id", id)
      .single(),
    supabase
      .from("teacher_ijaza")
      .select(
        "id, riwaya, chain_text, granted_by, granted_at, document_url, verified_by, verified_at",
      )
      .eq("teacher_id", id)
      .order("created_at", { ascending: false }),
    supabase
      .from("teacher_availability")
      .select("id, day_of_week, start_time, end_time, slot_duration, is_active")
      .eq("teacher_id", id),
    supabase
      .from("availability_exceptions")
      .select("id, date, start_time, end_time, is_blocked, reason")
      .eq("teacher_id", id)
      .gte("date", new Date().toISOString().slice(0, 10))
      .order("date", { ascending: true }),
    supabase.from("bookings").select("id", { count: "exact", head: true }).eq("teacher_id", id),
    (async () => {
      try {
        const admin = createAdminClient();
        return await admin.auth.admin.getUserById(id);
      } catch {
        return { data: { user: null }, error: null };
      }
    })(),
  ]);

  const tp = tpRes.data as {
    teacher_id: string;
    bio: string | null;
    bio_en: string | null;
    specialties: string[];
    hourly_rate: number;
    gender: string | null;
    languages: string[];
    recitation_standards: string[];
    is_accepting: boolean;
    is_archived: boolean;
    max_active_students: number | null;
    total_sessions: number;
    rating_avg: number;
    intro_video_url: string | null;
    cv_status: string | null;
    cv_submitted_at: string | null;
    cv_rejection_reason: string | null;
  } | null;

  if (!tp) redirect("/admin/teachers");

  const profile = profileRes.data as {
    id: string;
    full_name: string | null;
    phone: string | null;
    country: string | null;
    timezone: string | null;
    lang: string | null;
    avatar_url: string | null;
    date_of_birth: string | null;
    parent_name: string | null;
    parent_phone: string | null;
    parent_email: string | null;
    is_active: boolean | null;
  } | null;

  const ijazas = (ijazasRes.data ?? []) as {
    id: string;
    riwaya: string;
    chain_text: string;
    granted_by: string | null;
    granted_at: string | null;
    document_url: string | null;
    verified_by: string | null;
    verified_at: string | null;
  }[];

  const slots = (availabilityRes.data ?? []) as {
    id: string;
    day_of_week: number;
    start_time: string;
    end_time: string;
    slot_duration: number;
    is_active: boolean;
  }[];

  const exceptions = (exceptionsRes.data ?? []) as {
    id: string;
    date: string;
    start_time: string | null;
    end_time: string | null;
    is_blocked: boolean;
    reason: string | null;
  }[];

  const currentEmail = authUserRes.data?.user?.email ?? "";

  return (
    <div dir={dir} className="mx-auto max-w-4xl px-4 py-8">
      <Link
        href="/admin/teachers"
        className="mb-4 inline-block text-sm text-gold hover:text-gold-light"
      >
        {t("→ العودة للمعلمين", "← Back to Teachers")}
      </Link>

      <div className="mb-2 flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-bold">
          {profile?.full_name ?? t("معلم", "Teacher")}
        </h1>
        <div className="flex gap-2 text-xs text-muted">
          <span>{tp.total_sessions} {t("جلسة", "sessions")}</span>
          <span>· {t("تقييم", "Rating")} {Number(tp.rating_avg).toFixed(1)}</span>
          <span>· {bookingCountRes.count ?? 0} {t("حجز", "bookings")}</span>
        </div>
      </div>

      <TabBar teacherId={id} />

      {activeTab === "overview" && (
        <OverviewPanel
          teacherId={id}
          tp={tp}
          t={t}
        />
      )}

      {activeTab === "account" && profile && (
        <AccountForm
          teacherId={id}
          currentEmail={currentEmail}
          profile={profile}
        />
      )}

      {activeTab === "profile" && (
        <TeacherProfileForm
          teacherId={id}
          profile={{
            hourly_rate: tp.hourly_rate,
            gender: tp.gender,
            max_active_students: tp.max_active_students,
            is_accepting: tp.is_accepting,
            is_archived: tp.is_archived,
          }}
        />
      )}

      {activeTab === "cv" && (
        <CvPanel
          teacherId={id}
          profile={{
            bio: tp.bio,
            bio_en: tp.bio_en,
            specialties: tp.specialties,
            languages: tp.languages,
            recitation_standards: tp.recitation_standards,
            intro_video_url: tp.intro_video_url,
            cv_status: tp.cv_status,
            cv_submitted_at: tp.cv_submitted_at,
            cv_rejection_reason: tp.cv_rejection_reason,
          }}
        />
      )}

      {activeTab === "ijazas" && (
        <IjazasEditor teacherId={id} ijazas={ijazas} />
      )}

      {activeTab === "availability" && (
        <AvailabilityEditor teacherId={id} slots={slots} exceptions={exceptions} />
      )}
    </div>
  );
}

async function OverviewPanel({
  teacherId,
  tp,
  t,
}: {
  teacherId: string;
  tp: { is_accepting: boolean; is_archived: boolean; cv_status: string | null };
  t: (ar: string, en: string) => string;
}) {
  const supabase = await createClient();
  const since = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString();

  const [bookingsRes, sessionsRes, homeworkRes, evalsRes] = await Promise.all([
    supabase
      .from("bookings")
      .select("id, status, scheduled_at, teacher_confirmed, teacher_confirmed_at")
      .eq("teacher_id", teacherId)
      .gte("scheduled_at", since),
    supabase
      .from("sessions")
      .select(
        "id, started_at, teacher_joined, booking_id, bookings!inner(teacher_id, scheduled_at)",
      )
      .eq("bookings.teacher_id", teacherId)
      .gte("bookings.scheduled_at", since),
    supabase
      .from("homework_assignments")
      .select("status, ready_at, completed_at")
      .eq("teacher_id", teacherId)
      .gte("assigned_at", since),
    supabase
      .from("session_evaluations")
      .select("id", { count: "exact", head: true })
      .eq("teacher_id", teacherId)
      .gte("period_start", since),
  ]);

  const bookings90 = (bookingsRes.data ?? []) as {
    status: string;
    scheduled_at: string;
  }[];
  const decided = bookings90.filter((b) => b.status !== "pending");
  const noShows = bookings90.filter((b) => b.status === "no_show").length;
  const noShowRate = decided.length > 0 ? (noShows / decided.length) * 100 : 0;

  const sessions90 = (sessionsRes.data ?? []) as {
    started_at: string | null;
    teacher_joined: boolean;
    bookings: { scheduled_at: string };
  }[];
  const startedSessions = sessions90.filter((s) => s.started_at && s.teacher_joined);
  const onTime = startedSessions.filter((s) => {
    const scheduled = new Date(s.bookings.scheduled_at).getTime();
    const started = new Date(s.started_at!).getTime();
    return started - scheduled <= 5 * 60 * 1000;
  }).length;
  const punctualityRate =
    startedSessions.length > 0 ? (onTime / startedSessions.length) * 100 : 0;

  const gradedHw = (homeworkRes.data ?? []).filter(
    (h: { ready_at: string | null; completed_at: string | null }) =>
      h.ready_at && h.completed_at,
  );
  const avgGradingLagHours =
    gradedHw.length > 0
      ? gradedHw.reduce(
          (sum: number, h: { ready_at: string | null; completed_at: string | null }) =>
            sum +
            (new Date(h.completed_at!).getTime() - new Date(h.ready_at!).getTime()),
          0,
        ) /
        gradedHw.length /
        (60 * 60 * 1000)
      : 0;

  const completedCount = sessions90.filter((s) => s.started_at).length;
  const evalRate =
    completedCount > 0
      ? Math.min(100, ((evalsRes.count ?? 0) / (completedCount / 4)) * 100)
      : 0;

  const fmt = (n: number) => n.toFixed(1);
  const tone = (ok: boolean, warn: boolean) =>
    ok ? "text-emerald-400" : warn ? "text-amber-400" : "text-rose-400";

  return (
    <div className="space-y-6">
      {/* Status row */}
      <div className="flex flex-wrap gap-2 text-xs">
        <span
          className={`glass-badge ${
            tp.is_archived
              ? "border-rose-500/30 bg-rose-500/10 text-rose-400"
              : tp.is_accepting
                ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-400"
                : "border-amber-500/30 bg-amber-500/10 text-amber-400"
          }`}
        >
          {tp.is_archived
            ? t("مؤرشف", "Archived")
            : tp.is_accepting
              ? t("يقبل طلاب", "Accepting")
              : t("مشغول", "Busy")}
        </span>
        <span
          className={`glass-badge ${
            tp.cv_status === "approved"
              ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-400"
              : tp.cv_status === "pending_review"
                ? "border-amber-500/30 bg-amber-500/10 text-amber-400"
                : tp.cv_status === "rejected"
                  ? "border-rose-500/30 bg-rose-500/10 text-rose-400"
                  : "border-white/20 bg-white/5 text-muted"
          }`}
        >
          CV: {tp.cv_status ?? "draft"}
        </span>
      </div>

      {/* Health metrics */}
      <div className="glass-card rounded-xl p-6">
        <h2 className="mb-4 font-bold">
          {t("مؤشرات الأداء (آخر 90 يومًا)", "Performance (Last 90 Days)")}
        </h2>
        <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
          <div>
            <p className="text-xs text-muted">{t("الالتزام بالمواعيد", "Punctuality")}</p>
            <p className={`mt-1 text-xl font-bold ${tone(punctualityRate >= 90, punctualityRate >= 75)}`}>
              {fmt(punctualityRate)}%
            </p>
            <p className="text-xs text-muted">
              {startedSessions.length} {t("جلسة", "sessions")}
            </p>
          </div>
          <div>
            <p className="text-xs text-muted">{t("متوسط تأخر التصحيح", "Avg Grading Lag")}</p>
            <p
              className={`mt-1 text-xl font-bold ${tone(avgGradingLagHours <= 24, avgGradingLagHours <= 48)}`}
            >
              {fmt(avgGradingLagHours)} {t("س", "h")}
            </p>
            <p className="text-xs text-muted">
              {gradedHw.length} {t("واجب", "homework")}
            </p>
          </div>
          <div>
            <p className="text-xs text-muted">{t("نسبة إنجاز التقييمات", "Evaluations")}</p>
            <p className={`mt-1 text-xl font-bold ${tone(evalRate >= 80, evalRate >= 50)}`}>
              {fmt(evalRate)}%
            </p>
            <p className="text-xs text-muted">
              {evalsRes.count ?? 0} / {completedCount}
            </p>
          </div>
          <div>
            <p className="text-xs text-muted">{t("نسبة الغياب", "No-Show Rate")}</p>
            <p className={`mt-1 text-xl font-bold ${tone(noShowRate <= 5, noShowRate <= 15)}`}>
              {fmt(noShowRate)}%
            </p>
            <p className="text-xs text-muted">
              {noShows} / {decided.length}
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
