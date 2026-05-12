import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Users, BookOpen, Clock, Inbox } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getT } from "@/lib/i18n/server";
import { PageHeader } from "@/components/shared/page-header";
import { EmptyState } from "@/components/shared/empty-state";
import { SessionModeBadge } from "@/components/sessions/SessionModeBadge";

export const metadata: Metadata = { title: "الحلقات" };

interface HalaqaRow {
  id: string;
  scheduled_at: string | null;
  capacity: number;
  current_enrollment: number;
  session_topic_ar: string | null;
  session_topic_en: string | null;
  surah_reference: string | null;
}

interface TeacherRow {
  session_id: string;
  user_id: string;
  profiles: { full_name: string | null } | null;
}

export default async function StudentHalaqasPage() {
  const { t, dir, lang } = await getT();
  const locale = lang === "ar" ? "ar-EG" : "en-US";

  // Auth check on the user-facing client (so the route stays
  // gated). The actual browse query runs on the admin client because
  // halaqa sessions are publicly listed and the per-row RLS for
  // sessions has no "anyone authenticated can SELECT halaqa rows"
  // path yet — that policy lands when client-side enrollment ships.
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const admin = createAdminClient();
  const nowIso = new Date().toISOString();

  // Upcoming halaqas only. Ordered by scheduled_at ascending so the
  // soonest one is at the top.
  const { data: halaqas } = await admin
    .from("sessions")
    .select(
      "id, scheduled_at, capacity, current_enrollment, session_topic_ar, session_topic_en, surah_reference",
    )
    .eq("session_mode", "halaqa")
    .gte("scheduled_at", nowIso)
    .order("scheduled_at", { ascending: true })
    .limit(50)
    .returns<HalaqaRow[]>();

  const list = halaqas ?? [];

  // Teacher lookup — single round trip for every halaqa via
  // session_participants(role='teacher') + embedded profile name.
  let teacherBySession: Record<string, string> = {};
  if (list.length > 0) {
    const sessionIds = list.map((h) => h.id);
    const { data: teacherRows } = await admin
      .from("session_participants")
      .select("session_id, user_id, profiles!session_participants_user_id_fkey(full_name)")
      .in("session_id", sessionIds)
      .eq("role", "teacher")
      .returns<TeacherRow[]>();
    if (teacherRows) {
      teacherBySession = Object.fromEntries(
        teacherRows.map((r) => [r.session_id, r.profiles?.full_name ?? ""]),
      );
    }
  }

  return (
    <main dir={dir} className="mx-auto max-w-4xl px-4 py-8 sm:px-6">
      <PageHeader
        icon={<BookOpen size={24} className="text-gold" />}
        title={t("الحلقات", "Halaqas")}
        subtitle={t(
          "حلقات جماعية مع معلمين معتمدين. اختر الحلقة المناسبة لك وانضم إلى زملاء الطريق.",
          "Group sessions with certified teachers. Pick the halaqa that fits your schedule and join a circle of fellow learners.",
        )}
      />

      {list.length === 0 ? (
        <EmptyState
          variant="glass-card"
          icon={<Inbox size={32} className="text-muted" />}
          message={t("لا توجد حلقات قادمة بعد", "No upcoming halaqas yet")}
          hint={t(
            "ستظهر هنا فور إعلان حلقات جديدة من قبل فريق الإدارة.",
            "They'll appear here as soon as the admin team announces new circles.",
          )}
        />
      ) : (
        <div className="mt-6 space-y-3">
          {list.map((h) => {
            const title = (lang === "ar" ? h.session_topic_ar : h.session_topic_en) ?? "—";
            const teacher = teacherBySession[h.id] || t("معلم", "Teacher");
            const capacityLabel = `${h.current_enrollment}/${h.capacity}`;
            const isFull = h.current_enrollment >= h.capacity;
            const date = h.scheduled_at ? new Date(h.scheduled_at) : null;

            return (
              <Link
                key={h.id}
                href={`/student/halaqas/${h.id}`}
                className="glass-card hover-lift block rounded-xl p-5"
              >
                <div className="flex items-start justify-between gap-4">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="font-medium">{title}</p>
                      <SessionModeBadge mode="halaqa" size="sm" />
                    </div>
                    <p className="mt-1 text-sm text-muted">
                      {t("المعلم", "Teacher")}: <span className="text-foreground">{teacher}</span>
                      {h.surah_reference ? (
                        <span className="ms-2 text-xs">· {h.surah_reference}</span>
                      ) : null}
                    </p>
                    {date ? (
                      <p dir="ltr" className="mt-2 flex items-center gap-1.5 text-left text-xs text-muted">
                        <Clock size={12} aria-hidden="true" />
                        {date.toLocaleDateString(locale, {
                          weekday: "long",
                          year: "numeric",
                          month: "long",
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
                        isFull
                          ? "border-warning/25 bg-warning/10 text-warning"
                          : "border-emerald-400/25 bg-emerald-500/10 text-emerald-400"
                      }`}
                    >
                      <Users size={12} aria-hidden="true" />
                      {capacityLabel}
                      {isFull ? <span className="ms-1">{t("(ممتلئة)", "(full)")}</span> : null}
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
