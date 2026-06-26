"use server";

import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { logError } from "@/lib/logger";
import {
  activateWorkflow,
  deactivateWorkflow,
  getExecutions,
  isN8nConfigured,
  sendTelegramAlert,
} from "./client";

// Friendly message returned by every n8n public action when the env vars
// aren't configured for the current deployment (typically Preview).
// Replaces the high-priority "N8N_API_KEY not configured" throw that
// surfaced as Sentry JAVASCRIPT-NEXTJS-E4-10.
const N8N_NOT_CONFIGURED_MSG =
  "n8n is not configured for this environment (N8N_API_URL / N8N_API_KEY missing). Contact ops to set them in Vercel.";

async function getAdminUserId(): Promise<string | null> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  return user?.id ?? null;
}

async function logAdminAction(
  action: string,
  workflowId: string,
  workflowName: string,
  status: string = "succeeded",
  errorMessage?: string,
): Promise<void> {
  try {
    const actorId = await getAdminUserId();
    // admin: admin user id context; writes automation_logs telemetry (issue #523)
    const admin = createAdminClient();
    // `automation_logs.entity_id` is a UUID column. n8n workflow IDs are
    // short alphanumeric strings (e.g. "AiGdv6k9wAGNaQ8E") — Postgres rejects
    // them with 22P02 invalid_text_representation, surfaced as Sentry
    // JAVASCRIPT-NEXTJS-E4-20. Mirror the fix from PR #272 (rate-limit IP):
    // leave entity_id NULL, keep the human-readable workflow_id in
    // payload_json (already present below).
    await admin.from("automation_logs").insert({
      workflow_name: workflowName,
      event_name: `admin.${action}`,
      entity_type: "workflow",
      entity_id: null,
      status,
      error_message: errorMessage,
      payload_json: { actor_id: actorId, action, workflow_id: workflowId } as never,
      finished_at: new Date().toISOString(),
    });
  } catch (err) {
    logError("Failed to log n8n admin action", err, { tag: "n8n-admin" });
  }
}

export async function toggleWorkflowAction(
  id: string,
  name: string,
  active: boolean,
): Promise<{ success: boolean; error?: string }> {
  if (!isN8nConfigured()) return { success: false, error: N8N_NOT_CONFIGURED_MSG };

  // Auth check
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { success: false, error: "Unauthorized" };
  const { data: profile } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .single<{ role: string }>();
  if (!profile || profile.role !== "admin") return { success: false, error: "Forbidden" };

  try {
    if (active) {
      await activateWorkflow(id);
    } else {
      await deactivateWorkflow(id);
    }
    await logAdminAction(active ? "activate" : "deactivate", id, name);
    return { success: true };
  } catch (err) {
    try {
      await logAdminAction(active ? "activate" : "deactivate", id, name, "failed", String(err));
    } catch {
      // Logging failure should not mask the original error
    }
    return { success: false, error: String(err) };
  }
}

export async function autoRestartAction(): Promise<{
  restarted: number;
  results: Array<{ id: string; name?: string; success: boolean; error?: string }>;
}> {
  if (!isN8nConfigured()) {
    return {
      restarted: 0,
      results: [{ id: "n/a", success: false, error: N8N_NOT_CONFIGURED_MSG }],
    };
  }

  // Auth check
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { restarted: 0, results: [] };
  const { data: profile } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .single<{ role: string }>();
  if (!profile || profile.role !== "admin") return { restarted: 0, results: [] };

  const executions = await getExecutions(50);
  const now = Date.now();
  const fiveMinAgo = now - 5 * 60 * 1000;

  const recentFailed = executions.filter(
    (e) => e.status === "error" && new Date(e.startedAt).getTime() > fiveMinAgo,
  );

  const seen = new Set<string>();
  const toRestart: string[] = [];
  for (const ex of recentFailed) {
    if (!seen.has(ex.workflowId)) {
      seen.add(ex.workflowId);
      toRestart.push(ex.workflowId);
    }
  }

  const results: Array<{ id: string; success: boolean; error?: string }> = [];
  for (const wfId of toRestart) {
    try {
      await deactivateWorkflow(wfId);
      await new Promise((r) => setTimeout(r, 500));
      await activateWorkflow(wfId);
      results.push({ id: wfId, success: true });
      await logAdminAction("auto_restart", wfId, wfId);
    } catch (err) {
      await logAdminAction("auto_restart", wfId, wfId, "failed", String(err));
      results.push({ id: wfId, success: false, error: String(err) });
    }
  }

  if (results.length > 0) {
    const ok = results.filter((r) => r.success).length;
    const fail = results.filter((r) => !r.success).length;
    try {
      await sendTelegramAlert(
        `<b>FURQAN Auto-Restart</b>\n${ok} workflows restarted${fail > 0 ? `\n${fail} failed to restart` : ""}`,
      );
    } catch {
      // Telegram alert failure should not crash the restart response
    }
  }

  return { restarted: results.length, results };
}
