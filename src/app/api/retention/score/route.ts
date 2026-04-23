import { NextResponse } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { createAdminClient } from "@/lib/supabase/admin";

export const maxDuration = 300;

function safeCompare(a: string | null, b: string | undefined): boolean {
  if (!a || !b) return false;
  const aBuf = Buffer.from(a);
  const bBuf = Buffer.from(b);
  if (aBuf.length !== bBuf.length) return false;
  return timingSafeEqual(aBuf, bBuf);
}

interface StudentRow { id: string }
interface BookingRow { student_id: string; scheduled_at: string; status: string; created_at: string }
interface SessionRow { started_at: string | null; bookings: { student_id: string } }
interface PackageRow { student_id: string; sessions_total: number; sessions_used: number; expires_at: string | null; status: string }
interface HomeworkRow { student_id: string; status: string }

function daysSince(iso: string | null): number {
  if (!iso) return 9999;
  return (Date.now() - new Date(iso).getTime()) / (24 * 60 * 60 * 1000);
}

/**
 * Daily retention scorer. n8n cron calls this to refresh retention_signals.
 * Computes engagement_score (0–100, higher = healthier) and churn_risk_score (0–100, higher = at risk).
 */
export async function POST(request: Request) {
  const secret = request.headers.get("X-N8N-Secret");
  if (!safeCompare(secret, process.env.N8N_WEBHOOK_SECRET)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const supabase = createAdminClient();

  const { data: students } = await supabase.from("profiles")
    .select("id")
    .eq("role", "student")
    .eq("is_active", true)
    .is("deleted_at", null)
    .returns<StudentRow[]>();

  if (!students || students.length === 0) {
    return NextResponse.json({ scored: 0 });
  }

  const studentIds = students.map(s => s.id);
  const since = new Date(Date.now() - 60 * 24 * 60 * 60 * 1000).toISOString();

  // Existing interventions so we can deprioritize recently-contacted students
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
      .select("started_at, bookings!inner(student_id, scheduled_at)")
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

  const bookingsByStudent = byStudent(bookingsRes.data);
  const sessionsByStudent = byStudent(sessionsRes.data);
  const packagesByStudent = byStudent(packagesRes.data);
  const homeworkByStudent = byStudent(homeworkRes.data);

  const now = new Date().toISOString();
  const upserts = students.map(s => {
    const bks = (bookingsByStudent.get(s.id) ?? []) as BookingRow[];
    const sss = (sessionsByStudent.get(s.id) ?? []) as SessionRow[];
    const pkgs = (packagesByStudent.get(s.id) ?? []) as PackageRow[];
    const hws = (homeworkByStudent.get(s.id) ?? []) as HomeworkRow[];

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

    // Churn risk (0–100)
    let risk = 0;
    if (daysSince(lastBooking) > 14) risk += 30;
    if (daysSince(lastSession) > 14) risk += 20;
    if (noShows >= 3) risk += 20;
    if (cancelRate > 0.3) risk += 15;
    if (packageRemaining !== null && packageRemaining <= 2) risk += 10;
    if (packageExpires && daysSince(packageExpires) > -7 && daysSince(packageExpires) < 0) risk += 10;
    if (activePkg === null) risk += 15;
    if (hwFailRate > 0.5 && hwTotal >= 2) risk += 10;

    // Deprioritize recently-contacted students: cooling period of 7 days
    const lastIntervention = interventionByStudent.get(s.id) ?? null;
    const daysSinceIntervention = daysSince(lastIntervention);
    if (daysSinceIntervention <= 2) risk = Math.floor(risk * 0.5);
    else if (daysSinceIntervention <= 7) risk = Math.floor(risk * 0.75);

    risk = Math.min(100, risk);

    // Engagement (0–100) — inverse-ish but informed by activity volume
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
      student_id: s.id,
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

  const startedAt = new Date().toISOString();
  const traceId = crypto.randomUUID();

  // Upsert but preserve last_intervention_at / intervention_type (we only compute scoring fields)
  const { error } = await supabase.from("retention_signals").upsert(upserts as never, {
    onConflict: "student_id",
    ignoreDuplicates: false,
  });

  const highRisk = upserts.filter(u => (u.churn_risk_score ?? 0) >= 60).length;

  // Observability: write to automation_logs so this run is visible in /admin/automation
  await supabase.from("automation_logs").insert({
    workflow_name: "retention-scorer",
    event_name: "retention.scored",
    entity_type: "batch",
    entity_id: traceId,
    idempotency_key: `retention-scorer-${new Date().toISOString().slice(0, 10)}`,
    status: error ? "failed" : "succeeded",
    payload_json: { scored: upserts.length, high_risk: highRisk },
    result_json: error ? null : { scored: upserts.length, high_risk: highRisk },
    error_message: error?.message ?? null,
    started_at: startedAt,
    finished_at: new Date().toISOString(),
  } as never);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ scored: upserts.length, high_risk: highRisk });
}
