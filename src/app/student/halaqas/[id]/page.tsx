import type { Metadata } from "next";
import Link from "next/link";
import { redirect, notFound } from "next/navigation";
import { ArrowLeft, ArrowRight, Users, Clock, BookOpen } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getT } from "@/lib/i18n/server";
import { PageHeader } from "@/components/shared/page-header";
import { SessionModeBadge } from "@/components/sessions/SessionModeBadge";
import { EnrollButton } from "./enroll-button";

export const metadata: Metadata = { title: "تفاصيل الحلقة" };

interface HalaqaDetail {
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
}

interface ParticipantRow {
  user_id: string;
  role: string;
  profiles: { full_name: string | null } | null;
}

export default async function HalaqaDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const { t, dir, lang } = await getT();
  const locale = lang === "ar" ? "ar" : "en-US";

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  // Admin read — same reasoning as the browse list (#85): no public
  // RLS path on halaqa rows pre-enrollment yet.
  const admin = createAdminClient();
  const { data: halaqa } = await admin
    .from("sessions")
    .select(
      "id, session_mode, scheduled_at, capacity, current_enrollment, min_participants, session_topic_ar, session_topic_en, surah_reference, ayah_range, allow_recording",
    )
    .eq("id", id)
    .eq("session_mode", "halaqa")
    .maybeSingle<HalaqaDetail>();

  if (!halaqa) notFound();

  // Roster + teacher lookup. Embedded profile name on each row.
  const { data: participants } = await admin
    .from("session_participants")
    .select("user_id, role, profiles!session_participants_user_id_fkey(full_name)")
    .eq("session_id", id)
    .returns<ParticipantRow[]>();

  const roster = participants ?? [];
  const teacher = roster.find((r) => r.role === "teacher");
  const studentRoster = roster.filter((r) => r.role === "student");
  const isEnrolled = studentRoster.some((r) => r.user_id === user.id);

  const title = (lang === "ar" ? halaqa.session_topic_ar : halaqa.session_topic_en) ?? "—";
  const date = halaqa.scheduled_at ? new Date(halaqa.scheduled_at) : null;
  const isPast = date ? date.getTime() < Date.now() : false;
  const isFull = halaqa.current_enrollment >= halaqa.capacity;
  const Arrow = dir === "rtl" ? ArrowRight : ArrowLeft;

  return (
    <main dir={dir} className="mx-auto max-w-3xl px-4 py-8 sm:px-6">
      <Link
        href="/student/halaqas"
        className="mb-4 inline-flex items-center gap-1.5 text-sm text-muted transition-colors hover:text-gold"
      >
        <Arrow size={14} />
        {t("كل الحلقات", "All halaqas")}
      </Link>

      <PageHeader
        icon={<BookOpen size={24} className="text-gold" />}
        title={title}
        actions={<SessionModeBadge mode="halaqa" />}
      />

      <div className="glass-card mt-2 space-y-4 rounded-xl p-6">
        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <p className="text-xs font-medium uppercase tracking-wider text-muted">
              {t("المعلم", "Teacher")}
            </p>
            <p className="mt-0.5 font-medium">{teacher?.profiles?.full_name ?? "—"}</p>
          </div>
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
              {t("السعة", "Capacity")}
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
            <div>
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

        {halaqa.allow_recording ? (
          <p className="rounded-lg border border-info/30 bg-info/10 p-3 text-xs text-info">
            <Clock size={12} className="me-1 inline" aria-hidden="true" />
            {t("سيتم تسجيل هذه الحلقة.", "This halaqa will be recorded.")}
          </p>
        ) : null}
      </div>

      {/* Action area */}
      <div className="mt-6">
        {isPast ? (
          <p className="rounded-xl border border-warning/30 bg-warning/10 p-4 text-center text-sm text-warning">
            {t("هذه الحلقة قد بدأت بالفعل.", "This halaqa has already started.")}
          </p>
        ) : isEnrolled ? (
          <EnrollButton sessionId={halaqa.id} mode="cancel" />
        ) : isFull ? (
          <p className="rounded-xl border border-card-border bg-surface/40 p-4 text-center text-sm text-muted">
            {t(
              "الحلقة ممتلئة. ستتوفر قائمة الانتظار قريباً.",
              "Halaqa is full. Waiting list coming soon.",
            )}
          </p>
        ) : (
          <EnrollButton sessionId={halaqa.id} mode="enroll" />
        )}
      </div>
    </main>
  );
}
