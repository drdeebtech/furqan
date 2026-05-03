import { NextResponse } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { createAdminClient } from "@/lib/supabase/admin";
import { withCronMonitor } from "@/lib/sentry/cron";

export const dynamic = "force-dynamic";

function safeCompare(a: string | null, b: string | undefined): boolean {
  if (!a || !b) return false;
  const aBuf = Buffer.from(a);
  const bBuf = Buffer.from(b);
  if (aBuf.length !== bBuf.length) return false;
  return timingSafeEqual(aBuf, bBuf);
}

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
  const expectedCron = `Bearer ${process.env.CRON_SECRET}`;
  const cronOk = !!process.env.CRON_SECRET && cronAuth === expectedCron;

  const n8nSecret = request.headers.get("X-N8N-Secret");
  const n8nOk = safeCompare(n8nSecret, process.env.N8N_WEBHOOK_SECRET);

  if (!cronOk && !n8nOk) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const cutoff = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString();
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

  return NextResponse.json({
    ok: true,
    deleted: count ?? 0,
    cutoff,
    at: new Date().toISOString(),
  });
});
