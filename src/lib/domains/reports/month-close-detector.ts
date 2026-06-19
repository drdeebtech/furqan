import "server-only";

import { createAdminClient } from "@/lib/supabase/admin";
import { logError } from "@/lib/logger";
import { emitEvent } from "@/lib/automation/emit";

/**
 * Spec 023 / T011b — fallback `subscription.month_closed` detector.
 *
 * De-risks the hard cross-spec dependency on spec 018 emitting
 * `subscription.month_closed`. If 018 hasn't shipped the emitter by the time
 * US1 is ready, run this from a nightly n8n cron. It scans `subscriptions`
 * for rows whose `current_period_end` has passed and emits the event locally.
 * The report generator (T009/T012) remains idempotent, so no duplicate risk
 * if both the upstream emitter and this fallback fire.
 */

export interface DetectionResult {
  scanned: number;
  emitted: number;
  failed: number;
}

export async function detectMonthCloseAndEmit(): Promise<DetectionResult> {
  const admin = createAdminClient();
  const result: DetectionResult = { scanned: 0, emitted: 0, failed: 0 };

  const { data: due, error } = await admin
    .from("subscriptions")
    .select("id, student_id, current_period_end")
    .lt("current_period_end", new Date().toISOString())
    .order("current_period_end", { ascending: true })
    .limit(1000)
    .returns<{
      id: string;
      student_id: string;
      current_period_end: string;
    }[]>();

  if (error) {
    logError("detectMonthCloseAndEmit: subscriptions query failed", error, {
      tag: "reports-fallback",
    });
    result.failed += 1;
    return result;
  }

  result.scanned = due?.length ?? 0;

  for (const sub of due ?? []) {
    try {
      await emitEvent(
        "subscription.month_closed",
        "subscription",
        sub.id,
        {
          student_id: sub.student_id,
          current_period_end: sub.current_period_end,
        },
      );
      result.emitted += 1;
    } catch (e) {
      logError("detectMonthCloseAndEmit: emit failed", e, {
        tag: "reports-fallback",
        subscription_id: sub.id,
      });
      result.failed += 1;
    }
  }

  return result;
}
