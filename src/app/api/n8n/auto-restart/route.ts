import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getExecutions, deactivateWorkflow, activateWorkflow, sendTelegramAlert } from "@/lib/n8n/client";

export async function POST(request: Request) {
  // Allow both admin UI calls and n8n cron calls (via secret header)
  const secret = request.headers.get("X-N8N-Secret");
  const isN8nCron = secret && secret === process.env.N8N_WEBHOOK_SECRET;

  if (!isN8nCron) {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const { data: profile } = await supabase.from("profiles").select("role").eq("id", user.id).single<{ role: string }>();
    if (!profile || profile.role !== "admin") return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

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

    // Send Telegram alert if any restarts happened
    if (results.length > 0) {
      const ok = results.filter(r => r.success).length;
      const fail = results.filter(r => !r.success).length;
      await sendTelegramAlert(
        `⚠️ <b>FURQAN Auto-Restart</b>\n🔄 ${ok} workflows restarted${fail > 0 ? `\n❌ ${fail} failed to restart` : ""}`
      );
    }

    return NextResponse.json({ restarted: results.length, results });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
