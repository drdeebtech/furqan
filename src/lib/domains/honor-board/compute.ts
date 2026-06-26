import "server-only";

import { createAdminClient } from "@/lib/supabase/admin";
import { callRpc } from "@/lib/supabase/rpc";
import { logError } from "@/lib/logger";

export type ComputeResult =
  | { ok: true; rankPeriod: string }
  | { ok: false; error: string };

/**
 * Refresh the honor-board snapshot for the given month.
 *
 * rankPeriod must be an ISO date string representing the first day of the
 * target month (e.g. "2026-06-01"). The stored function deletes the existing
 * snapshot for that period and inserts a fresh one — single round-trip,
 * no N+1, statement_timeout=30s so a timeout surfaces to Sentry without
 * committing partial state.
 *
 * Achievement metric: SUM(pages_reviewed × quality_factor) where
 * quality_factor = COALESCE(quality_rating, 4.0) / 5.0.
 */
export async function computeHonorBoard(rankPeriod: string): Promise<ComputeResult> {
  const isoMonthStart = /^\d{4}-\d{2}-01$/;
  const periodDate = new Date(`${rankPeriod}T00:00:00.000Z`);
  if (!isoMonthStart.test(rankPeriod) || Number.isNaN(periodDate.getTime())) {
    return { ok: false, error: `invalid rankPeriod: ${rankPeriod}` };
  }

  // admin: cron SECURITY DEFINER RPC — recomputes entire board across all students (issue #523)
  const admin = createAdminClient();
  const { error } = await callRpc(admin, "compute_honor_board", {
    p_rank_period: rankPeriod,
  });

  if (error) {
    logError("computeHonorBoard: RPC failed", error, {
      tag: "honor-board",
      rank_period: rankPeriod,
    });
    return { ok: false, error: error.message };
  }

  return { ok: true, rankPeriod };
}
