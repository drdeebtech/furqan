import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Users, Inbox, Clock } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getT } from "@/lib/i18n/server";
import { PageHeader } from "@/components/shared/page-header";
import { EmptyState } from "@/components/shared/empty-state";
import { SessionModeBadge } from "@/components/sessions/SessionModeBadge";

export const metadata: Metadata = { title: "حلقاتي" };

interface SessionRow {
  session_id: string;
}

interface HalaqaRow {
  id: string;
  scheduled_at: string | null;
  capacity: number;
  current_enrollment: number;
  session_topic_ar: string | null;
  session_topic_en: string | null;
  surah_reference: string | null;
  ended_at: string | null;
}

export default async function TeacherHalaqasPage() {
  const { t, dir, lang } = await getT();
  const locale = lang === "ar" ? "ar" : "en-US";

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const admin = createAdminClient();

  // Find halaqa sessions where this teacher is the role='teacher' participant.
  const { data: teacherRows } = await admin
    .from("session_participants")
    .select("session_id")
    .eq("user_id", user.id)
    .eq("role", "teacher")
    .returns<SessionRow[]>();

  const sessionIds = (teacherRows ?? []).map((r) => r.session_id);

  let halaqas: HalaqaRow[] = [];
  if (sessionIds.length > 0) {
    const { data } = await admin
      .from("sessions")
      .select(
        "id, scheduled_at, capacity, current_enrollment, session_topic_ar, session_topic_en, surah_reference, ended_at",
      )
      .in("id", sessionIds)
      .eq("session_mode", "halaqa")
      .order("ended_at", { ascending: true, nullsFirst: true })
      .order("scheduled_at", { ascending: true })
      .limit(100)
      .returns<HalaqaRow[]>();
    halaqas = data ?? [];
  }

  const upcoming = halaqas.filter((h) => !h.ended_at);

  return (
    <main dir={dir} className="mx-auto max-w-4xl px-4 py-8 sm:px-6">
      <PageHeader
        icon={<Users size={24} className="text-gold" />}
        title={t("حلقاتي", "My Halaqas")}
        subtitle={
          halaqas.length > 0
            ? t(
                `لديك ${halaqas.length} حلقة (${upcoming.length} قادمة).`,
                `You're leading ${halaqas.length} halaqa${halaqas.length === 1 ? "" : "s"} (${upcoming.length} upcoming).`,
              )
            : undefined
        }
      />

      {halaqas.length === 0 ? (
        <EmptyState
          variant="glass-card"
          icon={<Inbox size={32} className="text-muted" />}
          message={t("لا توجد حلقات بعد", "No halaqas yet")}
          hint={t(
            "ستظهر هنا عند تعيينك معلماً لحلقة من قبل فريق الإدارة.",
            "They'll appear here once the admin team assigns you to a halaqa.",
          )}
        />
      ) : (
        <div className="space-y-3">
          {halaqas.map((h) => {
            const title = (lang === "ar" ? h.session_topic_ar : h.session_topic_en) ?? "—";
            const date = h.scheduled_at ? new Date(h.scheduled_at) : null;
            const isFull = h.current_enrollment >= h.capacity;
            const hasEnded = !!h.ended_at;

            return (
              <Link
                key={h.id}
                href={`/teacher/halaqas/${h.id}`}
                className={`glass-card hover-lift block rounded-xl p-5 ${hasEnded ? "opacity-60" : ""}`}
              >
                <div className="flex items-start justify-between gap-4">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="font-medium">{title}</p>
                      <SessionModeBadge mode="halaqa" size="sm" />
                      {hasEnded ? (
                        <span className="rounded-full border border-card-border bg-surface/40 px-2 py-0.5 text-xs text-muted">
                          {t("انتهت", "ended")}
                        </span>
                      ) : null}
                    </div>
                    {h.surah_reference ? (
                      <p className="mt-1 text-sm text-muted">{h.surah_reference}</p>
                    ) : null}
                    {date ? (
                      <p
                        dir="ltr"
                        className="mt-2 flex items-center gap-1.5 text-left text-xs text-muted"
                      >
                        <Clock size={12} aria-hidden="true" />
                        {date.toLocaleDateString(locale, {
                          weekday: "short",
                          year: "numeric",
                          month: "short",
                          day: "numeric",
                        })}
                        <span className="mx-1">·</span>
                        {date.toLocaleTimeString(locale, { hour: "2-digit", minute: "2-digit" })}
                      </p>
                    ) : null}
                  </div>
                  <div className="flex flex-col items-end gap-2">
                    <span
                      className={`flex items-center gap-1 rounded-full border px-2.5 py-1 text-xs font-medium ${
                        hasEnded
                          ? "border-card-border bg-surface/40 text-muted"
                          : isFull
                            ? "border-warning/25 bg-warning/10 text-warning"
                            : "border-emerald-400/25 bg-emerald-500/10 text-emerald-400"
                      }`}
                    >
                      <Users size={12} aria-hidden="true" />
                      {h.current_enrollment}/{h.capacity}
                    </span>
                  </div>
                </div>
              </Link>
            );
          })}
        </div>
      )}
    </main>
  );
}
