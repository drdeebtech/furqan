import type { Metadata } from "next";
import Link from "next/link";
import { Users, Plus, Inbox, Clock } from "lucide-react";
import { createAdminClient } from "@/lib/supabase/admin";
import { getT } from "@/lib/i18n/server";
import { PageHeader } from "@/components/shared/page-header";
import { EmptyState } from "@/components/shared/empty-state";
import { SessionModeBadge } from "@/components/sessions/SessionModeBadge";

export const metadata: Metadata = { title: "إدارة الحلقات" };

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

interface TeacherRow {
  session_id: string;
  user_id: string;
  profiles: { full_name: string | null } | null;
}

export default async function AdminHalaqasPage() {
  const { t, dir, lang } = await getT();
  const locale = lang === "ar" ? "ar-EG" : "en-US";

  const admin = createAdminClient();

  // All halaqas — past and upcoming. Order so the soonest upcoming is at
  // top, then ended sessions at the bottom.
  const { data: halaqas } = await admin
    .from("sessions")
    .select(
      "id, scheduled_at, capacity, current_enrollment, session_topic_ar, session_topic_en, surah_reference, ended_at",
    )
    .eq("session_mode", "halaqa")
    .order("ended_at", { ascending: true, nullsFirst: true })
    .order("scheduled_at", { ascending: true })
    .limit(100)
    .returns<HalaqaRow[]>();

  const list = halaqas ?? [];

  // Teacher per session via session_participants role='teacher'.
  let teacherBySession: Record<string, string> = {};
  if (list.length > 0) {
    const ids = list.map((h) => h.id);
    const { data: teachers } = await admin
      .from("session_participants")
      .select("session_id, user_id, profiles!session_participants_user_id_fkey(full_name)")
      .in("session_id", ids)
      .eq("role", "teacher")
      .returns<TeacherRow[]>();
    if (teachers) {
      teacherBySession = Object.fromEntries(
        teachers.map((r) => [r.session_id, r.profiles?.full_name ?? ""]),
      );
    }
  }

  const upcoming = list.filter((h) => !h.ended_at);

  return (
    <main dir={dir} className="mx-auto max-w-5xl px-4 py-8 sm:px-6">
      <PageHeader
        icon={<Users size={24} className="text-gold" />}
        title={t("إدارة الحلقات", "Manage Halaqas")}
        subtitle={t(
          `إجمالي ${list.length} حلقة (${upcoming.length} قادمة).`,
          `${list.length} total halaqa${list.length === 1 ? "" : "s"} (${upcoming.length} upcoming).`,
        )}
        actions={
          <Link
            href="/admin/halaqas/new"
            className="flex items-center gap-2 glass-gold glass-pill px-4 py-2 text-sm font-medium"
          >
            <Plus size={16} aria-hidden="true" />
            {t("حلقة جديدة", "New Halaqa")}
          </Link>
        }
      />

      {list.length === 0 ? (
        <EmptyState
          variant="glass-card"
          icon={<Inbox size={32} className="text-muted" />}
          message={t("لم تنشئ أي حلقة بعد", "No halaqas yet")}
          hint={t(
            "ابدأ بإنشاء حلقة جديدة وسيظهر الطلاب في صفحتهم لتسجيل الانضمام.",
            "Create a halaqa and students will see it on their /student/halaqas page.",
          )}
          action={
            <Link
              href="/admin/halaqas/new"
              className="inline-flex items-center gap-2 glass-gold glass-pill px-5 py-2.5 text-sm font-semibold"
            >
              <Plus size={16} aria-hidden="true" />
              {t("إنشاء أول حلقة", "Create your first halaqa")}
            </Link>
          }
        />
      ) : (
        <div className="space-y-3">
          {list.map((h) => {
            const title = (lang === "ar" ? h.session_topic_ar : h.session_topic_en) ?? "—";
            const teacher = teacherBySession[h.id] || t("معلم", "Teacher");
            const date = h.scheduled_at ? new Date(h.scheduled_at) : null;
            const isFull = h.current_enrollment >= h.capacity;
            const hasEnded = !!h.ended_at;

            return (
              <Link
                key={h.id}
                href={`/admin/sessions/${h.id}`}
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
                    <p className="mt-1 text-sm text-muted">
                      {t("المعلم", "Teacher")}: <span className="text-foreground">{teacher}</span>
                      {h.surah_reference ? (
                        <span className="ms-2 text-xs">· {h.surah_reference}</span>
                      ) : null}
                    </p>
                    {date ? (
                      <p
                        dir="ltr"
                        className="mt-2 flex items-center gap-1.5 text-start text-xs text-muted"
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
