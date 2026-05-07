import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { safeCompareSecret } from "@/lib/security/secrets";
import { logError } from "@/lib/logger";

/**
 * n8n callback endpoint.
 * n8n calls this to write automation logs or trigger app-side actions.
 */

// notify-action throttle: a single user can receive at most this many
// in-app notifications via the n8n callback per minute. Protects against
// a compromised or runaway workflow flooding a student/teacher with
// notifications and bloating message_delivery_log.
const NOTIFY_PER_USER_PER_MINUTE = 30;
export async function POST(request: Request) {
  try {
  // Validate shared secret with constant-time comparison (timing-attack safe)
  const secret = request.headers.get("X-N8N-Secret");
  if (!safeCompareSecret(secret, process.env.N8N_WEBHOOK_SECRET)) {
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
      if (error) {
        logError("n8n webhook log insert failed", error, {
          tag: "n8n-webhook",
          severity: "critical",
          metadata: {
            workflow_name: data.workflow_name,
            event_name: data.event_name ?? null,
            entity_type: data.entity_type ?? null,
            entity_id: data.entity_id ?? null,
          },
        });
        return NextResponse.json({ error: "Failed to log" }, { status: 500 });
      }
      return NextResponse.json({ logged: true });
    }

    case "notify": {
      // Per-user throttle: count in-app notifications delivered in the last
      // 60 seconds via this callback. If above the cap, drop with 429 so
      // the caller knows to back off — but still log the throttled attempt
      // so admins can see suspicious patterns.
      const oneMinuteAgo = new Date(Date.now() - 60_000).toISOString();
      const { count } = await supabase
        .from("message_delivery_log")
        .select("id", { count: "exact", head: true })
        .eq("recipient_user_id", data.user_id)
        .eq("recipient_channel", "in_app")
        .gte("created_at", oneMinuteAgo);

      if ((count ?? 0) >= NOTIFY_PER_USER_PER_MINUTE) {
        await supabase.from("message_delivery_log").insert({
          recipient_user_id: data.user_id,
          recipient_channel: "in_app",
          template_name: data.template_name ?? null,
          related_entity_type: data.entity_type ?? null,
          related_entity_id: data.entity_id ?? null,
          status: "throttled",
        });
        return NextResponse.json(
          { error: "rate_limited", limit: NOTIFY_PER_USER_PER_MINUTE, window: "1m" },
          { status: 429 },
        );
      }

      // Service-role insert: n8n webhooks bypass RLS by design.
      // User preference gating (quiet hours, channel prefs) is handled n8n-side
      // for workflow-driven notifications.
      const { error } = await supabase.from("notifications").insert({
        user_id: data.user_id,
        type: data.type ?? "system",
        title: data.title,
        body: data.body ?? null,
        channel: ["in_app"],
      } as never);
      if (error) {
        logError("n8n webhook notify insert failed", error, {
          tag: "n8n-webhook",
          severity: "critical",
          metadata: {
            user_id: data.user_id,
            type: data.type ?? "system",
            template_name: data.template_name ?? null,
          },
        });
        return NextResponse.json({ error: "Failed to notify" }, { status: 500 });
      }

      // Mirror to delivery log for observability parity with dispatcher path
      await supabase.from("message_delivery_log").insert({
        recipient_user_id: data.user_id,
        recipient_channel: "in_app",
        template_name: data.template_name ?? null,
        related_entity_type: data.entity_type ?? null,
        related_entity_id: data.entity_id ?? null,
        status: "sent",
      });

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
  } catch (err) {
    logError("n8n webhook handler threw", err, {
      tag: "n8n-webhook",
      severity: "critical",
    });
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
