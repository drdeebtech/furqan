import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getExecutions, deactivateWorkflow, activateWorkflow, sendTelegramAlert } from "@/lib/n8n/client";
import { safeCompareSecret } from "@/lib/security/secrets";
import { logError } from "@/lib/logger";

const ALERT_DEDUP_MINUTES = 30;
const WORKFLOW_NAME = "n8n-auto-restart";

export async function POST(request: Request) {
  // Allow both admin UI calls and n8n cron calls (via secret header)
  const secret = request.headers.get("X-N8N-Secret");
  const isN8nCron = safeCompareSecret(secret, process.env.N8N_WEBHOOK_SECRET);

  let actorId: string | null = null;
  if (!isN8nCron) {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const { data: profile } = await supabase.from("profiles").select("role").eq("id", user.id).single<{ role: string }>();
    if (!profile || profile.role !== "admin") return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    actorId = user.id;
  }

  const admin = createAdminClient();

  try {
    const executions = await getExecutions(50);
    const now = Date.now();
    const fiveMinAgo = now - 5 * 60 * 1000;

    // Filter: recent failures only (last 5 minutes)
    const recentFailed = executions.filter(e =>
      e.status === "error" && new Date(e.startedAt).getTime() > fiveMinAgo
    );

    // Deduplicate by workflowId — restart each workflow only once
    const seen = new Set<string>();
    const toRestart: string[] = [];
    for (const ex of recentFailed) {
      if (!seen.has(ex.workflowId)) {
        seen.add(ex.workflowId);
        toRestart.push(ex.workflowId);
      }
    }

    // Restart: deactivate → wait → activate
    const results: { id: string; success: boolean; error?: string }[] = [];
    for (const wfId of toRestart) {
      try {
        await deactivateWorkflow(wfId);
        await new Promise(r => setTimeout(r, 500));
        await activateWorkflow(wfId);
        results.push({ id: wfId, success: true });
      } catch (err) {
        results.push({ id: wfId, success: false, error: String(err) });
      }
    }

    // Audit each restart attempt so admins can trace who/what triggered it.
    if (results.length > 0) {
      const trigger = isN8nCron ? "n8n-cron" : "admin-ui";
      for (const r of results) {
        await admin.from("audit_log").insert({
          changed_by: actorId,
          table_name: "n8n_workflows",
          record_id: r.id,
          action: "UPDATE",
          old_data: null,
          new_data: { auto_restart: true, trigger, success: r.success },
          reason: r.success
            ? `auto-restart OK (${trigger})`
            : `auto-restart FAILED (${trigger}): ${r.error}`,
        } as never).then(({ error }) => {
          if (error) logError("audit insert failed (n8n.auto-restart)", error, { tag: "audit" });
        });
      }
    }

    // Telegram dedup: don't spam if we already alerted in the last 30 min.
    // Keyed by workflow id so a NEW workflow failing still pages immediately.
    let alerted = false;
    if (results.length > 0) {
      const dedupCutoff = new Date(now - ALERT_DEDUP_MINUTES * 60 * 1000).toISOString();
      const restartedIds = results.map(r => r.id);
      const { data: recentAlerts } = await admin
        .from("automation_logs")
        .select("entity_id")
        .eq("workflow_name", WORKFLOW_NAME)
        .eq("event_name", "telegram_alert_sent")
        .gte("started_at", dedupCutoff)
        .in("entity_id", restartedIds)
        .returns<{ entity_id: string }[]>();

      const alreadyAlerted = new Set((recentAlerts ?? []).map(r => r.entity_id));
      const freshAlerts = results.filter(r => !alreadyAlerted.has(r.id));

      if (freshAlerts.length > 0) {
        const ok = freshAlerts.filter(r => r.success).length;
        const fail = freshAlerts.filter(r => !r.success).length;
        try {
          await sendTelegramAlert(
            `⚠️ <b>FURQAN Auto-Restart</b>\n🔄 ${ok} workflows restarted${fail > 0 ? `\n❌ ${fail} failed to restart` : ""}`
          );
          alerted = true;
          // Record one row per workflow id so the dedup query sees them next run.
          const startedAt = new Date().toISOString();
          await admin.from("automation_logs").insert(
            freshAlerts.map(r => ({
              workflow_name: WORKFLOW_NAME,
              event_name: "telegram_alert_sent",
              entity_type: "n8n_workflow",
              entity_id: r.id,
              status: "succeeded",
              started_at: startedAt,
              finished_at: startedAt,
            })) as never,
          ).then(({ error }) => {
            if (error) logError("auto-restart alert log insert failed", error, { tag: "automation" });
          });
        } catch (err) {
          logError("auto-restart Telegram alert failed", err, { tag: "automation" });
        }
      }
    }

    return NextResponse.json({ restarted: results.length, alerted, results });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
