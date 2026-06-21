import { NextResponse } from "next/server";
import { scoreRetentionBatch } from "@/lib/actions/retention-batch";
import { safeCompareSecret } from "@/lib/security/secrets";
import { withCronMonitor } from "@/lib/sentry/cron";

/**
 * Daily retention scorer endpoint.
 * Invoked by an n8n cron workflow — requires either:
 *   - X-N8N-Secret header matching N8N_WEBHOOK_SECRET (n8n path), OR
 *   - Authorization: Bearer ${CRON_SECRET} header (operator/Vercel path).
 * Canonical dual-auth pattern: see audit-cleanup/route.ts.
 * Computes churn_risk_score for all active students and upserts to retention_signals.
 *
 * Wrapped in withCronMonitor (like its daily-batch peers) so Sentry records each
 * run and flags missed/failed runs. A thrown error from scoreRetentionBatch
 * marks the run failed (withMonitor keys on a thrown error, not a 500 body), so
 * we let it propagate instead of swallowing it into a JSON 500.
 */
export const POST = withCronMonitor("cron-retention-score", "0 4 * * *", async (request: Request) => {
  const cronAuth = request.headers.get("authorization");
  const expectedCron = process.env.CRON_SECRET ? `Bearer ${process.env.CRON_SECRET}` : null;
  const cronOk = !!expectedCron && safeCompareSecret(cronAuth, expectedCron);

  const n8nSecret = request.headers.get("X-N8N-Secret");
  const n8nOk = safeCompareSecret(n8nSecret, process.env.N8N_WEBHOOK_SECRET);

  if (!cronOk && !n8nOk) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const result = await scoreRetentionBatch();
  return NextResponse.json({ ok: true, ...result });
});
