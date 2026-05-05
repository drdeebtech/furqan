/**
 * Event emission to n8n automation engine.
 * Non-blocking — fire-and-forget. Errors must NOT be silently swallowed
 * (per CLAUDE.md "No Silent Failures Policy"). Pipe failures through
 * `logError` so an n8n outage shows up in Sentry instead of disappearing.
 *
 * Usage in server actions:
 *   await emitEvent("booking.confirmed", "booking", bookingId, { student_id, teacher_id })
 *     .catch((err) => logError("emit booking.confirmed failed", err, {
 *       tag: "automation", event: "booking.confirmed"
 *     }));
 */

import { after } from "next/server";
import { track } from "@vercel/analytics/server";
import { signWebhookPayload } from "@/lib/security/secrets";
import { getSettings } from "@/lib/settings";
import { serializePayload, type EventPayload } from "./payload";

export { serializePayload, type EventPayload } from "./payload";

const N8N_WEBHOOK_URL = process.env.N8N_WEBHOOK_URL;
const N8N_WEBHOOK_SECRET = process.env.N8N_WEBHOOK_SECRET;

/**
 * Per-event sub-flag map. When a sub-flag exists for an event and is `false`,
 * the emit is skipped (and logged). Events not listed here are gated only by
 * the master `automation_enabled` flag.
 */
const EVENT_SUB_FLAGS: Record<string, string> = {
  "homework.graded": "ai_parent_reports_enabled",
  "session.notes_saved": "ai_parent_reports_enabled",
  "session.no_show": "ai_parent_reports_enabled",
  "retention.signal_triggered": "retention_automation_enabled",
};

/**
 * Exported so the webhook-replay admin tool can route a replay to the same
 * path the original event used. Keep in sync when new events are added.
 */
export const WEBHOOK_ROUTES: Record<string, string> = {
  "booking.confirmed": "/webhook/furqan-booking-confirmed",
  "session.notes_saved": "/webhook/furqan-session-notes-saved",
  "session.no_show": "/webhook/furqan-no-show-parent",
  "session.auto_completed": "/webhook/furqan-session-auto-completed",
  "homework.graded": "/webhook/furqan-homework-graded",
  "profile.created": "/webhook/furqan-profile-created",
  "teacher.cv_submitted": "/webhook/furqan-cv-event",
  "teacher.cv_approved": "/webhook/furqan-cv-event",
  "teacher.cv_rejected": "/webhook/furqan-cv-event",
  "course.submitted": "/webhook/furqan-course-event",
  "course.approved": "/webhook/furqan-course-event",
  "course.rejected": "/webhook/furqan-course-event",
  "course.enrolled": "/webhook/furqan-course-enrolled",
  "course.completed": "/webhook/furqan-course-completed",
  "lesson.completed": "/webhook/furqan-lesson-completed",
  "review.created": "/webhook/furqan-course-review",
};

export const DEFAULT_WEBHOOK_PATH = "/webhook/furqan-events";

export async function emitEvent(
  eventName: string,
  entityType: string,
  entityId: string,
  data: Record<string, unknown>,
  actorId?: string | null,
): Promise<void> {
  if (!N8N_WEBHOOK_URL) return; // Silently skip if not configured

  const payload: EventPayload = {
    event: eventName,
    occurred_at: new Date().toISOString(),
    entity_type: entityType,
    entity_id: entityId,
    actor_id: actorId ?? null,
    trace_id: crypto.randomUUID(),
    source: "furqan-app",
    data,
  };

  // Mirror the event into Vercel Web Analytics as a custom event. Only
  // scalar properties are allowed; we hoist entity_type/entity_id and any
  // string|number|boolean|null fields out of `data`. Returns void; if not
  // running on Vercel it's a no-op.
  after(() => {
    const props: Record<string, string | number | boolean | null> = {
      entity_type: entityType,
      entity_id: entityId,
    };
    if (actorId != null) props.actor_id = actorId;
    for (const [key, value] of Object.entries(data)) {
      if (
        value === null ||
        typeof value === "string" ||
        typeof value === "number" ||
        typeof value === "boolean"
      ) {
        props[key] = value;
      }
    }
    try { track(eventName, props); } catch { /* tolerate analytics outage */ }
  });

  // Whole webhook flow runs in after(): kill-switch check, signing, fetch,
  // and outcome recording. The caller's response ships immediately while
  // n8n/automation_logs work happens in the background — no more 5s timeout
  // sitting on the request critical path.
  after(async () => {
    const settings = await getSettings().catch(() => ({} as Record<string, string>));
    if (settings.automation_enabled !== "true") {
      await recordSkipped(payload, "automation_enabled=false");
      return;
    }
    const subFlag = EVENT_SUB_FLAGS[eventName];
    if (subFlag && settings[subFlag] !== "true") {
      await recordSkipped(payload, `${subFlag}=false`);
      return;
    }

    const path = WEBHOOK_ROUTES[eventName] ?? DEFAULT_WEBHOOK_PATH;
    // Serialize once; the same exact bytes are signed and sent on the wire.
    // Any reordering or whitespace difference between sign-time and send-time
    // would invalidate the verifier's recomputed HMAC.
    const rawBody = serializePayload(payload);

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);
    try {
      const headers: Record<string, string> = {
        "Content-Type": "application/json",
        "X-Furqan-Event": eventName,
      };
      if (N8N_WEBHOOK_SECRET) {
        const { timestamp, signature } = signWebhookPayload(rawBody, N8N_WEBHOOK_SECRET);
        headers["X-Furqan-Timestamp"] = timestamp;
        headers["X-Furqan-Signature"] = signature;
      }
      const res = await fetch(`${N8N_WEBHOOK_URL}${path}`, {
        method: "POST",
        headers,
        body: rawBody,
        signal: controller.signal,
      });
      if (!res.ok) {
        await recordFailure(payload, `n8n ${res.status}`);
      }
    } catch (err) {
      await recordFailure(payload, err instanceof Error ? err.message : "fetch failed");
    } finally {
      clearTimeout(timeout);
    }
  });
}


/**
 * Record emitEvent delivery failures to automation_logs so ops has a signal
 * when n8n is down or rejecting events. Best-effort — never throws.
 */
async function recordFailure(payload: EventPayload, reason: string): Promise<void> {
  await recordOutcome(payload, "failed", reason);
}

/**
 * Record kill-switch suppressions so admins can audit what was blocked.
 * Without this, flipping `automation_enabled=false` would be invisible.
 */
async function recordSkipped(payload: EventPayload, reason: string): Promise<void> {
  await recordOutcome(payload, "skipped", reason);
}

async function recordOutcome(
  payload: EventPayload,
  status: "failed" | "skipped",
  reason: string,
): Promise<void> {
  try {
    const { createAdminClient } = await import("@/lib/supabase/admin");
    const supabase = createAdminClient();
    await supabase.from("automation_logs").insert({
      workflow_name: "furqan-app:emitEvent",
      event_name: payload.event,
      entity_type: payload.entity_type,
      entity_id: payload.entity_id,
      idempotency_key: payload.trace_id,
      status,
      payload_json: payload as unknown as Record<string, unknown>,
      error_message: reason,
      finished_at: new Date().toISOString(),
    } as never);
  } catch {
    // Swallow — if we can't even log, the caller still gets normal control flow.
  }
}
