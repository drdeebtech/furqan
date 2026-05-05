import type { Metadata } from "next";
import { redirect } from "next/navigation";
import Link from "next/link";
import { Mic, ChevronRight } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { getT } from "@/lib/i18n/server";
import { HOMEWORK_TYPE_AR, HOMEWORK_STATUS_STYLE } from "@/lib/constants";
import { surahName } from "@/lib/quran/surahs";
import { HomeworkAudioPlayer } from "@/components/shared/homework-audio-player";
import type { HomeworkAssignment } from "@/types/database";

export const metadata: Metadata = { title: "تسميعاتي" };

export default async function StudentRecitationsPage() {
  const { t, dir, lang } = await getT();
  const locale = lang === "ar" ? "ar" : "en-US";
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  // Audio submissions: every homework_assignments row this student
  // attached an audio recording to. Newest first; the chronology IS the
  // portfolio — "me three months ago vs me today" is the value here.
  // Note: paginate via .limit + ranges in a future iteration; for V1 we
  // assume <100 rows and read all.
  const { data: rows } = await supabase
    .from("homework_assignments")
    .select("*")
    .eq("student_id", user.id)
    .not("audio_url", "is", null)
    .order("ready_at", { ascending: false, nullsFirst: false })
    .returns<HomeworkAssignment[]>();
  const submissions = rows ?? [];

  // Resolve teacher names for the submissions (typically a small set).
  const teacherIds = [...new Set(submissions.map(r => r.teacher_id))];
  const nameMap: Record<string, string> = {};
  if (teacherIds.length > 0) {
    const { data: profiles } = await supabase
      .from("profiles")
      .select("id, full_name")
      .in("id", teacherIds)
      .returns<{ id: string; full_name: string | null }[]>();
    for (const p of profiles ?? []) {
      nameMap[p.id] = p.full_name ?? t("معلم", "Teacher");
    }
  }

  // Aggregate stats — small, computed once at render. Total recordings,
  // total minutes recorded, distinct teachers.
  const totalRecordings = submissions.length;
  const totalSeconds = submissions.reduce(
    (sum, r) => sum + (r.audio_duration_seconds ?? 0),
    0,
  );
  const totalMinutes = Math.round(totalSeconds / 60);
  const distinctTeachers = teacherIds.length;

  return (
    <div dir={dir} className="mx-auto max-w-4xl px-4 py-8">
      <div className="mb-6 flex items-center gap-3">
        <Mic size={24} className="text-violet-400" aria-hidden="true" />
        <div>
          <h1 className="text-xl font-bold">{t("أرشيف تسميعاتي", "My Recitation Archive")}</h1>
          <p className="mt-0.5 text-xs text-muted">
            {t(
              "كل تسميع سجلته مع متابعاتك — رحلتك صوتية وتاريخ صادق.",
              "Every recitation you've recorded with your follow-ups — an honest audio history of your journey.",
            )}
          </p>
        </div>
      </div>

      {submissions.length === 0 ? (
        <div className="glass-card p-12 text-center">
          <Mic size={40} className="mx-auto mb-3 text-muted/40" aria-hidden="true" />
          <p className="text-muted">
            {t("لا توجد تسميعات بعد", "No recitations yet")}
          </p>
          <p className="mt-1 text-xs text-muted/60">
            {t(
              "عند تسجيلك تلاوة مع متابعة، تظهر هنا.",
              "When you record a recitation with a follow-up submission, it appears here.",
            )}
          </p>
          <Link
            href="/student/follow-up"
            className="mt-4 inline-flex items-center gap-1 text-sm text-gold hover:text-gold-hover focus-ring rounded"
          >
            {t("افتح متابعاتي", "Open My Follow-ups")}
            <ChevronRight size={14} aria-hidden="true" />
          </Link>
        </div>
      ) : (
        <>
          {/* Aggregate strip — quietly tells the student how much they've
              practiced. Per .impeccable.md "celebrated quietly" — no
              hero numerals, no fireworks. */}
          <div className="mb-6 grid grid-cols-3 gap-3 rounded-2xl border border-card-border bg-card p-4 text-center">
            <div>
              <p className="font-display text-lg font-bold text-violet-400">{totalRecordings}</p>
              <p className="text-[11px] text-muted">{t("تسميع", "recordings")}</p>
            </div>
            <div>
              <p className="font-display text-lg font-bold text-emerald-400">{totalMinutes}</p>
              <p className="text-[11px] text-muted">{t("دقيقة", "minutes")}</p>
            </div>
            <div>
              <p className="font-display text-lg font-bold text-gold">{distinctTeachers}</p>
              <p className="text-[11px] text-muted">
                {distinctTeachers === 1 ? t("معلم", "teacher") : t("معلمين", "teachers")}
              </p>
            </div>
          </div>

          {/* Sprint 3.3 (2026-05-05): "compare past" card. Surfaces the
              oldest + most-recent recordings side-by-side so the student
              can hear their own progress. Only renders when there are at
              least 2 recordings; otherwise the comparison is moot. The
              chronology IS the value — "me three months ago vs me today"
              is the moment that proves the platform is working. */}
          {submissions.length >= 2 && (() => {
            const newest = submissions[0];
            const oldest = submissions[submissions.length - 1];
            const newestDate = new Date(newest.ready_at ?? newest.created_at);
            const oldestDate = new Date(oldest.ready_at ?? oldest.created_at);
            const daysApart = Math.round((newestDate.getTime() - oldestDate.getTime()) / 86400_000);
            return (
              <section className="mb-6 rounded-2xl border border-violet-500/20 bg-violet-500/5 p-5">
                <div className="mb-4 flex items-center justify-between gap-2">
                  <h2 className="flex items-center gap-2 font-display text-base font-bold">
                    <Mic size={16} className="text-violet-400" aria-hidden="true" />
                    {t("استمع لتطورك", "Hear your progress")}
                  </h2>
                  <span className="text-xs text-muted">
                    {t(`الفرق ${daysApart} يوماً`, `${daysApart} days apart`)}
                  </span>
                </div>
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <div className="rounded-xl border border-card-border bg-card p-3">
                    <p className="mb-2 text-[11px] font-medium uppercase tracking-wider text-muted-light">
                      {t("أول تسجيل", "First recording")}
                      {" · "}
                      {oldestDate.toLocaleDateString(locale, { month: "short", day: "numeric", year: "numeric" })}
                    </p>
                    <p className="mb-2 text-sm font-semibold">{oldest.title}</p>
                    <HomeworkAudioPlayer
                      homeworkId={oldest.id}
                      durationSeconds={oldest.audio_duration_seconds}
                      label={{ ar: "تسميعك السابق", en: "Your earlier recitation" }}
                    />
                  </div>
                  <div className="rounded-xl border border-violet-500/30 bg-violet-500/10 p-3">
                    <p className="mb-2 text-[11px] font-medium uppercase tracking-wider text-violet-400">
                      {t("أحدث تسجيل", "Most recent")}
                      {" · "}
                      {newestDate.toLocaleDateString(locale, { month: "short", day: "numeric", year: "numeric" })}
                    </p>
                    <p className="mb-2 text-sm font-semibold">{newest.title}</p>
                    <HomeworkAudioPlayer
                      homeworkId={newest.id}
                      durationSeconds={newest.audio_duration_seconds}
                      label={{ ar: "تسميعك الأخير", en: "Your latest recitation" }}
                    />
                  </div>
                </div>
                <p className="mt-3 text-[11px] text-muted-light">
                  {t(
                    "ركّز على ما تحسّن — مخارج الحروف، الطلاقة، الوقف.",
                    "Listen for what got better — articulation, fluency, stops.",
                  )}
                </p>
              </section>
            );
          })()}

          <ul className="space-y-3">
            {submissions.map(r => {
              const style = HOMEWORK_STATUS_STYLE[r.status];
              const teacherName = nameMap[r.teacher_id] ?? t("معلم", "Teacher");
              const surahLabel = r.surah_number
                ? surahName(r.surah_number, lang === "ar" ? "ar" : "en")
                : null;
              const submittedAt = r.ready_at ?? r.created_at;
              return (
                <li key={r.id} className="glass-card p-4">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0 space-y-1.5">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className={`rounded-full border px-2 py-0.5 text-xs ${style.className}`}>
                          {style.label}
                        </span>
                        <span className="rounded-full border border-white/10 bg-white/5 px-2 py-0.5 text-xs text-muted">
                          {HOMEWORK_TYPE_AR[r.homework_type]}
                        </span>
                      </div>
                      <h3 className="text-sm font-semibold">{r.title}</h3>
                      <div className="flex flex-wrap gap-2 text-xs text-muted">
                        {surahLabel && (
                          <span>
                            {t(`سورة ${surahLabel}`, `Surah ${surahLabel}`)}
                            {r.ayah_start && ` (${r.ayah_start}${r.ayah_end ? `-${r.ayah_end}` : ""})`}
                          </span>
                        )}
                        <span>·</span>
                        <span>{teacherName}</span>
                        <span>·</span>
                        <span>
                          {t("سُجِّل في", "Recorded")}{" "}
                          {new Date(submittedAt).toLocaleDateString(locale, {
                            year: "numeric", month: "short", day: "numeric",
                          })}
                        </span>
                      </div>
                      {/* Surface the teacher's grading note if the follow-up
                          was graded — pairs the audio with the feedback. */}
                      {r.teacher_notes && (
                        <p className="mt-2 rounded-lg border border-gold/20 bg-gold/5 p-2 text-xs text-gold/90">
                          💬 {r.teacher_notes}
                        </p>
                      )}
                    </div>
                  </div>
                  {/* Lazy-loaded signed URL audio player. Same getHomework
                      AudioUrl action the teacher uses — RLS lets the
                      student read their own. */}
                  <div className="mt-3">
                    <HomeworkAudioPlayer
                      homeworkId={r.id}
                      durationSeconds={r.audio_duration_seconds}
                      label={{ ar: "تسميعك", en: "Your recitation" }}
                    />
                  </div>
                </li>
              );
            })}
          </ul>
        </>
      )}
    </div>
  );
}
