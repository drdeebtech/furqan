"use server";

import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  activateWorkflow,
  deactivateWorkflow,
  getExecutions,
  sendTelegramAlert,
} from "./client";

async function getAdminUserId(): Promise<string | null> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  return user?.id ?? null;
}

async function logAdminAction(
  action: string,
  workflowId: string,
  workflowName: string,
): Promise<void> {
  const actorId = await getAdminUserId();
  const admin = createAdminClient();
  await admin.from("automation_logs").insert({
    workflow_name: workflowName,
    event_name: `admin.${action}`,
    entity_type: "workflow",
    entity_id: workflowId as never,
    status: "succeeded",
    payload_json: { actor_id: actorId, action, workflow_id: workflowId } as never,
    finished_at: new Date().toISOString(),
  } as never);
}

export async function toggleWorkflowAction(
  id: string,
  name: string,
  active: boolean,
): Promise<{ success: boolean; error?: string }> {
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
    return { success: false, error: String(err) };
  }
}

export async function autoRestartAction(): Promise<{
  restarted: number;
  results: Array<{ id: string; name?: string; success: boolean; error?: string }>;
}> {
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
