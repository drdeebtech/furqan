/**
 * Reconciliation — proactive invariant checks across the schema.
 *
 * Runs as a cron via /api/cron/reconciliation. Each check returns either
 * an empty array (clean) or rows describing the violation. Findings are
 * Telegram-alerted via the existing logger so an operator notices within
 * seconds.
 *
 * Add a new check by:
 *   1. Writing a function that returns Array<{ kind, id, detail }>.
 *   2. Adding it to the runReconciliation() switchboard below.
 *   3. Documenting what state the violation represents.
 */
import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { logError } from "@/lib/logger";

export interface ReconcileFinding {
  kind: string;
  id: string;
  detail?: string;
}

/**
 * profiles.role='teacher' AND deleted_at IS NULL AND no teacher_profiles row.
 * The Ahmed Sokar incident — should be impossible after v15_004 triggers, but
 * keep the check as a belt-and-suspenders backstop.
 */
async function findOrphanTeachers(): Promise<ReconcileFinding[]> {
  // admin: runs via cron — no session; cross-table invariant scans (issue #523)
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("profiles")
    .select("id, full_name, role, deleted_at")
    .eq("role", "teacher")
    .is("deleted_at", null)
    .returns<{ id: string; full_name: string | null; role: string; deleted_at: string | null }[]>();
  if (error) {
    logError("reconciliation: profiles query failed", error, { tag: "reconcile" });
    return [];
  }
  if (!data || data.length === 0) return [];

  const ids = data.map((r) => r.id);
  const { data: tps, error: tpErr } = await admin
    .from("teacher_profiles")
    .select("teacher_id")
    .in("teacher_id", ids)
    .returns<{ teacher_id: string }[]>();
  if (tpErr) {
    logError("reconciliation: teacher_profiles query failed", tpErr, { tag: "reconcile" });
    return [];
  }
  const have = new Set((tps ?? []).map((t) => t.teacher_id));
  return data
    .filter((r) => !have.has(r.id))
    .map((r) => ({ kind: "orphan_teacher_profile", id: r.id, detail: r.full_name ?? "" }));
}

/**
 * teacher_profiles row with no matching profiles row (e.g., admin user-deleted
 * the auth.users + profiles row without archiving teacher_profiles).
 */
async function findOrphanTeacherProfiles(): Promise<ReconcileFinding[]> {
  // admin: runs via cron — no session; cross-table invariant scans (issue #523)
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("teacher_profiles")
    .select("teacher_id")
    .returns<{ teacher_id: string }[]>();
  if (error) {
    logError("reconciliation: teacher_profiles list failed", error, { tag: "reconcile" });
    return [];
  }
  if (!data || data.length === 0) return [];

  const ids = data.map((t) => t.teacher_id);
  const { data: profs } = await admin
    .from("profiles")
    .select("id")
    .in("id", ids)
    .returns<{ id: string }[]>();
  const have = new Set((profs ?? []).map((p) => p.id));
  return data
    .filter((t) => !have.has(t.teacher_id))
    .map((t) => ({ kind: "orphan_profile_row", id: t.teacher_id }));
}

/**
 * student_packages with sessions_remaining > sessions_total — accounting bug.
 * Generated column should make this impossible, but the check is cheap.
 */
async function findImpossibleSessionBalance(): Promise<ReconcileFinding[]> {
  // admin: runs via cron — no session; cross-table invariant scans (issue #523)
  const admin = createAdminClient();
  const { data: rows, error: selErr } = await admin
    .from("student_packages")
    .select("id, sessions_remaining, sessions_total")
    .returns<{ id: string; sessions_remaining: number; sessions_total: number }[]>();
  if (selErr) {
    logError("reconciliation: student_packages query failed", selErr, { tag: "reconcile" });
    return [];
  }
  return (rows ?? [])
    .filter((r) => r.sessions_remaining > r.sessions_total || r.sessions_remaining < 0)
    .map((r) => ({
      kind: "impossible_session_balance",
      id: r.id,
      detail: `remaining=${r.sessions_remaining} total=${r.sessions_total}`,
    }));
}

export async function runReconciliation(): Promise<ReconcileFinding[]> {
  const results = await Promise.all([
    findOrphanTeachers(),
    findOrphanTeacherProfiles(),
    findImpossibleSessionBalance(),
  ]);
  return results.flat();
}
