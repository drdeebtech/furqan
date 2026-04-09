import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * n8n callback endpoint.
 * n8n calls this to write automation logs or trigger app-side actions.
 */
export async function POST(request: Request) {
  // Validate shared secret
  const secret = request.headers.get("X-N8N-Secret");
  if (!secret || secret !== process.env.N8N_WEBHOOK_SECRET) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await request.json();
  const { action, ...data } = body;

  const supabase = createAdminClient();

  switch (action) {
    case "log": {
      // Write automation log entry
      const { error } = await supabase.from("automation_logs").insert({
        workflow_name: data.workflow_name,
        event_name: data.event_name ?? null,
        entity_type: data.entity_type ?? null,
        entity_id: data.entity_id ?? null,
        idempotency_key: data.idempotency_key ?? null,
        status: data.status ?? "succeeded",
        channel: data.channel ?? null,
        payload_json: data.payload ?? null,
        result_json: data.result ?? null,
        error_message: data.error_message ?? null,
        finished_at: new Date().toISOString(),
      } as never);
      if (error) return NextResponse.json({ error: "Failed to log" }, { status: 500 });
      return NextResponse.json({ logged: true });
    }

    case "notify": {
      // Create in-app notification
      const { error } = await supabase.from("notifications").insert({
        user_id: data.user_id,
        type: data.type ?? "system",
        title: data.title,
        body: data.body ?? null,
        channel: ["in_app"],
      } as never);
      if (error) return NextResponse.json({ error: "Failed to notify" }, { status: 500 });
      return NextResponse.json({ notified: true });
    }

    case "check_idempotency": {
      // Check if an idempotency key already exists
      const { data: existing } = await supabase
        .from("automation_logs")
        .select("id")
        .eq("idempotency_key", data.idempotency_key)
        .eq("status", "succeeded")
        .returns<{ id: string }[]>()
        .single();
      return NextResponse.json({ exists: !!existing });
    }

    default:
      return NextResponse.json({ error: `Unknown action: ${action}` }, { status: 400 });
  }
}
