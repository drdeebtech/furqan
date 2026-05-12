import type { Metadata } from "next";
import Link from "next/link";
import { redirect, notFound, forbidden } from "next/navigation";
import { ArrowLeft, ArrowRight, BookOpen, Users, Clock, UserCheck } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getT } from "@/lib/i18n/server";
import { PageHeader } from "@/components/shared/page-header";
import { EmptyState } from "@/components/shared/empty-state";
import { SessionModeBadge } from "@/components/sessions/SessionModeBadge";

export const metadata: Metadata = { title: "حلقة المعلم" };

interface HalaqaRow {
  id: string;
  session_mode: string;
  scheduled_at: string | null;
  capacity: number;
  current_enrollment: number;
  min_participants: number;
  session_topic_ar: string | null;
  session_topic_en: string | null;
  surah_reference: string | null;
  ayah_range: string | null;
  allow_recording: boolean;
  started_at: string | null;
  ended_at: string | null;
}

interface RosterRow {
  user_id: string;
  role: string;
  attendance_status: string;
  joined_at: string | null;
  left_at: string | null;
  profiles: { full_name: string | null } | null;
}

const ATTENDANCE_LABEL: Record<string, { ar: string; en: string; tone: string }> = {
  registered: { ar: "مسجّل", en: "Registered", tone: "border-card-border bg-surface/40 text-muted" },
  attended: { ar: "حضر", en: "Attended", tone: "border-emerald-400/25 bg-emerald-500/10 text-emerald-400" },
  absent: { ar: "غاب", en: "Absent", tone: "border-error/25 bg-error/10 text-error" },
  late: { ar: "متأخّر", en: "Late", tone: "border-warning/25 bg-warning/10 text-warning" },
  left_early: { ar: "غادر مبكراً", en: "Left early", tone: "border-warning/25 bg-warning/10 text-warning" },
};

export default async function TeacherHalaqaPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const { t, dir, lang } = await getT();
  const locale = lang === "ar" ? "ar-EG" : "en-US";

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const admin = createAdminClient();

  // Authorize: caller must be the teacher of this halaqa.
  const { data: teacherRow } = await admin
    .from("session_participants")
    .select("id")
    .eq("session_id", id)
    .eq("user_id", user.id)
    .eq("role", "teacher")
    .maybeSingle();
  if (!teacherRow) forbidden();

  const { data: halaqa } = await admin
    .from("sessions")
    .select(
      "id, session_mode, scheduled_at, capacity, current_enrollment, min_participants, session_topic_ar, session_topic_en, surah_reference, ayah_range, allow_recording, started_at, ended_at",
    )
    .eq("id", id)
    .eq("session_mode", "halaqa")
    .maybeSingle<HalaqaRow>();
  if (!halaqa) notFound();

  // Roster — students only (the teacher's own row is implicit).
  const { data: students } = await admin
    .from("session_participants")
    .select(
      "user_id, role, attendance_status, joined_at, left_at, profiles!session_participants_user_id_fkey(full_name)",
    )
    .eq("session_id", id)
    .eq("role", "student")
    .returns<RosterRow[]>();

  // Waiting list (pending only).
  const { data: waiting } = await admin
    .from("halaqa_waiting_list")
    .select(
      "student_id, position, profiles!halaqa_waiting_list_student_id_fkey(full_name)",
    )
    .eq("session_id", id)
    .is("promoted_at", null)
    .order("position", { ascending: true })
    .returns<{ student_id: string; position: number; profiles: { full_name: string | null } | null }[]>();

  const roster = students ?? [];
  const waitlist = waiting ?? [];
  const title = (lang === "ar" ? halaqa.session_topic_ar : halaqa.session_topic_en) ?? "—";
  const date = halaqa.scheduled_at ? new Date(halaqa.scheduled_at) : null;
  const Arrow = dir === "rtl" ? ArrowRight : ArrowLeft;

  return (
    <main dir={dir} className="mx-auto max-w-4xl px-4 py-8 sm:px-6">
      <Link
        href="/teacher/dashboard"
        className="mb-4 inline-flex items-center gap-1.5 text-sm text-muted transition-colors hover:text-gold"
      >
        <Arrow size={14} />
        {t("لوحة المعلم", "Teacher dashboard")}
      </Link>

      <PageHeader
        icon={<BookOpen size={24} className="text-gold" />}
        title={title}
        actions={<SessionModeBadge mode="halaqa" />}
      />

      {/* Halaqa metadata */}
      <div className="glass-card mt-2 grid gap-3 rounded-xl p-6 sm:grid-cols-2">
        {date ? (
          <div>
            <p className="text-xs font-medium uppercase tracking-wider text-muted">
              {t("الموعد", "Scheduled")}
            </p>
            <p dir="ltr" className="mt-0.5 text-left font-medium">
              {date.toLocaleDateString(locale, {
                weekday: "long",
                year: "numeric",
                month: "long",
                day: "numeric",
              })}{" "}
              · {date.toLocaleTimeString(locale, { hour: "2-digit", minute: "2-digit" })}
            </p>
          </div>
        ) : null}
        <div>
          <p className="text-xs font-medium uppercase tracking-wider text-muted">
            {t("التسجيل", "Enrollment")}
          </p>
          <p className="mt-0.5 flex items-center gap-1.5 font-medium">
            <Users size={14} className="text-muted" aria-hidden="true" />
            {halaqa.current_enrollment}/{halaqa.capacity}
            <span className="text-xs text-muted">
              ({t("الحد الأدنى:", "min:")} {halaqa.min_participants})
            </span>
          </p>
        </div>
        {halaqa.surah_reference ? (
          <div className="sm:col-span-2">
            <p className="text-xs font-medium uppercase tracking-wider text-muted">
              {t("السورة والآيات", "Surah / Ayah")}
            </p>
            <p className="mt-0.5 font-medium">
              {halaqa.surah_reference}
              {halaqa.ayah_range ? <span className="ms-2 text-muted">· {halaqa.ayah_range}</span> : null}
            </p>
          </div>
        ) : null}
      </div>

      {/* Roster */}
      <section className="mt-8">
        <h2 className="mb-3 flex items-center gap-2 text-lg font-semibold">
          <UserCheck size={18} className="text-gold" aria-hidden="true" />
          {t("الطلاب المسجّلون", "Enrolled Students")}
          <span className="text-xs font-normal text-muted">({roster.length})</span>
        </h2>
        {roster.length === 0 ? (
          <EmptyState
            variant="glass-card"
            icon={<Users size={32} className="text-muted" />}
            message={t("لم يسجّل أحد بعد", "No one enrolled yet")}
            hint={t(
              "ستظهر أسماء الطلاب فور تسجيلهم في الحلقة.",
              "Student names will appear as soon as they enroll.",
            )}
          />
        ) : (
          <div className="overflow-hidden rounded-xl glass-card">
            <table className="w-full text-sm">
              <thead>
                <tr className="glass-thead">
                  <th scope="col" className="px-4 py-3 text-start font-medium text-muted">
                    {t("الاسم", "Name")}
                  </th>
                  <th scope="col" className="px-4 py-3 text-start font-medium text-muted">
                    {t("الحضور", "Attendance")}
                  </th>
                  <th scope="col" className="px-4 py-3 text-start font-medium text-muted">
                    {t("انضم في", "Joined")}
                  </th>
                </tr>
              </thead>
              <tbody>
                {roster.map((r) => {
                  const att = ATTENDANCE_LABEL[r.attendance_status] ?? ATTENDANCE_LABEL.registered;
                  return (
                    <tr key={r.user_id} className="border-b border-white/10 last:border-b-0">
                      <td className="px-4 py-3 font-medium">
                        {r.profiles?.full_name ?? t("طالب", "Student")}
                      </td>
                      <td className="px-4 py-3">
                        <span className={`rounded-full border px-2.5 py-0.5 text-xs font-medium ${att.tone}`}>
                          {lang === "ar" ? att.ar : att.en}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-xs text-muted" dir="ltr">
                        {r.joined_at
                          ? new Date(r.joined_at).toLocaleString(locale, {
                              month: "short",
                              day: "numeric",
                              hour: "2-digit",
                              minute: "2-digit",
                            })
                          : "—"}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* Waiting list */}
      {waitlist.length > 0 ? (
        <section className="mt-8">
          <h2 className="mb-3 flex items-center gap-2 text-lg font-semibold">
            <Clock size={18} className="text-gold" aria-hidden="true" />
            {t("قائمة الانتظار", "Waiting List")}
            <span className="text-xs font-normal text-muted">({waitlist.length})</span>
          </h2>
          <ul className="space-y-2">
            {waitlist.map((w) => (
              <li
                key={w.student_id}
                className="glass-card flex items-center justify-between rounded-xl p-3"
              >
                <span className="font-medium">
                  {w.profiles?.full_name ?? t("طالب", "Student")}
                </span>
                <span className="text-xs text-muted">
                  {t("الموقع", "Position")} #{w.position}
                </span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </main>
  );
}
