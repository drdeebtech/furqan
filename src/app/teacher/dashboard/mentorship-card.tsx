import Link from "next/link";
import { Users2, MessageSquareQuote } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { getT } from "@/lib/i18n/server";
import { formatDate } from "@/lib/i18n/format-date";
import { Skeleton } from "@/components/shared/skeleton";
import type { TeacherMentorship } from "@/types/database";

export function MentorshipCardSkeleton() {
  return (
    <div className="mx-auto mt-6 max-w-7xl px-4 sm:px-6">
      <div className="rounded-2xl border border-card-border bg-card p-5">
        <Skeleton className="mb-3 h-4 w-24" />
        <div className="grid gap-3 md:grid-cols-2">
          <Skeleton className="h-20 w-full rounded-xl" />
          <Skeleton className="h-20 w-full rounded-xl" />
        </div>
      </div>
    </div>
  );
}

/**
 * Async server component embedded in /teacher/dashboard. Surfaces the
 * teacher's mentor (if they're a mentee) and mentees (if they're a
 * mentor), plus the most-recent feedback entry from the relationship.
 *
 * Item #18 from the deep pedagogical analysis. Renders nothing when
 * the teacher has no active mentorship — the platform's default state
 * for now until admins start pairing teachers.
 */
export async function MentorshipCard({ teacherId }: { teacherId: string }) {
  const { t, lang } = await getT();
  const supabase = await createClient();

  // Pull active mentorships in either direction. RLS ensures we only see
  // rows where teacherId is mentor or mentee.
  const { data: rows } = await supabase
    .from("teacher_mentorships")
    .select("id, mentor_id, mentee_id, status, started_at")
    .eq("status", "active")
    .returns<TeacherMentorship[]>();
  const mentorships = rows ?? [];

  const asMentee = mentorships.find(m => m.mentee_id === teacherId);
  const myMentees = mentorships.filter(m => m.mentor_id === teacherId);

  if (!asMentee && myMentees.length === 0) return null;

  // Resolve names for any teacher_ids referenced.
  const ids = [
    ...(asMentee ? [asMentee.mentor_id] : []),
    ...myMentees.map(m => m.mentee_id),
  ];
  const { data: profiles } = await supabase
    .from("profiles")
    .select("id, full_name")
    .in("id", ids)
    .returns<{ id: string; full_name: string | null }[]>();
  const nameMap: Record<string, string> = {};
  for (const p of profiles ?? []) nameMap[p.id] = p.full_name ?? t("معلم", "Teacher");

  // Most-recent feedback for this teacher (in either direction). Helps
  // the dashboard hint at "you have a new note from your mentor".
  let latestFeedback: { feedback_text: string; severity: string; created_at: string; mentorship_id: string } | null = null;
  if (mentorships.length > 0) {
    const mentorshipIds = mentorships.map(m => m.id);
    const { data: fb } = await supabase
      .from("teacher_mentorship_feedback")
      .select("feedback_text, severity, created_at, mentorship_id")
      .in("mentorship_id", mentorshipIds)
      .order("created_at", { ascending: false })
      .limit(1)
      .returns<{ feedback_text: string; severity: string; created_at: string; mentorship_id: string }[]>();
    latestFeedback = fb?.[0] ?? null;
  }

  return (
    <div className="mx-auto mt-6 max-w-6xl px-4 sm:px-6">
      <div className="rounded-2xl border border-card-border bg-card p-5">
        <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold">
          <Users2 size={14} className="text-gold" aria-hidden="true" />
          {t("الإرشاد", "Mentorship")}
        </h2>

        <div className="grid gap-3 md:grid-cols-2">
          {asMentee && (
            <div className="rounded-xl border border-gold/30 bg-gold/5 p-3">
              <p className="text-xs font-medium text-gold">
                {t("معلمك المرشد", "Your mentor")}
              </p>
              <p className="mt-1 text-sm font-semibold">{nameMap[asMentee.mentor_id] ?? "—"}</p>
              <p className="mt-1 text-[11px] text-muted">
                {t(
                  `بدأ منذ ${formatDate(asMentee.started_at, lang)}`,
                  `Started ${formatDate(asMentee.started_at, lang)}`,
                )}
              </p>
            </div>
          )}

          {myMentees.length > 0 && (
            <div className="rounded-xl border border-card-border bg-card/50 p-3">
              <p className="text-xs font-medium text-muted">
                {t(`معلمونك الذين ترشدهم (${myMentees.length})`, `Your mentees (${myMentees.length})`)}
              </p>
              <ul className="mt-1 space-y-0.5">
                {myMentees.slice(0, 4).map(m => (
                  <li key={m.id} className="text-sm">{nameMap[m.mentee_id] ?? "—"}</li>
                ))}
                {myMentees.length > 4 && (
                  <li className="text-[11px] text-muted-light">
                    {t(`و ${myMentees.length - 4} آخرين`, `and ${myMentees.length - 4} more`)}
                  </li>
                )}
              </ul>
            </div>
          )}
        </div>

        {latestFeedback && (() => {
          // Severity color-coding so urgent feedback stands out vs an info note.
          // Schema enum: info | warning | critical (per teacher_mentorship_feedback).
          const tierClasses: Record<string, string> = {
            info: "border-card-border bg-card/30",
            warning: "border-warning/30 bg-warning/10",
            critical: "border-error/30 bg-error/10",
          };
          const cls = tierClasses[latestFeedback.severity] ?? tierClasses.info;
          return (
            <div className={`mt-3 rounded-xl border p-3 ${cls}`}>
              <p className="mb-1 flex items-center gap-1.5 text-xs font-medium text-muted">
                <MessageSquareQuote size={11} aria-hidden="true" />
                {t("آخر ملاحظة", "Latest note")}
                <span className="text-muted-light">·</span>
                <span>{formatDate(latestFeedback.created_at, lang)}</span>
                {latestFeedback.severity !== "info" && (
                  <span className={`ms-auto rounded-full px-1.5 py-0.5 text-[10px] font-semibold uppercase ${
                    latestFeedback.severity === "critical" ? "bg-error/20 text-error" : "bg-warning/20 text-warning"
                  }`}>
                    {latestFeedback.severity}
                  </span>
                )}
              </p>
              <p className="text-sm leading-relaxed text-foreground/90">{latestFeedback.feedback_text}</p>
            </div>
          );
        })()}

        <p className="mt-3 text-[11px] text-muted-light">
          {t(
            "الإرشاد يقترن من قبل المسؤولين. تحدث معهم لاقتراح زميل.",
            "Mentorships are paired by admins. Talk to them to suggest a colleague.",
          )}
          {" "}
          <Link href="/teacher/messages" className="text-gold hover:text-gold-hover focus-ring rounded">
            {t("راسل الإدارة", "Message admin")}
          </Link>
        </p>
      </div>
    </div>
  );
}
