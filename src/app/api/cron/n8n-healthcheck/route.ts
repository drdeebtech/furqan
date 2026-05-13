import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { sendTelegramAlert } from "@/lib/n8n/client";
import { safeCompareSecret } from "@/lib/security/secrets";
import { logError } from "@/lib/logger";
import { withCronMonitor } from "@/lib/sentry/cron";

export const dynamic = "force-dynamic";

const HEALTHCHECK_URL =
  process.env.N8N_HEALTHCHECK_URL ?? "https://n8n.drdeeb.tech/healthz";
const TIMEOUT_MS = 8_000;
const WORKFLOW_NAME = "n8n-healthcheck";

/**
 * Probe n8n.drdeeb.tech and alert on state change.
 *
 * Stateful via automation_logs: each run reads the previous status and only
 * pages Telegram when the status flips (up→down OR down→up). This avoids
 * spamming the admin chat every 5 minutes during a sustained outage.
 *
 * Vercel Cron sends `Authorization: Bearer ${CRON_SECRET}`.
 * Tier note: sub-daily schedules require Vercel Pro. On Hobby this cron
 * is silently dropped; use UptimeRobot or similar as a fallback.
 */
export const GET = withCronMonitor("cron-n8n-healthcheck", "*/15 * * * *", async (request: Request) => {
  const cronAuth = request.headers.get("authorization");
  const expectedCron = process.env.CRON_SECRET ? `Bearer ${process.env.CRON_SECRET}` : null;
  const cronOk = !!expectedCron && safeCompareSecret(cronAuth, expectedCron);

  const n8nSecret = request.headers.get("X-N8N-Secret");
  const n8nOk = safeCompareSecret(n8nSecret, process.env.N8N_WEBHOOK_SECRET);

  if (!cronOk && !n8nOk) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // 1. Probe
  const startedAt = new Date().toISOString();
  let status: "up" | "down" = "down";
  let httpCode: number | null = null;
  let errorMessage: string | null = null;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(HEALTHCHECK_URL, {
      method: "GET",
      signal: controller.signal,
      cache: "no-store",
    });
    httpCode = res.status;
    status = res.ok ? "up" : "down";
    if (!res.ok) errorMessage = `HTTP ${res.status}`;
  } catch (err) {
    errorMessage = err instanceof Error ? err.message : "fetch failed";
  } finally {
    clearTimeout(timer);
  }

  // 2. Read previous status
  const admin = createAdminClient();
  const { data: prev } = await admin
    .from("automation_logs")
    .select("status")
    .eq("workflow_name", WORKFLOW_NAME)
    .order("started_at", { ascending: false })
    .limit(1)
    .maybeSingle<{ status: string }>();

  const prevStatus = prev?.status === "succeeded" ? "up" : prev?.status === "failed" ? "down" : null;

  // 3. Record this run
  const finishedAt = new Date().toISOString();
  await admin.from("automation_logs").insert({
    workflow_name: WORKFLOW_NAME,
    event_name: "n8n.health",
    entity_type: "service",
    entity_id: "n8n.drdeeb.tech",
    status: status === "up" ? "succeeded" : "failed",
    started_at: startedAt,
    finished_at: finishedAt,
    error_message: errorMessage,
    payload_json: { http_code: httpCode, url: HEALTHCHECK_URL },
  }).then(({ error }) => {
    if (error) logError("n8n-healthcheck: automation_logs insert failed", error, { tag: "automation" });
  });

  // 4. Alert only on state change. First run (prevStatus === null) doesn't
  // alert — avoids a fanfare alert on initial deploy.
  let alerted = false;
  if (prevStatus !== null && prevStatus !== status) {
    const emoji = status === "up" ? "✅" : "🚨";
    const title = status === "up"
      ? "n8n recovered"
      : "n8n DOWN";
    const detail = status === "up"
      ? `n8n.drdeeb.tech is back up (HTTP ${httpCode})`
      : `n8n.drdeeb.tech unreachable: ${errorMessage ?? "unknown"}`;
    try {
      await sendTelegramAlert(`${emoji} *${title}*\n${detail}\n_at ${finishedAt}_`);
      alerted = true;
    } catch {
      /* non-blocking — DB row already recorded */
    }
  }

  return NextResponse.json({
    ok: true,
    status,
    http_code: httpCode,
    error: errorMessage,
    state_change: prevStatus !== null && prevStatus !== status,
    prev_status: prevStatus,
    alerted,
    at: finishedAt,
  });
});
