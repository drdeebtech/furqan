import { NextResponse } from "next/server";
import { requireAdminForApi } from "@/lib/auth/require-admin";
import { getWorkflows, getWorkflowDetail, fetchAllExecutionsPaginated } from "@/lib/n8n/client";
import { runFullAudit } from "@/lib/n8n/audit";
import { logError } from "@/lib/logger";
import type { N8nWorkflowDetail } from "@/lib/n8n/client";

export async function POST() {
  const guard = await requireAdminForApi();
  if (guard instanceof NextResponse) return guard;

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

    // 3. Fetch all executions (n8n caps a single page at 250, so paginate)
    const allExecutions = await fetchAllExecutionsPaginated(500);

    // 4. Run the full audit
    const report = runFullAudit(detailedWorkflows, allExecutions);

    return NextResponse.json({ ...report, _meta: { skippedWorkflows: skippedCount, fetchedWorkflows: detailedWorkflows.length } });
  } catch (err) {
    logError("n8n audit scan failed", err, { tag: "n8n-audit" });
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
