import { NextResponse } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { runReconciliation } from "@/lib/reconciliation";
import { sendTelegramAlert } from "@/lib/n8n/client";
import { logError } from "@/lib/logger";
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
 * Daily invariant reconciliation sweep.
 *
 * Runs the queries defined in src/lib/reconciliation.ts to find any rows
 * violating cross-table invariants (orphan teachers, impossible session
 * balances, etc.). Findings are Telegram'd to the operator. Clean runs
 * are silent.
 *
 * Trigger: n8n (Mac mini) — schedule a workflow that GETs this endpoint
 * with the `X-N8N-Secret` header. Cadence: daily at 03:00 UTC. The
 * schedule string passed to withCronMonitor is informational only.
 *
 * Previously fired by vercel.json crons; moved 2026-05-03 (see
 * audit-cleanup/route.ts for the full migration rationale). Still
 * accepts CRON_SECRET for operator-driven invocation.
 */
export const GET = withCronMonitor("cron-reconciliation", "0 3 * * *", async (request: Request) => {
  const cronAuth = request.headers.get("authorization");
  const expectedCron = `Bearer ${process.env.CRON_SECRET}`;
  const cronOk = !!process.env.CRON_SECRET && cronAuth === expectedCron;

  const n8nSecret = request.headers.get("X-N8N-Secret");
  const n8nOk = safeCompare(n8nSecret, process.env.N8N_WEBHOOK_SECRET);

  if (!cronOk && !n8nOk) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Throw on crash so the Sentry monitor records the run as failed.
  // logError still fires inside the catch path of any unexpected exception
  // because Sentry's withMonitor preserves the error before re-emitting it.
  const findings = await runReconciliation();

  if (findings.length > 0) {
    const summary = findings.slice(0, 20).map((f) =>
      `• <code>${f.kind}</code>: ${f.id}${f.detail ? ` — ${f.detail}` : ""}`,
    ).join("\n");
    await sendTelegramAlert(
      `🔍 <b>Reconciliation drift detected</b>\n\n${findings.length} finding(s):\n${summary}`,
    ).catch((err) => logError("reconciliation Telegram alert failed", err, { tag: "reconcile" }));
  }

  return NextResponse.json({ ok: true, findings_count: findings.length, findings });
});
