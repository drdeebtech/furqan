import type { ServerClient } from "@/lib/supabase/types";
import { recentWindow, resolveStudentNames } from "@/lib/views/_shared/teacher-reads";

/**
 * Teacher talqeen-queue read module — the `/teacher/talqeen` page.
 *
 * Behavior-preserving extraction from the retired teacher-roster read module (Task 4 of the
 * architecture-deepening series). The injected `supabase` client is the
 * test seam. The only intentional change is collapsing the inline
 * `public_profiles` name-resolve into the shared `resolveStudentNames`
 * helper and the whole-day cutoff literals into `recentWindow` —
 * output-identical to the original.
 */

export type TeacherId = string;

// ─── Talqeen queue ──────────────────────────────────────────────────────────

export type TalqeenFilter = "all" | "today" | "this-week" | "overdue";

export interface TalqeenQueueRow {
  id: string;
  title: string;
  studentId: string;
  studentName: string;
  audioDurationSeconds: number | null;
  readyAt: string | null;
  surahNumber: number | null;
  ayahStart: number | null;
  ayahEnd: number | null;
  /** Hours since the student marked the recording ready. NULL when readyAt is null. */
  hoursSinceReady: number | null;
  /** True when hoursSinceReady > STREAK_BREAK_RISK_HOURS — surfaces the row at the top of the list. */
  streakBreakRisk: boolean;
}

/**
 * Threshold (in hours) above which a pending talqeen submission is considered
 * a streak-break risk. A senior Quran teacher's judgment call — different
 * student levels likely deserve different cutoffs (beginners stricter than
 * advanced). Today this is a single global default; revisit once we have
 * real teacher feedback.
 *
 * TODO(human): a senior teacher should validate whether 48h is the right
 * threshold, or whether it should differ by student level / standard
 * (hifz vs. tajweed vs. talqeen). See Learning by Doing #2 in the parity
 * plan.
 */
const STREAK_BREAK_RISK_HOURS = 48;

/**
 * Full talqeen queue for the teacher's `/teacher/talqeen` page. Differs from
 * `getTeacherTalqeenInbox` (dashboard widget) by:
 *  - returning the full queue, not just the 5 most recent
 *  - supporting filter chips (today / this-week / overdue)
 *  - sorting by streak-break-risk first, then by readyAt ascending (FIFO
 *    among non-risk rows) — the pedagogical default. A truly fresh recording
 *    sits below an aging one; the student waiting longest gets graded first.
 *  - surfacing surah/ayah references so the teacher knows what to expect
 *    before pressing play
 */
export async function getTalqeenQueueForTeacher(
  supabase: ServerClient,
  teacherId: TeacherId,
  filter: TalqeenFilter = "all",
): Promise<TalqeenQueueRow[]> {
  let query = supabase
    .from("homework_assignments")
    .select(
      "id, title, student_id, audio_duration_seconds, ready_at, surah_number, ayah_start, ayah_end",
    )
    .eq("teacher_id", teacherId)
    .eq("homework_type", "recitation")
    .eq("status", "student_ready");

  // Filter chips operate on `ready_at` — when did the student finish the
  // recording. Anything before the cutoff is excluded.
  if (filter !== "all") {
    const now = Date.now();
    let cutoff: string | null = null;
    if (filter === "today") {
      cutoff = recentWindow(1);
    } else if (filter === "this-week") {
      cutoff = recentWindow(7);
    } else if (filter === "overdue") {
      // Overdue chip = anything older than the streak-break-risk threshold.
      // The page surfaces these with a red badge.
      cutoff = null;
      query = query.lt(
        "ready_at",
        new Date(now - STREAK_BREAK_RISK_HOURS * 60 * 60 * 1000).toISOString(),
      );
    }
    if (cutoff) query = query.gte("ready_at", cutoff);
  }

  const inboxRes = await query
    .order("ready_at", { ascending: true, nullsFirst: false })
    .limit(200)
    .returns<
      {
        id: string;
        title: string;
        student_id: string;
        audio_duration_seconds: number | null;
        ready_at: string | null;
        surah_number: number | null;
        ayah_start: number | null;
        ayah_end: number | null;
      }[]
    >();
  if (inboxRes.error) throw inboxRes.error;
  const rows = inboxRes.data;
  if (!rows || rows.length === 0) return [];

  const studentIds = [...new Set(rows.map((r) => r.student_id))];
  const names = await resolveStudentNames(supabase, studentIds);

  const now = Date.now();
  const enriched: TalqeenQueueRow[] = rows.map((r) => {
    const hoursSinceReady = r.ready_at
      ? (now - new Date(r.ready_at).getTime()) / (60 * 60 * 1000)
      : null;
    return {
      id: r.id,
      title: r.title,
      studentId: r.student_id,
      studentName: names.get(r.student_id) ?? "—",
      audioDurationSeconds: r.audio_duration_seconds,
      readyAt: r.ready_at,
      surahNumber: r.surah_number,
      ayahStart: r.ayah_start,
      ayahEnd: r.ayah_end,
      hoursSinceReady,
      streakBreakRisk:
        hoursSinceReady !== null && hoursSinceReady > STREAK_BREAK_RISK_HOURS,
    };
  });

  // Streak-break-risk first, then FIFO among the rest. The DB-level order
  // already gives us FIFO; here we just hoist risk rows to the top while
  // preserving relative order via stable sort.
  enriched.sort((a, b) => {
    if (a.streakBreakRisk !== b.streakBreakRisk) {
      return a.streakBreakRisk ? -1 : 1;
    }
    return 0;
  });

  return enriched;
}
