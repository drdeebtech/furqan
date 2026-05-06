import { NextResponse, type NextRequest } from "next/server";
import { createHmac, timingSafeEqual } from "node:crypto";
import { createAdminClient } from "@/lib/supabase/admin";
import { logError, logWarn } from "@/lib/logger";

/**
 * Stage 6 attendance tracking — Daily.co webhook receiver.
 *
 * Daily.co posts to this endpoint when participants join/leave a meeting.
 * We map those events to session_participants.attendance_status updates so
 * the teacher roster (#89) reflects "attended / late / absent" without
 * any manual marking.
 *
 * Configure on the Daily side at: https://dashboard.daily.co/developers
 *   - Webhook URL: https://www.furqan.today/api/webhooks/daily
 *   - Subscribe to: participant.joined, participant.left, meeting.ended
 *   - Verification: HMAC-SHA256 with `DAILY_WEBHOOK_SECRET`
 *
 * Required env:
 *   DAILY_WEBHOOK_SECRET  — shared secret with Daily for HMAC verification
 *
 * Local dev / staging: if DAILY_WEBHOOK_SECRET is unset the handler
 * accepts unsigned payloads but logs a warning. NEVER deploy that
 * configuration to production.
 */

interface DailyWebhookEvent {
  version?: string;
  type: string;
  id?: string;
  event_ts?: number;
  payload?: {
    room?: string;
    room_name?: string;
    participant?: {
      user_id?: string;
      user_name?: string;
      joined_at?: number;
      session_id?: string;
    };
  };
}

const SIGNATURE_HEADER = "x-webhook-signature";

export async function POST(request: NextRequest): Promise<NextResponse> {
  const rawBody = await request.text();

  // Verify HMAC signature.
  const secret = process.env.DAILY_WEBHOOK_SECRET;
  const provided = request.headers.get(SIGNATURE_HEADER) ?? "";
  if (secret) {
    const expected = createHmac("sha256", secret).update(rawBody).digest("hex");
    let match = false;
    try {
      match =
        expected.length === provided.length &&
        timingSafeEqual(Buffer.from(expected, "hex"), Buffer.from(provided, "hex"));
    } catch {
      match = false;
    }
    if (!match) {
      return NextResponse.json({ error: "invalid signature" }, { status: 401 });
    }
  } else {
    logWarn("Daily webhook: DAILY_WEBHOOK_SECRET unset — accepting unsigned payload", {
      tag: "daily.webhook",
    });
  }

  let event: DailyWebhookEvent;
  try {
    event = JSON.parse(rawBody) as DailyWebhookEvent;
  } catch (err) {
    logError("Daily webhook: invalid JSON", err, { tag: "daily.webhook" });
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }

  // Daily uses both `room` and `room_name` historically — accept either.
  const roomName = event.payload?.room ?? event.payload?.room_name;
  const participantUserId = event.payload?.participant?.user_id;

  if (!roomName) {
    return NextResponse.json({ ok: true, ignored: "no room_name" });
  }

  const admin = createAdminClient();

  // Look up our session by Daily's room_name.
  const { data: session } = await admin
    .from("sessions")
    .select("id, scheduled_at, ended_at")
    .eq("room_name", roomName)
    .maybeSingle<{ id: string; scheduled_at: string | null; ended_at: string | null }>();

  if (!session) {
    // Unknown room — Daily forwarded a webhook for a room we don't track
    // (e.g. test rooms, manual creations). Ack 200 so Daily stops retrying.
    return NextResponse.json({ ok: true, ignored: "unknown room", room_name: roomName });
  }

  const eventType = event.type;
  const nowIso = new Date().toISOString();

  switch (eventType) {
    case "participant.joined": {
      if (!participantUserId) {
        return NextResponse.json({ ok: true, ignored: "no participant.user_id" });
      }

      // Late vs on-time: if the participant joined more than 5 min after
      // scheduled_at, mark 'late'; otherwise 'attended'. Halaqa rows have
      // scheduled_at; private rows derive scheduled time from bookings —
      // we only do the late check when scheduled_at is present.
      let attendanceStatus: "attended" | "late" = "attended";
      if (session.scheduled_at) {
        const lateThresholdMs = new Date(session.scheduled_at).getTime() + 5 * 60 * 1000;
        if (Date.now() > lateThresholdMs) attendanceStatus = "late";
      }

      const { error } = await admin
        .from("session_participants")
        .update({
          joined_at: nowIso,
          attendance_status: attendanceStatus,
        } as never)
        .eq("session_id", session.id)
        .eq("user_id", participantUserId);

      if (error) {
        logError("Daily webhook: participant.joined update failed", error, {
          tag: "daily.webhook",
          metadata: { session_id: session.id, user_id: participantUserId },
        });
      }
      return NextResponse.json({ ok: true, event: eventType });
    }

    case "participant.left": {
      if (!participantUserId) {
        return NextResponse.json({ ok: true, ignored: "no participant.user_id" });
      }

      const { error } = await admin
        .from("session_participants")
        .update({ left_at: nowIso } as never)
        .eq("session_id", session.id)
        .eq("user_id", participantUserId);

      if (error) {
        logError("Daily webhook: participant.left update failed", error, {
          tag: "daily.webhook",
          metadata: { session_id: session.id, user_id: participantUserId },
        });
      }
      return NextResponse.json({ ok: true, event: eventType });
    }

    case "meeting.ended": {
      // Anyone still marked 'registered' at meeting end is 'absent'.
      const { error } = await admin
        .from("session_participants")
        .update({ attendance_status: "absent" } as never)
        .eq("session_id", session.id)
        .eq("attendance_status", "registered");

      if (error) {
        logError("Daily webhook: meeting.ended absence sweep failed", error, {
          tag: "daily.webhook",
          metadata: { session_id: session.id },
        });
      }
      return NextResponse.json({ ok: true, event: eventType });
    }

    default:
      return NextResponse.json({ ok: true, ignored: eventType });
  }
}
