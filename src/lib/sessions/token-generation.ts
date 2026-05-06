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

// ────────────────────────────────────────────────────────────────────────
// HIGH-LEVEL WRAPPER
// ────────────────────────────────────────────────────────────────────────
//
// Bridges the role-lookup logic that Stage 6's halaqa video page needs.
// Lookup order:
//
//   1. session_participants (halaqa enrollees + halaqa teacher)
//   2. bookings (legacy private — teacher_id / student_id derive role)
//   3. session_observers (admin observer flow per Stage 9 schema)
//   4. is_admin_or_mod check (admin can join as observer even without a
//      pre-recorded session_observers row — covers the "I'm dropping in
//      to monitor" case)
//
// If none match, throws — caller doesn't have access to this session.

import type { createAdminClient } from "@/lib/supabase/admin";

type AdminClient = ReturnType<typeof createAdminClient>;

interface SessionForRoleLookup {
  id: string;
  booking_id: string | null;
}

/**
 * Resolve a (session, user) pair to a meeting role.
 *
 * Returns null if the user has no claim on the session. Caller should
 * surface this as an authorization error.
 *
 * Exported for unit testing and for callers that just need the role
 * without a token (e.g. the join page rendering "you're not enrolled").
 *
 * Lookup order — first match wins:
 *
 *   1. session_participants — halaqa enrollees + halaqa teacher.
 *      Stage 5 enrollment writes these rows; teacher row is written
 *      by /admin/halaqas/new (#83).
 *
 *   2. bookings (only for private sessions where booking_id is set):
 *      booking.teacher_id === userId → 'teacher'
 *      booking.student_id === userId → 'student'
 *      This is the path legacy 1:1 sessions take. Halaqa rows have
 *      booking_id = NULL so this branch is skipped for them.
 *
 *   3. session_observers — admin who's joined as a hidden observer.
 *      Pre-existing flow from V9 schema.
 */
export async function resolveMeetingRole(
  admin: AdminClient,
  session: SessionForRoleLookup,
  userId: string,
): Promise<MeetingRole | null> {
  // 1. session_participants (halaqa path + halaqa teacher)
  const { data: participant } = await admin
    .from("session_participants")
    .select("role")
    .eq("session_id", session.id)
    .eq("user_id", userId)
    .maybeSingle<{ role: MeetingRole }>();
  if (participant?.role) return participant.role;

  // 2. bookings — only meaningful for private sessions
  if (session.booking_id) {
    const { data: booking } = await admin
      .from("bookings")
      .select("teacher_id, student_id")
      .eq("id", session.booking_id)
      .maybeSingle<{ teacher_id: string; student_id: string }>();
    if (booking) {
      if (booking.teacher_id === userId) return "teacher";
      if (booking.student_id === userId) return "student";
    }
  }

  // 3. session_observers (admin who's joined as hidden observer)
  const { data: observer } = await admin
    .from("session_observers")
    .select("observer_id")
    .eq("session_id", session.id)
    .eq("observer_id", userId)
    .maybeSingle();
  if (observer) return "observer";

  return null;
}

