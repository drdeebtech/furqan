/**
 * Event emission to n8n automation engine.
 * Non-blocking — fire-and-forget in try/catch.
 *
 * Usage in server actions:
 *   try { await emitEvent("booking.confirmed", "booking", bookingId, { student_id, teacher_id }); } catch {}
 */

const N8N_WEBHOOK_URL = process.env.N8N_WEBHOOK_URL;

interface EventPayload {
  event: string;
  occurred_at: string;
  entity_type: string;
  entity_id: string;
  actor_id?: string | null;
  trace_id: string;
  source: "furqan-app";
  data: Record<string, unknown>;
}

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

  // Map events to specific n8n webhook paths
  const WEBHOOK_ROUTES: Record<string, string> = {
    "booking.confirmed": "/webhook/furqan-booking-confirmed",
    "session.notes_saved": "/webhook/furqan-session-notes-saved",
    "session.no_show": "/webhook/furqan-no-show-parent",
    "homework.graded": "/webhook/furqan-homework-graded",
    "profile.created": "/webhook/furqan-profile-created",
    "teacher.cv_submitted": "/webhook/furqan-cv-event",
    "teacher.cv_approved": "/webhook/furqan-cv-event",
    "teacher.cv_rejected": "/webhook/furqan-cv-event",
  };

  // Send to specific webhook if mapped, otherwise to generic events endpoint
  const path = WEBHOOK_ROUTES[eventName] ?? "/webhook/furqan-events";

  // Fire-and-forget with 5s timeout
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 5000);

  try {
    await fetch(`${N8N_WEBHOOK_URL}${path}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Furqan-Event": eventName,
      },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timeout);
  }
}
