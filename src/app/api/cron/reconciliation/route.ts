import { NextResponse } from "next/server";
import { runReconciliation } from "@/lib/reconciliation";
import { sendTelegramAlert } from "@/lib/n8n/client";
import { logError } from "@/lib/logger";
import { withAuthedCronMonitor } from "@/lib/sentry/cron";

export const dynamic = "force-dynamic";

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
export const GET = withAuthedCronMonitor("cron-reconciliation", "0 3 * * *", async () => {
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
