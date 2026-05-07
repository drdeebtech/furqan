import { NextResponse } from "next/server";
import { requireAdminForApi } from "@/lib/auth/require-admin";
import { createAdminClient } from "@/lib/supabase/admin";
import { activateWorkflow, deactivateWorkflow } from "@/lib/n8n/client";
import { logError } from "@/lib/logger";

export async function POST(request: Request) {
  const guard = await requireAdminForApi();
  if (guard instanceof NextResponse) return guard;

  const { id, active } = await request.json();
  if (!id) return NextResponse.json({ error: "Missing workflow id" }, { status: 400 });

  const admin = createAdminClient();
  const action = active ? "activate" : "deactivate";

  try {
    if (active) {
      await activateWorkflow(id);
    } else {
      await deactivateWorkflow(id);
    }
    await admin.from("audit_log").insert({
      changed_by: guard.id,
      table_name: "n8n_workflows",
      record_id: id,
      action: "UPDATE",
      old_data: null,
      new_data: { active },
      reason: `admin ${action} workflow OK`,
    }).then(({ error }) => {
      if (error) logError("audit insert failed (n8n.toggle)", error, { tag: "audit" });
    });
    return NextResponse.json({ success: true, id, active });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await admin.from("audit_log").insert({
      changed_by: guard.id,
      table_name: "n8n_workflows",
      record_id: id,
      action: "UPDATE",
      old_data: null,
      new_data: null,
      reason: `admin ${action} workflow FAILED: ${message}`,
    }).then(({ error }) => {
      if (error) logError("audit insert failed (n8n.toggle.error)", error, { tag: "audit" });
    });
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
