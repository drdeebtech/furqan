// Stage 2.5 — Daily.co meeting token generation.
//
// Companion to createSessionRoom() in ./room-creation.ts. The room is the
// shared resource; the token is the per-participant credential that lets
// them join with the right permissions (host vs attendee, mic-on vs muted,
// observer hidden, etc.). Tokens are short-lived and re-issued every join.
//
// This module ships only the LOW-LEVEL primitive — `createMeetingToken()`
// — which takes an explicit role and calls Daily's API. Stage 6's halaqa
// video page will add a HIGH-LEVEL wrapper `generateMeetingToken(sessionId,
// userId)` that does the role lookup (session_participants for halaqa,
// bookings for legacy private) and forwards to this primitive.
//
// Keeping role determination out of this file lets the function be:
//   - Easily unit-testable (no DB dependency)
//   - Reusable for both private (driven by booking) and halaqa (driven by
//     session_participants) flows without baking in either lookup pattern

const DAILY_API_BASE = "https://api.daily.co/v1";

export type MeetingRole = "teacher" | "student" | "observer";

interface CreateMeetingTokenInput {
  /** Globally-unique Daily room name to join. */
  roomName: string;
  /** Stable user id (Supabase auth.users.id). Lets Daily de-dupe re-joins. */
  userId: string;
  /** Display name shown in the participant tile / waiting room. */
  userName: string;
  /**
   * Participant role. Drives is_owner + start_audio/video defaults.
   *
   * - 'teacher' → is_owner: true, mic/camera on, can admin
   * - 'student' → is_owner: false, mic/camera on, normal student permissions
   * - 'observer' → is_owner: false, mic/camera off + hidden_from_participant_list,
   *   matches the existing admin observer flow (per CLAUDE.md "session
   *   observation: Daily.co observer tokens with mic/camera off")
   */
  role: MeetingRole;
  /**
   * Token expiry. After this time the token can't join the room. Set
   * to scheduled_at + duration + grace (typically 30min).
   */
  expiresAt: Date;
}

/**
 * Issue a Daily meeting token for a single (room, user, role) combination.
 *
 * Returns the JWT-shaped token string the client passes to Daily's
 * `<DailyProvider>` or `iframe.join({ token })`.
 *
 * Throws on Daily API error (4xx/5xx) — caller should wrap in loudAction
 * so failures surface to the user + Sentry.
 */
export async function createMeetingToken(
  input: CreateMeetingTokenInput,
): Promise<string> {
  const apiKey = process.env.DAILY_API_KEY;
  if (!apiKey) throw new Error("DAILY_API_KEY is not set");

  const properties = buildTokenProperties(input);

  const response = await fetch(`${DAILY_API_BASE}/meeting-tokens`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({ properties }),
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Daily.co token API error (${response.status}): ${body}`);
  }

  const data = (await response.json()) as { token?: string };
  if (!data.token) throw new Error("Daily.co token response missing token field");
  return data.token;
}

function buildTokenProperties(input: CreateMeetingTokenInput): Record<string, unknown> {
  const base: Record<string, unknown> = {
    room_name: input.roomName,
    user_id: input.userId,
    user_name: input.userName,
    exp: Math.floor(input.expiresAt.getTime() / 1000),
  };

  switch (input.role) {
    case "teacher":
      return {
        ...base,
        is_owner: true,
        // Teachers join with mic/camera ready — they're hosting.
        start_audio_off: false,
        start_video_off: false,
      };
    case "student":
      return {
        ...base,
        is_owner: false,
        start_audio_off: false,
        start_video_off: false,
      };
    case "observer":
      // Matches the existing admin-observer flow per CLAUDE.md and
      // session_observers table semantics: muted, no camera, hidden
      // from the participant list so the teacher and student don't
      // see the moderator watching.
      return {
        ...base,
        is_owner: false,
        start_audio_off: true,
        start_video_off: true,
        // Daily property name for hiding observers from the
        // participant list — verified against Daily docs.
        hidden_from_participant_list: true,
      };
  }
}
