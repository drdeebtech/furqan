import { createAdminClient } from "@/lib/supabase/admin";
import { logError } from "@/lib/logger";
import { chunk } from "@/lib/promise-utils";

/**
 * Canonical retention batch scorer — single source of truth called by both
 * /api/retention/score and /api/cron/retention-score. Computes engagement_score
 * and churn_risk_score per active student, upserts into retention_signals, and
 * writes a batch run to automation_logs for observability.
 *
 * Scoring model includes intervention cooldown (×0.5 within 2 days, ×0.75
 * within 7 days) so students who were recently contacted don't keep topping
 * the list until behavior actually changes.
 *
 * Scale (audit H9): students are fetched with `.range()` pagination (PostgREST
 * caps a plain select at ~1000 rows, so the old single select silently scored
 * only the first 1000) and processed in chunks of `CHUNK` — each chunk keeps
 * every `.in()` under the argument cap and each upsert a bounded statement.
 */

const CHUNK = 1000;

interface StudentRow { id: string }
interface BookingRow { student_id: string; scheduled_at: string; status: string; created_at: string }
interface SessionRow { started_at: string | null; bookings: { student_id: string } }
interface PackageRow { student_id: string; sessions_total: number; sessions_used: number; expires_at: string | null; status: string }
interface HomeworkRow { student_id: string; status: string }

interface RetentionUpsert {
  student_id: string;
  last_booking_at: string | null;
  last_session_at: string | null;
  last_login_at: string | null;
  package_remaining: number | null;
  package_expires_at: string | null;
  engagement_score: number;
  churn_risk_score: number;
  computed_at: string;
}

function daysSince(iso: string | null): number {
  if (!iso) return 9999;
  return (Date.now() - new Date(iso).getTime()) / (24 * 60 * 60 * 1000);
}

export interface RetentionBatchResult {
  scored: number;
  high_risk: number;
}

const byStudent = <T extends { student_id?: string; bookings?: { student_id: string } }>(rows: T[] | null) => {
  const map = new Map<string, T[]>();
  for (const row of rows ?? []) {
    const sid = row.student_id ?? row.bookings?.student_id;
    if (!sid) continue;
    const arr = map.get(sid) ?? [];
    arr.push(row);
    map.set(sid, arr);
  }
  return map;
};

/**
 * Score one chunk of student ids: runs the five per-student queries scoped to
 * the chunk, computes engagement/churn in JS, and returns the upsert rows.
 * Pure read + compute — the caller owns the upsert so it can bound that too.
 */
async function scoreChunk(
  supabase: ReturnType<typeof createAdminClient>,
  studentIds: string[],
  since: string,
  now: string,
): Promise<RetentionUpsert[]> {
  const { data: priorSignals } = await supabase
    .from("retention_signals")
    .select("student_id, last_intervention_at")
    .in("student_id", studentIds)
    .returns<{ student_id: string; last_intervention_at: string | null }[]>();

  const interventionByStudent = new Map(
    (priorSignals ?? []).map(s => [s.student_id, s.last_intervention_at]),
  );

  const [bookingsRes, sessionsRes, packagesRes, homeworkRes] = await Promise.all([
    supabase.from("bookings")
      .select("student_id, scheduled_at, status, created_at")
      .in("student_id", studentIds)
      .gte("created_at", since)
      .returns<BookingRow[]>(),
    supabase.from("sessions")
      // Explicit FK hint disambiguates the sessions ↔ bookings relationship —
      // PostgREST raises PGRST201 (Sentry JAVASCRIPT-NEXTJS-E4-24) without it
      // because bookings.session_id has both an M:1 FK
      // (`bookings_session_id_fkey`) and a 1:1 unique-constraint shape
      // (`sessions_booking_id_fkey`). For the retention-scoring path we want
      // the M:1 FK from bookings.session_id → sessions.id. Same pattern as
      // src/lib/actions/session-lesson-plan.ts.
      .select("started_at, bookings!bookings_session_id_fkey!inner(student_id, scheduled_at)")
      .in("bookings.student_id", studentIds)
      .gte("bookings.scheduled_at", since)
      .returns<SessionRow[]>(),
    supabase.from("student_packages")
      .select("student_id, sessions_total, sessions_used, expires_at, status")
      .in("student_id", studentIds)
      .eq("status", "active")
      .returns<PackageRow[]>(),
    supabase.from("homework_assignments")
      .select("student_id, status")
      .in("student_id", studentIds)
      .gte("assigned_at", since)
      .returns<HomeworkRow[]>(),
  ]);

  const bookingsByStudent = byStudent(bookingsRes.data);
  const sessionsByStudent = byStudent(sessionsRes.data);
  const packagesByStudent = byStudent(packagesRes.data);
  const homeworkByStudent = byStudent(homeworkRes.data);

  return studentIds.map(id => {
    const bks = (bookingsByStudent.get(id) ?? []) as BookingRow[];
    const sss = (sessionsByStudent.get(id) ?? []) as SessionRow[];
    const pkgs = (packagesByStudent.get(id) ?? []) as PackageRow[];
    const hws = (homeworkByStudent.get(id) ?? []) as HomeworkRow[];

    const lastBooking = bks.map(b => b.created_at).sort().at(-1) ?? null;
    const lastSession = sss.filter(x => x.started_at).map(x => x.started_at!).sort().at(-1) ?? null;

    const activePkg = pkgs[0] ?? null;
    const packageRemaining = activePkg ? activePkg.sessions_total - activePkg.sessions_used : null;
    const packageExpires = activePkg?.expires_at ?? null;

    const noShows = bks.filter(b => b.status === "no_show").length;
    const cancelled = bks.filter(b => b.status === "cancelled").length;
    const decided = bks.filter(b => b.status !== "pending").length;
    const cancelRate = decided > 0 ? cancelled / decided : 0;

    const hwFailed = hws.filter(h => h.status === "completed_needs_work" || h.status === "completed_not_done").length;
    const hwTotal = hws.filter(h => h.status.startsWith("completed_")).length;
    const hwFailRate = hwTotal > 0 ? hwFailed / hwTotal : 0;

    let risk = 0;
    if (daysSince(lastBooking) > 14) risk += 30;
    if (daysSince(lastSession) > 14) risk += 20;
    if (noShows >= 3) risk += 20;
    if (cancelRate > 0.3) risk += 15;
    if (packageRemaining !== null && packageRemaining <= 2) risk += 10;
    if (packageExpires && daysSince(packageExpires) > -7 && daysSince(packageExpires) < 0) risk += 10;
    if (activePkg === null) risk += 15;
    if (hwFailRate > 0.5 && hwTotal >= 2) risk += 10;

    const lastIntervention = interventionByStudent.get(id) ?? null;
    const daysSinceIntervention = daysSince(lastIntervention);
    if (daysSinceIntervention <= 2) risk = Math.floor(risk * 0.5);
    else if (daysSinceIntervention <= 7) risk = Math.floor(risk * 0.75);

    risk = Math.min(100, risk);

    let eng = 0;
    if (sss.length >= 8) eng += 40;
    else if (sss.length >= 4) eng += 25;
    else if (sss.length >= 1) eng += 15;
    if (daysSince(lastSession) <= 7) eng += 25;
    else if (daysSince(lastSession) <= 14) eng += 15;
    if (hwTotal > 0 && hwFailRate < 0.25) eng += 20;
    if (activePkg) eng += 15;
    eng = Math.min(100, eng);

    return {
      student_id: id,
      last_booking_at: lastBooking,
      last_session_at: lastSession,
      last_login_at: null,
      package_remaining: packageRemaining,
      package_expires_at: packageExpires,
      engagement_score: eng,
      churn_risk_score: risk,
      computed_at: now,
    };
  });
}

export async function scoreRetentionBatch(): Promise<RetentionBatchResult> {
  // admin: cron/retention endpoint — no session; paginates all students cross-user (issue #523)
  const supabase = createAdminClient();

  // Paginate the active-student fetch — a plain select is capped at ~1000 rows
  // by PostgREST, so the old single query silently scored only 1000 (audit H9).
  const studentIds: string[] = [];
  for (let from = 0; ; from += CHUNK) {
    const { data, error } = await supabase.from("profiles")
      .select("id")
      .eq("role", "student")
      .eq("is_active", true)
      .is("deleted_at", null)
      .order("id", { ascending: true })
      .range(from, from + CHUNK - 1)
      .returns<StudentRow[]>();
    if (error) throw new Error(error.message);
    if (!data || data.length === 0) break;
    for (const s of data) studentIds.push(s.id);
    if (data.length < CHUNK) break;
  }

  if (studentIds.length === 0) {
    return { scored: 0, high_risk: 0 };
  }

  const since = new Date(Date.now() - 60 * 24 * 60 * 60 * 1000).toISOString();
  const now = new Date().toISOString();
  const startedAt = now;
  const traceId = crypto.randomUUID();

  let scored = 0;
  let high_risk = 0;
  let firstError: string | null = null;

  // Process in chunks: each chunk's .in() stays under the arg cap and each
  // upsert is a bounded statement (audit H9). A failed chunk is logged and the
  // batch continues — partial scoring beats aborting the whole nightly run.
  for (const ids of chunk(studentIds, CHUNK)) {
    const upserts = await scoreChunk(supabase, ids, since, now);
    scored += upserts.length;
    high_risk += upserts.filter(u => u.churn_risk_score >= 60).length;

    const { error } = await supabase.from("retention_signals").upsert(upserts as never, {
      onConflict: "student_id",
      ignoreDuplicates: false,
    });
    if (error) {
      if (!firstError) firstError = error.message;
      logError("retention-scorer chunk upsert failed", error, {
        tag: "retention-scorer", traceId, severity: "warning",
        metadata: { chunkSize: ids.length },
      });
    }
  }

  const { error: autoLogError } = await supabase.from("automation_logs").insert({
    workflow_name: "retention-scorer",
    event_name: "retention.scored",
    entity_type: "batch",
    entity_id: traceId,
    idempotency_key: `retention-scorer-${new Date().toISOString().slice(0, 10)}`,
    status: firstError ? "failed" : "succeeded",
    payload_json: { scored, high_risk },
    result_json: firstError ? null : { scored, high_risk },
    error_message: firstError,
    started_at: startedAt,
    finished_at: new Date().toISOString(),
  });
  if (autoLogError) {
    logError("retention-scorer batch log insert failed", autoLogError, {
      tag: "retention-scorer", traceId,
    });
  }

  if (firstError) {
    logError("retention-scorer upsert failed", new Error(firstError), {
      tag: "retention-scorer", traceId, severity: "warning",
      metadata: { scored, high_risk },
    });
    throw new Error(firstError);
  }

  return { scored, high_risk };
}
