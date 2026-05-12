import { NextResponse, type NextRequest } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { logError } from "@/lib/logger";
import { emitEvent } from "@/lib/automation/emit";
import { verifyDailySignature } from "@/lib/daily/webhook-verify";
import { dispatchDailyEvent, type DailyPayload } from "@/lib/daily/webhook-handler";

/**
 * Daily.co webhook receiver — session lifecycle source of truth.
 *
 * Handles meeting.started / meeting.ended for session lifecycle (US1–US4),
 * plus the legacy participant.joined / participant.left for attendance tracking.
 *
 * Configure on the Daily side:
 *   URL:    https://www.furqan.today/api/webhooks/daily
 *   Events: meeting.started, meeting.ended, participant.joined, participant.left
 *   HMAC:   DAILY_WEBHOOK_SECRET (SHA-256)
 */

const SKEW_WINDOW_MS = 15 * 60 * 1000; // ±15 minutes (FR-001)

export async function POST(request: NextRequest): Promise<NextResponse> {
  const rawBody = await request.text();
  const sig = request.headers.get("x-webhook-signature") ?? "";
  const timestampHeader = request.headers.get("x-webhook-timestamp") ?? "";

  // HMAC verification — try current secret, then optional previous (rotation overlap)
  const currentSecret = process.env.DAILY_WEBHOOK_SECRET;
  if (!currentSecret) {
    logError(
      "daily-webhook: DAILY_WEBHOOK_SECRET not configured",
      new Error("config-missing"),
      { tag: "daily-webhook", severity: "critical" },
    );
    return NextResponse.json({ error: "internal_error" }, { status: 500 });
  }

  const prevSecret = process.env.DAILY_WEBHOOK_SECRET_PREVIOUS;
  const validSig =
    verifyDailySignature(rawBody, sig, currentSecret, timestampHeader) ||
    (!!prevSecret && verifyDailySignature(rawBody, sig, prevSecret, timestampHeader));

  if (!validSig) {
    logError("daily-webhook: invalid HMAC signature", new Error("hmac-fail"), {
      tag: "daily-webhook",
      severity: "warning",
      metric: "daily_webhook.hmac_failure",
      threshold_alert: "failed-verification > 5/min",
    });
    return NextResponse.json({ error: "invalid_signature" }, { status: 401 });
  }

  // Parse JSON
  let payload: DailyPayload;
  try {
    payload = JSON.parse(rawBody) as DailyPayload;
  } catch {
    return NextResponse.json({ error: "invalid_payload" }, { status: 400 });
  }

  // FR-001: reject events outside the ±15-min skew window.
  // Return 200 so Daily doesn't retry — this is a valid event, just too old/future.
  const skewMs = Math.abs(Date.now() - payload.timestamp);
  if (skewMs > SKEW_WINDOW_MS) {
    logError(
      "daily-webhook: event outside ±15-min skew window",
      new Error("stale-event"),
      {
        tag: "daily-webhook",
        severity: "warning",
        metadata: { eventId: payload.id, timestamp: payload.timestamp, skewMs },
      },
    );
    return NextResponse.json({ ok: true, applied: false, reason: "stale-event" });
  }

  // Route by event type
  if (payload.type === "meeting.started" || payload.type === "meeting.ended") {
    return handleSessionLifecycle(payload, rawBody);
  }

  // Legacy attendance tracking path (participant.joined / participant.left)
  return handleParticipantEvent(payload);
}

// ── Session lifecycle (US1–US4) ───────────────────────────────────────────────

async function handleSessionLifecycle(
  payload: DailyPayload,
  rawBody: string,
): Promise<NextResponse> {
  let result;
  try {
    result = await dispatchDailyEvent(payload, rawBody);
  } catch (err) {
    logError("daily-webhook: dispatchDailyEvent threw", err, {
      tag: "daily-webhook",
      severity: "critical",
    });
    return NextResponse.json({ error: "internal_error" }, { status: 500 });
  }

  switch (result.kind) {
    case "unsupported-type":
      return NextResponse.json({ ok: true, applied: false, reason: "unsupported-event-type" });

    case "unmapped":
      // T015: log unmapped rooms so operator has Sentry signal (FR-010)
      logError("daily-webhook: unmappable room_name", new Error("unmapped-room"), {
        tag: "daily-webhook",
        severity: "warning",
        metric: "daily_webhook.unmapped_room",
        threshold_alert: "unmapped-room > 10/hour",
        metadata: { roomName: result.roomName, eventType: payload.type },
      });
      return NextResponse.json({ ok: true, applied: false, reason: "no-matching-session" });

    case "started":
      return NextResponse.json({ ok: true, applied: true, event: "meeting.started" });

    case "started-duplicate":
      return NextResponse.json({ ok: true, applied: false, reason: "duplicate" });

    case "duplicate":
      return NextResponse.json({
        ok: true,
        session_id: result.sessionId,
        applied: false,
        reason: "duplicate",
      });

    case "applied": {
      const { sessionId, bookingId, studentId, teacherId, statusOutcome, isReconcile } = result;
      const durationSeconds = payload.data.duration ?? 0;

      // T014: post-commit event selection by status_outcome (FR-006 + Clarify Q1)
      // Fire-and-forget — never awaited to keep hot path under 500ms (FR-009)
      if (statusOutcome === "completed") {
        emitEvent("session.ended", "session", sessionId, {
          booking_id:     bookingId,
          student_id:     studentId,
          teacher_id:     teacherId,
          source:         "daily-webhook",
          status_outcome: statusOutcome,
          is_reconcile:   isReconcile,
        }).catch((err) =>
          logError("daily-webhook: emit session.ended failed", err, {
            tag: "daily-webhook",
            event: "session.ended",
          }),
        );
      } else if (statusOutcome === "no_show") {
        emitEvent("session.no_show", "session", sessionId, {
          booking_id:       bookingId,
          student_id:       studentId,
          teacher_id:       teacherId,
          source:           "daily-webhook",
          reason:           "misclick-filter",
          duration_seconds: durationSeconds,
        }).catch((err) =>
          logError("daily-webhook: emit session.no_show failed", err, {
            tag: "daily-webhook",
            event: "session.no_show",
          }),
        );
      }
      // statusOutcome === "preserved": booking-domain ownership preserved — emit nothing
      // (duplicate kind handled above)

      const body: Record<string, unknown> = {
        ok:         true,
        session_id: sessionId,
        applied:    true,
        status_outcome: statusOutcome,
      };
      if (isReconcile)                body.reason = "reconciled";
      if (statusOutcome === "no_show") body.reason = "misclick-filter";
      if (statusOutcome === "preserved") {
        body.applied = "session-only";
        body.reason  = "booking-status-preserved";
      }

      return NextResponse.json(body);
    }
  }
}

// ── Attendance tracking (legacy, stage 6) ────────────────────────────────────

async function handleParticipantEvent(payload: DailyPayload): Promise<NextResponse> {
  if (payload.type !== "participant.joined" && payload.type !== "participant.left") {
    return NextResponse.json({ ok: true, applied: false, reason: "unsupported-event-type" });
  }

  const roomName = payload.room?.name;
  if (!roomName) {
    return NextResponse.json({ ok: true, applied: false, reason: "no-room-name" });
  }

  const admin = createAdminClient();
  const { data: session } = await admin
    .from("sessions")
    .select("id, scheduled_at")
    .eq("room_name", roomName)
    .maybeSingle<{ id: string; scheduled_at: string | null }>();

  if (!session) {
    logError("daily-webhook: unmappable room (participant event)", new Error("unmapped-room"), {
      tag: "daily-webhook",
      severity: "warning",
      metric: "daily_webhook.unmapped_room",
      threshold_alert: "unmapped-room > 10/hour",
      metadata: { roomName, eventType: payload.type },
    });
    return NextResponse.json({ ok: true, applied: false, reason: "no-matching-session" });
  }

  // Daily sends participant data in a different shape — cast through unknown
  const raw = payload as unknown as {
    payload?: { participant?: { user_id?: string } };
  };
  const participantUserId = raw.payload?.participant?.user_id;
  const nowIso = new Date().toISOString();

  if (payload.type === "participant.joined") {
    if (!participantUserId) {
      return NextResponse.json({ ok: true, applied: false, reason: "no-participant-id" });
    }
    let attendanceStatus: "attended" | "late" = "attended";
    if (session.scheduled_at) {
      const lateThresholdMs = new Date(session.scheduled_at).getTime() + 5 * 60 * 1000;
      if (Date.now() > lateThresholdMs) attendanceStatus = "late";
    }
    const { error } = await admin
      .from("session_participants")
      .update({ joined_at: nowIso, attendance_status: attendanceStatus } as never)
      .eq("session_id", session.id)
      .eq("user_id", participantUserId);
    if (error) {
      logError("daily-webhook: participant.joined update failed", error, {
        tag: "daily-webhook",
        metadata: { session_id: session.id, user_id: participantUserId },
      });
    }
    return NextResponse.json({ ok: true, applied: true, event: payload.type });
  }

  // participant.left
  if (!participantUserId) {
    return NextResponse.json({ ok: true, applied: false, reason: "no-participant-id" });
  }
  const { error } = await admin
    .from("session_participants")
    .update({ left_at: nowIso } as never)
    .eq("session_id", session.id)
    .eq("user_id", participantUserId);
  if (error) {
    logError("daily-webhook: participant.left update failed", error, {
      tag: "daily-webhook",
      metadata: { session_id: session.id, user_id: participantUserId },
    });
  }
  return NextResponse.json({ ok: true, applied: true, event: payload.type });
}
