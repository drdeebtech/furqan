import { createClient } from "@/lib/supabase/server";
import { recentWindow, resolveStudentNames } from "@/lib/views/_shared/teacher-reads";

/**
 * Teacher *inbox* deep-read module — actionable worklist reads.
 *
 * "What needs my action." Owns the read-assembly for the teacher
 * dashboard's talqeen grading queue and parent-report digest behind a
 * small `(supabase, teacherId) -> widget data` interface. The injected
 * `supabase` client is the test seam. Behavior-preserving extraction from
 * the `dashboard-queries.ts` god module — the only intentional change is
 * collapsing the per-widget `public_profiles` name-resolve into the shared
 * `resolveStudentNames` helper (N+1 fix), output-identical.
 */

/**
 * Injected server client type (the test seam).
 */
type ServerClient = Awaited<ReturnType<typeof createClient>>;

/**
 * Talqeen inbox for the teacher dashboard — Sprint Improvement #2 (2026-05-05).
 *
 * Talqeen audio submissions land in `homework_assignments` with
 * `homework_type='recitation'` (Sprint 2.3). Today they merge into the
 * generic grading count, making the platform's most pedagogically
 * distinctive workflow invisible. This helper isolates them so they
 * can be shown as their own dedicated inbox.
 *
 * Returns the total count + the 5 most-recent submissions awaiting
 * grading (status='student_ready'), with student name resolved.
 */
export async function getTeacherTalqeenInbox(
  supabase: ServerClient,
  teacherId: string,
): Promise<{
  totalCount: number;
  recent: Array<{
    id: string;
    title: string;
    studentName: string;
    audioDurationSeconds: number | null;
    readyAt: string | null;
  }>;
}> {
  // Count + recent rows in one fetch — limited to 5 for rendering speed.
  // We get the total count by selecting with count exact head:false (count
  // returns the total, data is paginated by .limit).
  const inboxRes = await supabase
    .from("homework_assignments")
    .select("id, title, student_id, audio_duration_seconds, ready_at", { count: "exact" })
    .eq("teacher_id", teacherId)
    .eq("homework_type", "recitation")
    .eq("status", "student_ready")
    .order("ready_at", { ascending: false, nullsFirst: false })
    .limit(5)
    .returns<{
      id: string;
      title: string;
      student_id: string;
      audio_duration_seconds: number | null;
      ready_at: string | null;
    }[]>();
  if (inboxRes.error) throw inboxRes.error;
  const data = inboxRes.data;
  const count = inboxRes.count;

  const rows = data ?? [];
  if (rows.length === 0) {
    return { totalCount: count ?? 0, recent: [] };
  }

  const studentIds = [...new Set(rows.map(r => r.student_id))];
  const names = await resolveStudentNames(supabase, studentIds);

  return {
    totalCount: count ?? rows.length,
    recent: rows.map(r => ({
      id: r.id,
      title: r.title,
      studentName: names.get(r.student_id) ?? "—",
      audioDurationSeconds: r.audio_duration_seconds,
      readyAt: r.ready_at,
    })),
  };
}

/**
 * Parent-report digest for the teacher dashboard — Sprint follow-on
 * after the four-improvement plan (2026-05-05).
 *
 * Counts parent_reports rows where teacher_id = me in the last 7 days,
 * groups by report_type, and returns the most recent 3 with student
 * name resolved. Surfaces the parent-communication leg of the
 * teaching loop so the teacher sees what's been sent on their behalf
 * (whether by their own action or by an automated workflow they
 * triggered).
 *
 * Note on sent_at: parent.ts line 66 leaves sent_at NULL until the
 * email/SMS integration is wired. So today every row is "created
 * but delivery-status unknown." The card surfaces this honestly via
 * a footnote rather than implying delivery.
 */
export async function getTeacherParentReportDigest(
  supabase: ServerClient,
  teacherId: string,
): Promise<{
  totalCount: number;
  byType: { type: string; count: number }[];
  recent: Array<{ id: string; reportType: string; studentName: string; createdAt: string; sent: boolean }>;
}> {
  const sevenDaysAgoIso = recentWindow(7);

  // Fetch the 3 most-recent rows + the total via count: "exact".
  // Schema-stable columns only (drift hazard per CLAUDE.md): the live
  // schema may not have `title`/`body` — supabase.generated.ts shows
  // `content` instead. Component derives the display label from
  // report_type to avoid depending on either side of the drift.
  const recentRes = await supabase
    .from("parent_reports")
    .select("id, report_type, student_id, sent_at, created_at", { count: "exact" })
    .eq("teacher_id", teacherId)
    .gte("created_at", sevenDaysAgoIso)
    .order("created_at", { ascending: false })
    .limit(3)
    .returns<{
      id: string;
      report_type: string;
      student_id: string;
      sent_at: string | null;
      created_at: string;
    }[]>();
  if (recentRes.error) throw recentRes.error;
  const data = recentRes.data;
  const count = recentRes.count;

  const rows = data ?? [];
  // Empty-state is decided by the actual rows, NOT by `count`. With
  // count:"exact" the count is virtually always present, but supabase-js
  // types it `number | null`; gating on `count ?? 0 === 0` would drop a
  // populated result as a false-empty digest if count ever came back null.
  if (rows.length === 0) {
    return { totalCount: count ?? 0, byType: [], recent: [] };
  }

  // Type breakdown needs ALL rows in window, not just the 3 most-recent.
  // Second small fetch with type-only.
  const typeRes = await supabase
    .from("parent_reports")
    .select("report_type")
    .eq("teacher_id", teacherId)
    .gte("created_at", sevenDaysAgoIso)
    .returns<{ report_type: string }[]>();
  if (typeRes.error) throw typeRes.error;
  const typeRows = typeRes.data;

  const typeCounts: Record<string, number> = {};
  for (const r of typeRows ?? []) {
    typeCounts[r.report_type] = (typeCounts[r.report_type] ?? 0) + 1;
  }
  const byType = Object.entries(typeCounts)
    .sort((a, b) => b[1] - a[1])
    .map(([type, count]) => ({ type, count }));

  // Total reports in the 7-day window. Prefer the exact count; fall back to
  // the full type-fetch length (same window, unlimited) so a null count
  // never collapses a populated digest to empty.
  const totalCount = count ?? typeRows?.length ?? rows.length;

  // Resolve student names for the recent rows.
  const studentIds = [...new Set(rows.map(r => r.student_id))];
  const names = await resolveStudentNames(supabase, studentIds);

  return {
    totalCount,
    byType,
    recent: rows.map(r => ({
      id: r.id,
      reportType: r.report_type,
      studentName: names.get(r.student_id) ?? "—",
      createdAt: r.created_at,
      sent: r.sent_at != null,
    })),
  };
}
