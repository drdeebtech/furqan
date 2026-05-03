"use server";

/**
 * Quick-actions exposed inline on the control-tower grid for the worst-
 * offender widgets. Each is wrapped in `loudAction` so success/failure
 * surfaces in `<ActionFeedback>` and lands in `audit_log`.
 *
 * Bulk shapes:
 *   - retryFailedAutomations: marks all 24h failed automation_logs as
 *     pending_retry; the n8n retry workflow picks them up.
 *   - resolveOldestDeadLetters: marks the oldest 10 unresolved dead-letter
 *     rows as resolved with reason='admin-bulk-resolve'.
 *   - forceEndStuckSessions: sets ended_at = now() on sessions whose
 *     started_at is >30m old and ended_at is null.
 */

import "server-only";
import { loudAction } from "@/lib/actions/loud";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireAdmin } from "@/lib/auth/require-admin";

const RETRY_WINDOW_MS = 24 * 60 * 60 * 1000;
const STUCK_CUTOFF_MS = 30 * 60 * 1000;
const DEAD_LETTER_BATCH = 10;

export const retryFailedAutomations = loudAction({
  name: "admin.control-tower.retry-failed-automations",
  severity: "warning",
  audit: { table: "automation_logs", recordId: "bulk", action: "UPDATE", reasonPrefix: "control-tower.retry-failed" },
  preflight: async () => {
    const { id } = await requireAdmin();
    return { actorId: id };
  },
  handler: async (_input: void) => {
    const admin = createAdminClient();
    const cutoff = new Date(Date.now() - RETRY_WINDOW_MS).toISOString();
    const { count, error } = await admin
      .from("automation_logs")
      .update({ status: "pending_retry", retry_at: new Date().toISOString() } as never, { count: "exact" })
      .eq("status", "failed")
      .gte("started_at", cutoff);
    if (error) throw error;
    return { message: `أُعيدت محاولة ${count ?? 0} مهمة.` };
  },
});

export const resolveOldestDeadLetters = loudAction({
  name: "admin.control-tower.resolve-dead-letters",
  severity: "warning",
  audit: { table: "automation_dead_letter", recordId: "bulk", action: "UPDATE", reasonPrefix: "control-tower.resolve-dead-letters" },
  preflight: async () => {
    const { id } = await requireAdmin();
    return { actorId: id };
  },
  handler: async (_input: void, { actorId }) => {
    const admin = createAdminClient();
    const { data: rows, error: selErr } = await admin
      .from("automation_dead_letter")
      .select("id")
      .is("resolved_at", null)
      .order("created_at", { ascending: true })
      .limit(DEAD_LETTER_BATCH);
    if (selErr) throw selErr;
    if (!rows?.length) return { message: "لا توجد مهام لحلّها." };

    const ids = rows.map((r) => r.id);
    const { error: updErr } = await admin
      .from("automation_dead_letter")
      .update({
        resolved_at: new Date().toISOString(),
        resolved_by: actorId,
        resolution_reason: "control-tower bulk resolve",
      } as never)
      .in("id", ids);
    if (updErr) throw updErr;
    return { message: `تم حلّ ${ids.length} مهمة.` };
  },
});

export const forceEndStuckSessions = loudAction({
  name: "admin.control-tower.force-end-stuck",
  severity: "critical",
  audit: { table: "sessions", recordId: "bulk", action: "UPDATE", reasonPrefix: "control-tower.force-end-stuck" },
  preflight: async () => {
    const { id } = await requireAdmin();
    return { actorId: id };
  },
  handler: async (_input: void) => {
    const admin = createAdminClient();
    const cutoff = new Date(Date.now() - STUCK_CUTOFF_MS).toISOString();
    const nowIso = new Date().toISOString();
    const { count, error } = await admin
      .from("sessions")
      .update({ ended_at: nowIso, ended_reason: "force-end-stuck" } as never, { count: "exact" })
      .is("ended_at", null)
      .not("started_at", "is", null)
      .lt("started_at", cutoff);
    if (error) throw error;
    return { message: `أُغلقت ${count ?? 0} جلسة متوقفة.` };
  },
});
