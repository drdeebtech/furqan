// Stage 2 — mode-aware Daily.co room creation.
//
// The legacy `createRoom(name, expiresAt, maxParticipants)` in src/lib/daily.ts
// continues to handle private 1:1 sessions unchanged. Stage 5's halaqa booking
// flow will call `createSessionRoom()` from here instead so room properties
// match the session mode.
//
// CRITICAL: For mode='private' this function MUST produce Daily room
// properties IDENTICAL to what the legacy createRoom() emits. Any drift here
// would silently break existing private session rooms when Stage 5 starts
// routing through this service. The shared property block at the bottom of
// the function enforces parity.

import { getMaxParticipantsForMode } from "./types";
import type { SessionMode } from "./types";

const DAILY_API_BASE = "https://api.daily.co/v1";

interface CreateSessionRoomInput {
  /** Globally-unique room name. Caller picks; we do not generate. */
  name: string;
  /** Mode discriminator. Defaults to 'private' for safety if undefined. */
  mode: SessionMode | null | undefined;
  /** Room expiry. Daily refuses joins after this point. */
  expiresAt: Date;
  /**
   * Per-session capacity override. Falls back to the mode default
   * (MAX_PARTICIPANTS_BY_MODE) if not set. Capped to the mode default
   * to prevent admin error from over-provisioning a Daily room.
   */
  maxParticipants?: number;
  /** Recording opt-in. Off by default. Daily cloud recording costs apply. */
  allowRecording?: boolean;
}

interface CreateSessionRoomResult {
  url: string;
  name: string;
  /** Echoes the resolved Daily room mode for caller to persist on sessions.daily_room_mode. */
  daily_room_mode: string;
}

export async function createSessionRoom(
  input: CreateSessionRoomInput,
): Promise<CreateSessionRoomResult> {
  const apiKey = process.env.DAILY_API_KEY;
  if (!apiKey) throw new Error("DAILY_API_KEY is not set");

  const mode = (input.mode ?? "private") as SessionMode;
  const cap = getMaxParticipantsForMode(mode);
  const max = Math.min(input.maxParticipants ?? cap, cap);

  // Per-mode Daily property differences. Anything NOT branched here must
  // match the legacy createRoom() shape exactly.
  const modeProperties = buildModeProperties(mode, !!input.allowRecording);

  const properties = {
    exp: Math.floor(input.expiresAt.getTime() / 1000),
    enable_chat: true,
    enable_screenshare: false,
    max_participants: max,
    ...modeProperties,
  };

  const response = await fetch(`${DAILY_API_BASE}/rooms`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      name: input.name,
      privacy: "private",
      properties,
    }),
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Daily.co API error (${response.status}): ${body}`);
  }

  const data = await response.json();
  return {
    url: data.url,
    name: data.name,
    daily_room_mode: mode === "private" ? "default" : mode === "halaqa" ? "group" : "broadcast",
  };
}

function buildModeProperties(
  mode: SessionMode,
  allowRecording: boolean,
): Record<string, unknown> {
  switch (mode) {
    case "private":
      // No extra properties — match the legacy createRoom() shape exactly.
      // Recording stays off for private (privacy default) regardless of
      // allowRecording flag — admin controls private recording via a
      // separate post-session export flow, not Daily cloud recording.
      return {};
    case "halaqa":
      return {
        // Group sessions allow knocking so late students don't disrupt.
        enable_knocking: true,
        // Daily cloud recording when admin opted in.
        enable_recording: allowRecording ? "cloud" : "off",
      };
    case "lecture":
      // Stage 7 deferred path — actual broadcast properties land if/when
      // full Stage 7 ships. For now, throw rather than silently mis-create.
      throw new Error(
        "Lecture-mode room creation is deferred (Stage 7). Use external_lecture_url for YouTube Live integration instead.",
      );
  }
}
