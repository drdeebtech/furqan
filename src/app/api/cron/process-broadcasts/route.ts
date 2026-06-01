/**
 * Broadcast drainer (audit H7). Reliably finishes any admin broadcast whose
 * delivery wasn't completed by the enqueueing action's `after()` (e.g. a very
 * large audience that exceeded the action's function budget). Idempotent and
 * resumable — processBroadcast() resumes from the row's id cursor.
 *
 * Triggered by an n8n schedule (e.g. every 2 min) — same dual-auth pattern as
 * audit-cleanup / murajaah-due. To wire on n8n.drdeeb.tech:
 *   Cron "* /2 * * * *" → HTTP GET https://www.furqan.today/api/cron/process-broadcasts
 *   Header: X-N8N-Secret: {{ $env.N8N_WEBHOOK_SECRET }}
 *
 * maxDuration is covered by the api/cron/** glob in vercel.json (300s).
 */

import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { processBroadcast } from "@/lib/notifications/broadcast";
import { withCronMonitor } from "@/lib/sentry/cron";
import { safeCompareSecret } from "@/lib/security/secrets";
import { logError } from "@/lib/logger";

export const GET = withCronMonitor("cron-process-broadcasts", "*/2 * * * *", async (request: Request) => {
  const cronAuth = request.headers.get("authorization");
  const expectedCron = process.env.CRON_SECRET ? `Bearer ${process.env.CRON_SECRET}` : null;
  const cronOk = !!expectedCron && safeCompareSecret(cronAuth, expectedCron);
  const n8nOk = safeCompareSecret(request.headers.get("X-N8N-Secret"), process.env.N8N_WEBHOOK_SECRET);
  if (!cronOk && !n8nOk) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const admin = createAdminClient();
  const { data: pending, error } = await admin
    .from("notification_broadcasts")
    .select("id")
    .in("status", ["pending", "processing"])
    .order("created_at", { ascending: true })
    .limit(5)
    .returns<{ id: string }[]>();
  if (error) {
    logError("process-broadcasts: queue read failed", error, { tag: "broadcast-drainer" });
    return NextResponse.json({ error: "queue read failed" }, { status: 500 });
  }

  if (!pending || pending.length === 0) {
    return NextResponse.json({ ok: true, processed: 0 });
  }

  // Generous per-row budget; the api/cron/** maxDuration (300s) bounds the run.
  const results = [];
  for (const b of pending) {
    const r = await processBroadcast(b.id, 250_000);
    results.push({ id: b.id, ...r });
    if (!r.done) break; // out of budget — next invocation resumes
  }

  return NextResponse.json({ ok: true, processed: results.length, results, at: new Date().toISOString() });
});
