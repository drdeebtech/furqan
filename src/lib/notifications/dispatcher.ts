"use server";

import { after } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { logError } from "@/lib/logger";
import type { NotifType } from "@/types/database";
import { isInQuietHours } from "./dispatcher-quiet-hours";

export interface NotifyOptions {
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
 * Send an in-app notification, respecting user communication preferences.
 *
 * Behavior:
 *   - Reads `in_app_enabled`, quiet hours, and `important_only_mode` from
 *     `communication_preferences` (falls back to permissive defaults if no
 *     row exists for the user).
 *   - Inserts into `notifications` (the row the user sees in the bell).
 *   - Logs the attempt in `message_delivery_log` with `recipient_channel='in_app'`
 *     (background via `after()` so the caller doesn't wait on observability).
 *   - Skips non-urgent notifications during quiet hours and in important-only mode.
 *
 * **In-app only.** Per-user email and WhatsApp delivery are not implemented —
 * `src/lib/email.ts` is event-template-specific (no generic `sendEmail(toUserId)`)
 * and `src/lib/whatsapp.ts` is admin-broadcast-only via CallMeBot. When per-user
 * channel infrastructure exists, this dispatcher can grow `EmailAdapter` /
 * `WhatsAppAdapter` seams.
 *
 * Non-blocking — wrap in try/catch at the call site if you care about failures.
 */
export async function notify(opts: NotifyOptions): Promise<void> {
  // Service-role client. The dispatcher is system bookkeeping that
  // writes to RLS-protected tables (notifications, message_delivery_log)
  // on behalf of the platform, not the calling user. Anonymous /
  // authenticated INSERT is denied on those tables by design.
  // admin: platform-level notify — anonymous/authenticated INSERT denied by design (issue #523)
  const supabase = createAdminClient();

  // 1. Fetch user preferences (fallback to defaults if none set)
  const { data: prefs } = await supabase
    .from("communication_preferences")
    .select("in_app_enabled, quiet_hours_start, quiet_hours_end, important_only_mode")
    .eq("user_id", opts.userId)
    .returns<{
      in_app_enabled: boolean;
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
    // Vercel runs UTC; quiet_hours_start/end are stored as wall-clock
    // strings (e.g. "22:00"). Comparing in UTC is consistent across
    // deployments. When per-user timezones are introduced, compute the
    // user's local time before this comparison.
    const hours = now.getUTCHours().toString().padStart(2, "0");
    const mins = now.getUTCMinutes().toString().padStart(2, "0");
    const currentTime = `${hours}:${mins}`;
    if (isInQuietHours(currentTime, prefs.quiet_hours_start, prefs.quiet_hours_end)) return;
  }

  // 2. Insert the in-app notification (the row the user sees in the bell).
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

    if (error) {
      logError("notify: notifications insert failed", error, { tag: "dispatcher" });
    }

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
  const { error } = await supabase.from("message_delivery_log").insert({
    recipient_user_id: opts.recipientUserId,
    recipient_channel: opts.channel,
    template_name: opts.templateName ?? null,
    related_entity_type: opts.entityType ?? null,
    related_entity_id: opts.entityId ?? null,
    status: opts.status,
    failure_reason: opts.failureReason ?? null,
  });
  // Best-effort write — never blocks notification dispatch. Surface failures
  // through logError so the audit gap is at least visible in Sentry.
  if (error) {
    logError("message_delivery_log insert failed", error, {
      tag: "delivery-log",
      channel: opts.channel,
      status: opts.status,
    });
  }
}
