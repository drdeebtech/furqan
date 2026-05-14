import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { withCronMonitor } from "@/lib/sentry/cron";
import { safeCompareSecret } from "@/lib/security/secrets";

export const dynamic = "force-dynamic";

/**
 * Daily retention sweep for auth events in audit_log.
 *
 * Privacy policy: educational data deleted within 90 days of account closure.
 * Login/logout events are educational metadata; mutation rows
 * (INSERT/UPDATE/DELETE) are EXEMPT and retained for compliance — financial
 * records require 7-year retention.
 *
 * Trigger: n8n (Mac mini) — schedule a workflow that GETs this endpoint
 * with the `X-N8N-Secret` header set to N8N_WEBHOOK_SECRET. Cadence is
 * daily at 02:00 UTC; the schedule string passed to withCronMonitor
 * is informational (Sentry monitor cadence label) and does not affect
 * when the endpoint actually runs.
 *
 * Previously fired by vercel.json crons; moved 2026-05-03 because Vercel's
 * cron registration entered a stuck state after a transient sub-daily
 * entry, missing 2+ scheduled fires before detection. n8n is the
 * canonical trigger for furqan crons (per CLAUDE.md).
 *
 * Auth: still accepts Vercel's `Authorization: Bearer ${CRON_SECRET}`
 * for any operator who wants to invoke the route without n8n.
 */
export const GET = withCronMonitor("cron-audit-cleanup", "0 2 * * *", async (request: Request) => {
  const cronAuth = request.headers.get("authorization");
  const expectedCron = process.env.CRON_SECRET ? `Bearer ${process.env.CRON_SECRET}` : null;
  const cronOk = !!expectedCron && safeCompareSecret(cronAuth, expectedCron);

  const n8nSecret = request.headers.get("X-N8N-Secret");
  const n8nOk = safeCompareSecret(n8nSecret, process.env.N8N_WEBHOOK_SECRET);

  if (!cronOk && !n8nOk) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const cutoff = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString();
  const webhookCutoff = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
  const admin = createAdminClient();

  const { count, error } = await admin
    .from("audit_log")
    .delete({ count: "exact" })
    .in("action", ["LOGIN", "LOGOUT"])
    .lt("created_at", cutoff);

  if (error) {
    // Throw so Sentry's monitor marks the run as failed.
    throw new Error(`audit-cleanup: ${error.message}`);
  }

  // 7-day retention for Daily.co webhook events (idempotency log).
  // At 50k DAU × ~5 sessions/week × 2 events/session ≈ 500k rows/week;
  // cleanup keeps the table at roughly one week's window.
  const { count: webhookCount, error: webhookError } = await admin
    .from("daily_webhook_events" as never)
    .delete({ count: "exact" })
    .lt("received_at", webhookCutoff);

  if (webhookError) {
    throw new Error(`audit-cleanup daily_webhook_events: ${webhookError.message}`);
  }

  return NextResponse.json({
    ok: true,
    deleted: count ?? 0,
    webhook_events_deleted: webhookCount ?? 0,
    cutoff,
    webhook_cutoff: webhookCutoff,
    at: new Date().toISOString(),
  });
});
