import type { Metadata } from "next";
import { redirect } from "next/navigation";
import Link from "next/link";
import { Users2, Calendar, Inbox } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { getT } from "@/lib/i18n/server";
import { SESSION_TYPE_AR } from "@/lib/constants";
import type { SessionType } from "@/types/database";
import { JoinGroupButton } from "./join-group-button";

export const metadata: Metadata = { title: "حلقات جماعية" };

const SESSION_TYPE_EN: Record<SessionType, string> = {
  hifz: "Hifz", muraja: "Review", tajweed: "Tajweed", tilawa: "Tilawa",
  qiraat: "Qiraat", tafsir: "Tafsir", combined: "Hifz + Review", other: "Other",
};

/**
 * Item #17 from the deep pedagogical analysis. Halaqa (حلقة) is the
 * classical group-learning setting: 4-8 students, one teacher, group
 * recitation with individual correction rotations. Replicating it
 * digitally unlocks (a) a price point lower than 1:1, (b) a social
 * bond 1:1 cannot create, and (c) the Islamic concept of jama'ah —
 * group learning is itself a religious value.
 *
 * Schema reuses existing infrastructure: sessions.is_group (boolean) +
 * sessions.capacity (max participants). Each enrolled student has their
 * own bookings row referencing the same session_id. The teacher-side
 * group-management flow already exists (AddStudentControl on
 * /teacher/sessions/[id]). What was missing was student-facing
 * discovery + self-request — that's this page.
 *
 * For V1: students REQUEST to join (creates a pending booking); teacher
 * confirms via the existing approval flow. Self-confirm + pricing
 * integration deferred — see PEDAGOGY_ROADMAP.md.
 */
export default async function StudentGroupSessionsPage() {
  const { t, dir, lang } = await getT();
  const locale = lang === "ar" ? "ar-EG" : "en-US";
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  // Future group sessions. We pull bookings whose session.is_group=true,
  // joining via the FK shorthand. RLS lets students see any approved
  // teacher's bookings already.
  type GroupRow = {
    id: string;
    teacher_id: string;
    session_type: SessionType;
    scheduled_at: string;
    duration_min: number | null;
    session: { id: string; capacity: number; is_group: boolean } | null;
  };

  const nowIso = new Date().toISOString();
  const { data: bookings } = await supabase
    .from("bookings")
    // Explicit FK hint disambiguates the bookings ↔ sessions relationship.
    // PostgREST sees both the M:1 FK and the 1:1 unique-constraint shape on
    // bookings.session_id and refuses to pick one without the hint (PGRST201).
    .select("id, teacher_id, session_type, scheduled_at, duration_min, session:sessions!bookings_session_id_fkey(id, capacity, is_group)")
    .gte("scheduled_at", nowIso)
    .eq("status", "confirmed")
    .order("scheduled_at", { ascending: true })
    .returns<GroupRow[]>();

  // Filter to actual group sessions and dedupe by session_id (since
  // multiple bookings per group session each return the same session).
  const groupBookings = (bookings ?? []).filter(b => b.session?.is_group);
  const seatsPerSession = new Map<string, { capacity: number; takenCount: number; sample: GroupRow }>();
  for (const b of groupBookings) {
    const sid = b.session?.id;
    if (!sid) continue;
    const existing = seatsPerSession.get(sid);
    if (existing) {
      existing.takenCount += 1;
    } else {
      seatsPerSession.set(sid, {
        capacity: b.session?.capacity ?? 0,
        takenCount: 1,
        sample: b,
      });
    }
  }

  // Find which sessions THIS student is already enrolled in so we can
  // hide the "request to join" button on those.
  const sessionIds = Array.from(seatsPerSession.keys());
  const { data: myBookings } = sessionIds.length > 0
    ? await supabase
        .from("bookings")
        .select("id")
        .eq("student_id", user.id)
        .in("session_id", sessionIds)
        .returns<{ id: string }[]>()
    : { data: [] };
  const myEnrolledCount = myBookings?.length ?? 0;

  // Resolve teacher names.
  const teacherIds = [...new Set(Array.from(seatsPerSession.values()).map(s => s.sample.teacher_id))];
  const nameMap: Record<string, string> = {};
  if (teacherIds.length > 0) {
    const { data: profiles } = await supabase
      .from("public_profiles" as "profiles")
      .select("id, full_name")
      .in("id", teacherIds)
      .returns<{ id: string; full_name: string | null }[]>();
    for (const p of profiles ?? []) {
      nameMap[p.id] = p.full_name ?? t("معلم", "Teacher");
    }
  }

  // Render: open sessions (seats remaining) sorted by soonest.
  const openRows = Array.from(seatsPerSession.entries())
    .filter(([, s]) => s.takenCount < s.capacity)
    .sort((a, b) =>
      new Date(a[1].sample.scheduled_at).getTime() -
      new Date(b[1].sample.scheduled_at).getTime(),
    );

  return (
    <div dir={dir} className="mx-auto max-w-3xl px-4 py-8">
      <div className="mb-6 flex items-center gap-3">
        <Users2 size={24} className="text-gold" aria-hidden="true" />
        <div>
          <h1 className="text-xl font-bold">{t("حلقات جماعية", "Group Halaqas")}</h1>
          <p className="mt-0.5 text-xs text-muted">
            {t(
              "ادرس مع طلاب آخرين في حلقة بإشراف معلم — قراءة جماعية وتصحيح فردي بالدور.",
              "Study alongside other students in a group, with one teacher leading — collective recitation and individual correction by rotation.",
            )}
          </p>
        </div>
      </div>

      {myEnrolledCount > 0 && (
        <div className="mb-4 rounded-xl border border-gold/30 bg-gold/5 px-3 py-2 text-xs text-gold">
          {t(
            `أنت مسجَّل في ${myEnrolledCount} حلقة قادمة.`,
            `You're enrolled in ${myEnrolledCount} upcoming halaqa${myEnrolledCount === 1 ? "" : "s"}.`,
          )}
          {" "}
          <Link href="/student/sessions" className="underline">
            {t("اعرض جلساتي", "view my sessions")}
          </Link>
        </div>
      )}

      {openRows.length === 0 ? (
        <div className="glass-card p-12 text-center">
          <Inbox size={32} className="mx-auto mb-3 text-muted/40" aria-hidden="true" />
          <p className="text-base font-medium">
            {t("لا توجد حلقات مفتوحة الآن", "No open halaqas right now")}
          </p>
          <p className="mt-2 text-xs text-muted">
            {t(
              "حين يفتح معلم حلقة جماعية تظهر هنا للتسجيل. تواصل مع معلمك لاقتراح موعد.",
              "When a teacher opens a group halaqa it appears here. Message your teacher to suggest a time.",
            )}
          </p>
          <Link
            href="/student/teachers"
            className="mt-4 inline-block text-sm text-gold hover:text-gold-hover focus-ring rounded"
          >
            {t("تصفح المعلمين", "Browse teachers")}
          </Link>
        </div>
      ) : (
        <ul className="space-y-3">
          {openRows.map(([sid, s]) => {
            const myEnrolled = (myBookings ?? []).length > 0; // simplistic: any booking. Later: scope to this session.
            const teacherName = nameMap[s.sample.teacher_id] ?? t("معلم", "Teacher");
            const seatsLeft = s.capacity - s.takenCount;
            const date = new Date(s.sample.scheduled_at);
            const typeLabel = lang === "ar"
              ? SESSION_TYPE_AR[s.sample.session_type]
              : SESSION_TYPE_EN[s.sample.session_type];
            return (
              <li key={sid} className="glass-card p-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="mb-1 flex flex-wrap items-center gap-2">
                      <span className="rounded-full border border-gold/30 bg-gold/10 px-2 py-0.5 text-xs font-medium text-gold">
                        {typeLabel}
                      </span>
                      <span className="rounded-full border border-card-border bg-card/50 px-2 py-0.5 text-xs text-muted">
                        {seatsLeft} {t("مقعد متاح", seatsLeft === 1 ? "seat left" : "seats left")}
                      </span>
                    </div>
                    <p className="text-sm font-semibold">{teacherName}</p>
                    <p className="mt-1 flex items-center gap-1.5 text-xs text-muted" dir="ltr">
                      <Calendar size={11} aria-hidden="true" />
                      {date.toLocaleDateString(locale, { weekday: "short", month: "short", day: "numeric" })}
                      <span className="text-muted-light">·</span>
                      {date.toLocaleTimeString(locale, { hour: "2-digit", minute: "2-digit" })}
                      {s.sample.duration_min && (
                        <>
                          <span className="text-muted-light">·</span>
                          {s.sample.duration_min} {t("دقيقة", "min")}
                        </>
                      )}
                    </p>
                  </div>
                  <JoinGroupButton sessionId={sid} alreadyEnrolled={myEnrolled} />
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
