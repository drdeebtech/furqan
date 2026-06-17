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
import { logError } from "@/lib/logger";
import { serializePayload, type EventPayload } from "./payload";

export { serializePayload, type EventPayload } from "./payload";

const N8N_WEBHOOK_URL = process.env.N8N_WEBHOOK_URL;
const N8N_WEBHOOK_SECRET = process.env.N8N_WEBHOOK_SECRET;

/**
 * Per-event sub-flag map. When a sub-flag exists for an event and is `false`,
 * the emit is skipped (and logged). Events not listed here are gated only by
 * the master `automation_enabled` flag.
 */
const EVENT_SUB_FLAGS: Partial<Record<FurqanEvent, string>> = {
  "homework.graded": "ai_parent_reports_enabled",
  "session.notes_saved": "ai_parent_reports_enabled",
  "session.no_show": "ai_parent_reports_enabled",
  "retention.intervention_triggered": "retention_automation_enabled",
};

/**
 * Exported so the webhook-replay admin tool can route a replay to the same
 * path the original event used. Keep in sync when new events are added.
 *
 * The `as const` + `FurqanEvent` derived type below is the source of truth
 * for the event taxonomy. Adding an entry here automatically adds a member
 * to `FurqanEvent`; `emitEvent`'s first parameter is typed against it, so
 * a typo'd event name fails at compile time instead of silent-routing to
 * `DEFAULT_WEBHOOK_PATH`.
 */
export const WEBHOOK_ROUTES = {
  "booking.created": "/webhook/furqan-booking-created",
  "booking.confirmed": "/webhook/furqan-booking-confirmed",
  "booking.cancelled": "/webhook/furqan-booking-cancelled",
  "booking.status_changed": "/webhook/furqan-booking-status-changed",
  "session.ended": "/webhook/furqan-session-ended",
  "session.instant_started": "/webhook/furqan-session-instant-started",
  "session.notes_saved": "/webhook/furqan-session-notes-saved",
  "session.no_show": "/webhook/furqan-no-show-parent",
  "session.auto_completed": "/webhook/furqan-session-auto-completed",
  "session.report_sent": "/webhook/furqan-session-report-sent",
  "homework.assigned": "/webhook/furqan-homework-assigned",
  "homework.student_ready": "/webhook/furqan-homework-student-ready",
  "homework.graded": "/webhook/furqan-homework-graded",
  "evaluation.created": "/webhook/furqan-evaluation-created",
  // Progress domain (spec 010): fired when a teacher records a validated ḥifẓ
  // range. Consumed by parent reports + the 001 SM-2 nightly compute. NOTE: the
  // n8n workflow for this route must be created, else dispatch logs a loud
  // non-fatal failed-delivery automation_log until it lands.
  "progress.recorded": "/webhook/furqan-progress-recorded",
  "profile.created": "/webhook/furqan-profile-created",
  "teacher.applied": "/webhook/furqan-teacher-applied",
  "teacher.cv_submitted": "/webhook/furqan-cv-event",
  "teacher.cv_approved": "/webhook/furqan-cv-event",
  "teacher.cv_rejected": "/webhook/furqan-cv-event",
  "teacher.cv_reset": "/webhook/furqan-cv-event",
  "teacher.status_updated": "/webhook/furqan-teacher-status",
  "course.submitted": "/webhook/furqan-course-event",
  "course.approved": "/webhook/furqan-course-event",
  "course.rejected": "/webhook/furqan-course-event",
  "course.enrolled": "/webhook/furqan-course-enrolled",
  "course.completed": "/webhook/furqan-course-completed",
  "lesson.completed": "/webhook/furqan-lesson-completed",
  "review.created": "/webhook/furqan-course-review",
  "retention.intervention_triggered": "/webhook/furqan-retention-intervention-triggered",
  "package.purchased": "/webhook/furqan-package-purchased",
  // NOTE: the n8n workflow for this route must be created, otherwise dispatch
  // logs a (loud, non-fatal) failed-delivery automation_log. Admin credit
  // grants are rare, so the noise is minimal until the workflow lands.
  "package.credit_granted": "/webhook/furqan-package-credit-granted",
  "teacher.archived": "/webhook/furqan-teacher-archived",
  "user.status_changed": "/webhook/furqan-user-status",
  "user.roles_changed": "/webhook/furqan-user-roles",
  "profile.updated": "/webhook/furqan-profile-updated",
  "refund_policy.updated": "/webhook/furqan-refund-policy",
  "halaqa.created": "/webhook/furqan-halaqa-created",
  // NOTE: n8n workflows for these routes must be created when halaqa
  // notification flows are built. Until then, dispatch logs a non-fatal
  // failed-delivery automation_log.
  "halaqa.enrolled": "/webhook/furqan-halaqa-enrolled",
  // Intentionally shares the enrolled webhook — the n8n workflow branches on
  // event_type to handle enrol vs cancel with a single trigger node.
  "halaqa.enrollment_cancelled": "/webhook/furqan-halaqa-enrolled",
  "halaqa.waitlist_joined": "/webhook/furqan-halaqa-waitlist",
  "halaqa.waitlist_left": "/webhook/furqan-halaqa-waitlist",
  "message.hidden": "/webhook/furqan-message-moderated",
  "message.flag_cleared": "/webhook/furqan-message-moderated",
  "legal_document.updated": "/webhook/furqan-legal-updated",
  "package.created": "/webhook/furqan-package-admin",
  "package.updated": "/webhook/furqan-package-admin",
  "package.deleted": "/webhook/furqan-package-admin",
  // NOTE: n8n workflows for these routes must be created when teacher-
  // availability automation is built (e.g. calendar sync, student
  // notification of new slots). Until then dispatch logs a non-fatal
  // failed-delivery automation_log entry.
  "teacher.availability_slot_added": "/webhook/furqan-teacher-availability",
  "teacher.availability_slot_deleted": "/webhook/furqan-teacher-availability",
  // NOTE: n8n workflow must be created to consume this event (e.g. CRM sync,
  // auto-reply triggers). Until then dispatch logs a non-fatal failed-delivery
  // automation_log entry.
  "contact_submission.read": "/webhook/furqan-contact-submission-read",
  // Billing domain (spec 018): subscription lifecycle events emitted from the
  // webhook handler post-commit (Principle III). n8n workflows must be created
  // to consume these (e.g. seat provisioning, dunning emails); until then
  // dispatch logs a non-fatal failed-delivery automation_log.
  "subscription.activated": "/webhook/furqan-subscription-activated",
  "subscription.renewed": "/webhook/furqan-subscription-renewed",
  "subscription.past_due": "/webhook/furqan-subscription-past-due",
  "subscription.canceled": "/webhook/furqan-subscription-canceled",
  "assignment.created": "/webhook/furqan-assignment-created",
  "assignment.changed": "/webhook/furqan-assignment-changed",
  "cohort.opened": "/webhook/furqan-cohort-opened",
  "member.joined": "/webhook/furqan-member-joined",
} as const satisfies Record<string, string>;

/**
 * The canonical FURQAN event taxonomy, derived from `WEBHOOK_ROUTES`.
 * `emitEvent` accepts only members of this union; any string outside it
 * is a compile error. Adding a new event = adding a key to `WEBHOOK_ROUTES`.
 */
export type FurqanEvent = keyof typeof WEBHOOK_ROUTES;

export const DEFAULT_WEBHOOK_PATH = "/webhook/furqan-events";

export async function emitEvent(
  eventName: FurqanEvent,
  entityType: string,
  entityId: string,
  data: Record<string, unknown>,
  actorId?: string | null,
): Promise<void> {
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

  // Whole webhook flow runs in after(): config check, kill-switch check,
  // signing, fetch, and outcome recording. The caller's response ships
  // immediately while n8n/automation_logs work happens in the background —
  // no more 5s timeout sitting on the request critical path.
  after(async () => {
    // Loud skip when N8N_WEBHOOK_URL is unset in production. In dev we keep
    // the silent return so local-without-n8n DX is unchanged. Per CLAUDE.md
    // "No Silent Failures Policy" — a missing env var in prod must surface
    // in Sentry + automation_logs, not vanish.
    if (!N8N_WEBHOOK_URL) {
      if (process.env.NODE_ENV === "production") {
        logError(
          "emitEvent: N8N_WEBHOOK_URL not configured",
          new Error("config-missing"),
          { tag: "automation", kind: "config", event: eventName },
        );
        await recordSkipped(payload, "n8n_webhook_url unset");
      }
      return;
    }
    const settings = await getSettings().catch((err) => {
      // Settings drive automation_enabled + per-event sub-flags. Silently
      // falling through to {} means every event gets dropped as if
      // automation_enabled=false — indistinguishable from operator intent.
      logError("emit: getSettings failed; defaulting to empty settings", err, {
        tag: "automation", kind: "config", event: eventName,
      });
      return {} as Record<string, string>;
    });
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
    const { error: autoLogError } = await supabase.from("automation_logs").insert({
      workflow_name: "furqan-app:emitEvent",
      event_name: payload.event,
      entity_type: payload.entity_type,
      entity_id: payload.entity_id,
      idempotency_key: payload.trace_id,
      status,
      payload_json: payload as never,
      error_message: reason,
      finished_at: new Date().toISOString(),
    });
    if (autoLogError) {
      logError("recordSkipped/recordFailed automation_log insert failed", autoLogError, {
        tag: "automation", event: payload.event, kind: status,
      });
    }
  } catch (err) {
    // Network-level rejection (rare). Still log so persistent failures
    // (e.g. admin client init crash) don't disappear entirely.
    logError("recordSkipped/recordFailed crashed before insert", err, {
      tag: "automation", event: payload.event, kind: status,
    });
  }
}
