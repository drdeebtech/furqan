"use server";

import { after } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import type { NotifType } from "@/types/database";
import { isInQuietHours } from "./dispatcher-quiet-hours";

export interface DispatchOptions {
  userId: string;
  type: NotifType;
  title: string;
  body?: string;
  data?: Record<string, unknown>;
  entityType?: string;
  entityId?: string;
  templateName?: string;
  urgent?: boolean;
}

/**
 * Centralized notification dispatcher.
 * Respects user communication preferences, logs delivery attempts,
 * and routes to enabled channels (in_app, email, whatsapp).
 *
 * Non-blocking — wrap in try/catch at call site.
 */
export async function dispatchNotification(opts: DispatchOptions): Promise<void> {
  // Service-role client. The dispatcher is system bookkeeping that
  // writes to RLS-protected tables (notifications, message_delivery_log)
  // on behalf of the platform, not the calling user. Anonymous /
  // authenticated INSERT is denied on those tables by design.
  const supabase = createAdminClient();

  // 1. Fetch user preferences (fallback to defaults if none set)
  const { data: prefs } = await supabase
    .from("communication_preferences")
    .select("in_app_enabled, email_enabled, whatsapp_enabled, quiet_hours_start, quiet_hours_end, important_only_mode")
    .eq("user_id", opts.userId)
    .returns<{
      in_app_enabled: boolean;
      email_enabled: boolean;
      whatsapp_enabled: boolean;
      quiet_hours_start: string | null;
      quiet_hours_end: string | null;
      important_only_mode: boolean;
    }[]>()
    // maybeSingle() so a missing prefs row returns null instead of
    // throwing PGRST116. The fallbacks below already handle the
    // null case via `?? defaultValue`. (Sentry JAVASCRIPT-NEXTJS-E4-1R.)
    .maybeSingle();

  const inAppEnabled = prefs?.in_app_enabled ?? true;
  const importantOnly = prefs?.important_only_mode ?? false;

  // Skip non-urgent in important-only mode
  if (importantOnly && !opts.urgent) return;

  // Check quiet hours (skip non-urgent during quiet period)
  if (!opts.urgent && prefs?.quiet_hours_start && prefs?.quiet_hours_end) {
    const now = new Date();
    const hours = now.getHours().toString().padStart(2, "0");
    const mins = now.getMinutes().toString().padStart(2, "0");
    const currentTime = `${hours}:${mins}`;
    if (isInQuietHours(currentTime, prefs.quiet_hours_start, prefs.quiet_hours_end)) return;
  }

  // 2. Send in-app notification (primary channel — always attempted).
  // The notifications insert stays sync because the user's next page
  // load may include the notifications panel; the message_delivery_log
  // insert is observability-only and runs in after() so the caller
  // doesn't wait for two writes back-to-back.
  if (inAppEnabled) {
    const { error } = await supabase.from("notifications").insert({
      user_id: opts.userId,
      type: opts.type,
      title: opts.title,
      body: opts.body ?? null,
      data: opts.data ?? null,
      channel: ["in_app"],
    } as never);

    after(() =>
      logDelivery(supabase, {
        recipientUserId: opts.userId,
        channel: "in_app",
        templateName: opts.templateName,
        entityType: opts.entityType,
        entityId: opts.entityId,
        status: error ? "failed" : "sent",
        failureReason: error?.message,
      }),
    );
  }

  // 3. Email channel (future — log as skipped for now)
  // When email integration is active, send via Resend here
  // For now, just log that email was considered

  // 4. WhatsApp channel (future — handled by n8n workflows)
  // n8n handles WhatsApp delivery via its own notification dispatcher
}

/**
 * Simplified dispatch for the common case: just send in-app notification.
 * Drop-in replacement for direct supabase.from("notifications").insert(...).
 */
export async function notify(
  userId: string,
  type: NotifType,
  title: string,
  body?: string,
  entityType?: string,
  entityId?: string,
): Promise<void> {
  await dispatchNotification({
    userId,
    type,
    title,
    body,
    entityType,
    entityId,
  });
}

// ─── Delivery logging helper ────────────────────────────────────────────────

async function logDelivery(
  supabase: ReturnType<typeof createAdminClient>,
  opts: {
    recipientUserId: string;
    channel: string;
    templateName?: string;
    entityType?: string;
    entityId?: string;
    status: string;
    failureReason?: string;
  },
): Promise<void> {
  await supabase.from("message_delivery_log").insert({
    recipient_user_id: opts.recipientUserId,
    recipient_channel: opts.channel,
    template_name: opts.templateName ?? null,
    related_entity_type: opts.entityType ?? null,
    related_entity_id: opts.entityId ?? null,
    status: opts.status,
    failure_reason: opts.failureReason ?? null,
  } as never);
}
