import { createAdminClient } from "@/lib/supabase/admin";
import { callRpc } from "@/lib/supabase/rpc";
import type { Json } from "@/types/database";

export type DailyPayload = {
  id: string;
  type: string;
  version: string;
  timestamp: number;
  room: { name: string; id: string; domain_name: string };
  data: {
    start_time?: number;
    end_time?: number;
    duration?: number;
    max_participants?: number;
    total_participants?: number;
    session_id?: string;
  };
};

export type DispatchResult =
  | { kind: "applied"; sessionId: string; bookingId: string; studentId: string; teacherId: string; statusOutcome: string; isReconcile: boolean }
  | { kind: "duplicate"; sessionId: string; bookingId: string; studentId: string; teacherId: string }
  | { kind: "unmapped"; roomName: string }
  | { kind: "unsupported-type"; eventType: string }
  | { kind: "started" }
  | { kind: "started-duplicate" };

/**
 * Map a verified Daily.co webhook payload to the appropriate SQL function
 * and return a discriminated result the route handler can act on.
 *
 * Preconditions (enforced by the route adapter before this is called):
 *  - HMAC signature is valid
 *  - payload.timestamp is within the ±15-min skew window
 */
export async function dispatchDailyEvent(
  payload: DailyPayload,
  rawPayloadJson: string,
): Promise<DispatchResult> {
  const { type, id: eventId, room, data } = payload;
  const roomName = room.name;
  const supabase = createAdminClient();

  if (type !== "meeting.started" && type !== "meeting.ended") {
    return { kind: "unsupported-type", eventType: type };
  }

  // Look up session by room_name (indexed partial UNIQUE column)
  const { data: session } = await supabase
    .from("sessions")
    .select("id")
    .eq("room_name", roomName)
    .single<{ id: string }>();

  if (!session) {
    return { kind: "unmapped", roomName };
  }

  const sessionId = session.id;
  const payloadJson = JSON.parse(rawPayloadJson) as Json;

  if (type === "meeting.started") {
    const startedAt = data.start_time
      ? new Date(data.start_time * 1000).toISOString()
      : new Date().toISOString();

    const { data: applied, error } = await callRpc(
      supabase,
      "start_session_from_webhook",
      {
        p_session_id:   sessionId,
        p_started_at:   startedAt,
        p_event_id:     eventId,
        p_room_name:    roomName,
        p_payload_json: payloadJson,
      },
    );
    if (error) throw error;
    return applied ? { kind: "started" } : { kind: "started-duplicate" };
  }

  // meeting.ended
  const endedAt = data.end_time
    ? new Date(data.end_time * 1000).toISOString()
    : new Date().toISOString();
  const durationSeconds = data.duration ?? 0;
  const durationMin = Math.round(durationSeconds / 60);

  type EndRow = {
    booking_id:     string;
    student_id:     string;
    teacher_id:     string;
    is_duplicate:   boolean;
    is_reconcile:   boolean;
    status_outcome: string;
  };
  const rpcResult = await callRpc(supabase, "end_session_from_webhook", {
    p_session_id:       sessionId,
    p_ended_at:         endedAt,
    p_duration_min:     durationMin,
    p_duration_seconds: durationSeconds,
    p_event_id:         eventId,
    p_event_type:       type,
    p_room_name:        roomName,
    p_payload_json:     payloadJson,
  });
  const error = rpcResult.error;
  const rows = rpcResult.data as EndRow[] | null;

  if (error) throw error;
  const row = rows?.[0];
  if (!row) throw new Error("end_session_from_webhook returned no rows");

  if (row.is_duplicate) {
    return {
      kind: "duplicate",
      sessionId,
      bookingId: row.booking_id,
      studentId: row.student_id,
      teacherId: row.teacher_id,
    };
  }

  return {
    kind: "applied",
    sessionId,
    bookingId:     row.booking_id,
    studentId:     row.student_id,
    teacherId:     row.teacher_id,
    statusOutcome: row.status_outcome,
    isReconcile:   row.is_reconcile,
  };
}
