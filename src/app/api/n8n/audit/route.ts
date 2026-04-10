import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getWorkflows, getWorkflowDetail, getAllExecutions } from "@/lib/n8n/client";
import { runFullAudit } from "@/lib/n8n/audit";
import type { N8nWorkflowDetail } from "@/lib/n8n/client";

export async function POST() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { data: profile } = await supabase.from("profiles").select("role").eq("id", user.id).single<{ role: string }>();
  if (!profile || profile.role !== "admin") return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  try {
    // 1. Fetch all workflows
    const workflows = await getWorkflows();

    // 2. Fetch detail for each workflow, batching 5 at a time
    const detailedWorkflows: N8nWorkflowDetail[] = [];
    let skippedCount = 0;
    for (let i = 0; i < workflows.length; i += 5) {
      const batch = workflows.slice(i, i + 5);
      const results = await Promise.allSettled(
        batch.map(wf => getWorkflowDetail(wf.id)),
      );
      for (const result of results) {
        if (result.status === "fulfilled") {
          detailedWorkflows.push(result.value);
        } else {
          skippedCount++;
        }
      }
    }

    // 3. Fetch all executions
    const execResult = await getAllExecutions(500);
    const allExecutions = execResult.data;

    // 4. Run the full audit
    const report = runFullAudit(detailedWorkflows, allExecutions);

    return NextResponse.json({ ...report, _meta: { skippedWorkflows: skippedCount, fetchedWorkflows: detailedWorkflows.length } });
  } catch (err) {
    console.error("[n8n-audit] Audit scan failed:", err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
