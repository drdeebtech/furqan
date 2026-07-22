import type { ServerClient } from "@/lib/supabase/types";

/**
 * Teacher recitation-roster read module — the `/teacher/recitations` page.
 *
 * Behavior-preserving extraction from the retired teacher-roster read module (Task 4 of the
 * architecture-deepening series). The injected `supabase` client is the
 * test seam.
 *
 * NOTE: this function's name-resolve block queries `profiles` (not
 * `public_profiles`) for `id, full_name, avatar_url` inside a `Promise.all`
 * alongside the progress RPC. It does NOT fit the shared
 * `resolveStudentNames` helper (which reads `public_profiles`, id+full_name
 * only, no avatar) — swapping it in would drop `avatarUrl` and change the
 * RLS-governing table, both of which are behavior changes out of scope for
 * a mechanical move. Left verbatim; flagged in the Task 4 report.
 */

export type TeacherId = string;

// ─── Recitation roster ──────────────────────────────────────────────────────

export interface TeacherRecitationRosterRow {
  studentId: string;
  studentName: string;
  avatarUrl: string | null;
  /** Most recent surah this student is reciting (from progress_type='new'). */
  currentSurah: number | null;
  surahFrom: number | null;
  surahTo: number | null;
  /** ISO timestamp of the most recent recorded recitation event. */
  lastHeardAt: string | null;
  daysSinceLastHeard: number | null;
  /** Average quality rating across the last 5 recorded events (0..5). */
  qualityAvgLast5: number | null;
  /** True when daysSinceLastHeard >= STREAK_BREAK_DAYS_DEFAULT. */
  streakBreakRisk: boolean;
}

/**
 * Threshold (in days) above which a student's recitation cadence is treated
 * as cold. Default 7 days globally.
 *
 * TODO(human): a senior Quran teacher should validate whether 7 days is the
 * right "going cold" cutoff, or whether the threshold should differ by
 * student level (beginner stricter than advanced) or by the configured
 * `recitation_standard`. See Learning by Doing #2 in the parity plan.
 */
const STREAK_BREAK_DAYS_DEFAULT = 7;

/**
 * Roster-lens recitation tracker for /teacher/recitations. Returns one row
 * per student the teacher is connected to, with:
 *  - their current surah (from the most recent `progress_type='new'` row)
 *  - the most recent recorded recitation event timestamp
 *  - a quality average over the last 5 events
 *  - a streak-break-risk flag when no event in N days
 *
 * Data source is `student_progress` filtered by progress_type='new'. We
 * intentionally do NOT join `homework_assignments` here — talqeen
 * submissions are surfaced on /teacher/talqeen, and mixing two definitions
 * of "last heard" muddies the mental model. This page asks: when did the
 * teacher last *record* something for this student?
 *
 * One result row per student-with-a-booking. Students without any
 * `student_progress` row still appear (with null fields) so the teacher
 * sees brand-new students that haven't been recorded yet.
 */
export async function getTeacherRecitationRoster(
  supabase: ServerClient,
  teacherId: TeacherId,
): Promise<TeacherRecitationRosterRow[]> {
  // Step 1: distinct student IDs via indexed RPC (S1 scale fix). Cast until
  // db:types regenerates post-migration (same pattern as other new RPCs).
  const distinctRes = await (
    supabase
      .rpc("teacher_distinct_students" as never, { p_teacher_id: teacherId } as never)
      .returns<{ student_id: string }[]>() as unknown as Promise<{
        data: { student_id: string }[] | null;
        error: { message: string } | null;
      }>
  );
  if (distinctRes.error) throw new Error(distinctRes.error.message);
  const studentIds = (distinctRes.data ?? []).map((r) => r.student_id);
  if (studentIds.length === 0) return [];

  // Step 2: parallel fetches.
  // Per-student `.limit(5)` instead of one global `.limit(N)`: a single
  // very-active student can otherwise dominate a union limit and starve
  // quieter students of any rows. With Promise.all the N+1 cost is
  // amortized in parallel; for typical rosters (5–30 students) latency
  // is unchanged. For very large rosters (100+) consider a Postgres
  // window-function RPC instead.
  type ProgressRow = {
    student_id: string;
    surah_from: number | null;
    surah_to: number | null;
    quality_rating: number | null;
    created_at: string;
  };
  // Single IN-query instead of one query per student (audit H11: the old
  // per-student fan-out was N round-trips on every dashboard render). Rows
  // arrive globally created_at-desc; we keep the first 5 seen per student,
  // which reproduces the previous per-student `.limit(5)` exactly.
  const [profilesRes, progressRes] = await Promise.all([
    supabase
      .from("profiles")
      .select("id, full_name, avatar_url")
      .in("id", studentIds)
      .returns<
        { id: string; full_name: string | null; avatar_url: string | null }[]
      >(),
    // Window-function RPC bounds to exactly 5 'new' progress rows PER student
    // (replaces the global .limit() cap that could starve a quiet student).
    supabase
      .rpc("roster_recent_progress", { p_student_ids: studentIds })
      .returns<ProgressRow[]>(),
  ]);
  if (profilesRes.error) throw profilesRes.error;
  if (progressRes.error) throw progressRes.error;

  const profileById = new Map<
    string,
    { name: string; avatar: string | null }
  >();
  if (profilesRes.data) {
    for (const p of profilesRes.data) {
      profileById.set(p.id, {
        name: p.full_name ?? "—",
        avatar: p.avatar_url,
      });
    }
  }

  // Group the single ordered result into last-5-per-student.
  const progressByStudent = new Map<string, ProgressRow[]>();
  for (const id of studentIds) progressByStudent.set(id, []);
  for (const row of progressRes.data ?? []) {
    const arr = progressByStudent.get(row.student_id);
    if (arr && arr.length < 5) arr.push(row);
  }

  const now = Date.now();
  const dayMs = 24 * 60 * 60 * 1000;

  return studentIds.map((id) => {
    const profile = profileById.get(id);
    const rows = progressByStudent.get(id);
    const latest = rows && rows.length > 0 ? rows[0] : null;

    let qualityAvg: number | null = null;
    if (rows && rows.length > 0) {
      const window = rows
        .slice(0, 5)
        .map((r) => r.quality_rating)
        .filter((q): q is number => typeof q === "number");
      if (window.length > 0) {
        qualityAvg =
          window.reduce((s, n) => s + n, 0) / window.length;
      }
    }

    const lastHeardAt = latest ? latest.created_at : null;
    const days = lastHeardAt
      ? Math.floor((now - new Date(lastHeardAt).getTime()) / dayMs)
      : null;

    return {
      studentId: id,
      studentName: profile?.name ?? "—",
      avatarUrl: profile?.avatar ?? null,
      currentSurah: latest?.surah_to ?? latest?.surah_from ?? null,
      surahFrom: latest?.surah_from ?? null,
      surahTo: latest?.surah_to ?? null,
      lastHeardAt,
      daysSinceLastHeard: days,
      qualityAvgLast5: qualityAvg,
      // Treat "never recorded" (days === null) as the worst case — that
      // student has never been recorded yet, which deserves the same
      // AlertTriangle as a 7-day-quiet student (or worse). Caught in the
      // 2026-05-06 visual audit: Amr/AHMAD showed no warning despite
      // never-recorded status.
      streakBreakRisk:
        days === null || days >= STREAK_BREAK_DAYS_DEFAULT,
    };
  });
}
