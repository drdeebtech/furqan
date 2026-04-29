import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { activateWorkflow, deactivateWorkflow } from "@/lib/n8n/client";
import { logError } from "@/lib/logger";

export async function POST(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { data: profile } = await supabase.from("profiles").select("role").eq("id", user.id).single<{ role: string }>();
  if (!profile || profile.role !== "admin") return NextResponse.json({ error: "Forbidden" }, { status: 403 });

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
      changed_by: user.id,
      table_name: "n8n_workflows",
      record_id: id,
      action: "UPDATE",
      old_data: null,
      new_data: { active },
      reason: `admin ${action} workflow OK`,
    } as never).then(({ error }) => {
      if (error) logError("audit insert failed (n8n.toggle)", error, { tag: "audit" });
    });
    return NextResponse.json({ success: true, id, active });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await admin.from("audit_log").insert({
      changed_by: user.id,
      table_name: "n8n_workflows",
      record_id: id,
      action: "UPDATE",
      old_data: null,
      new_data: null,
      reason: `admin ${action} workflow FAILED: ${message}`,
    } as never).then(({ error }) => {
      if (error) logError("audit insert failed (n8n.toggle.error)", error, { tag: "audit" });
    });
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
