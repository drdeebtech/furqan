const DAILY_API_BASE = "https://api.daily.co/v1";

interface DailyRoom {
  url: string;
  name: string;
}

function getApiKey(): string {
  const apiKey = process.env.DAILY_API_KEY;
  if (!apiKey) {
    throw new Error("DAILY_API_KEY is not set");
  }
  return apiKey;
}

export async function createRoom(
  roomName: string,
  expiresAt: Date,
  maxParticipants: number = 2,
): Promise<DailyRoom> {
  const apiKey = getApiKey();

  const response = await fetch(`${DAILY_API_BASE}/rooms`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      name: roomName,
      privacy: "private",
      properties: {
        exp: Math.floor(expiresAt.getTime() / 1000),
        enable_chat: true,
        enable_screenshare: false,
        max_participants: maxParticipants,
      },
    }),
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Daily.co API error (${response.status}): ${body}`);
  }

  const data = await response.json();
  return { url: data.url, name: data.name };
}

/**
 * Generate a scoped meeting token for a specific user.
 * Tokens are tied to a room and expire with it.
 */
export async function createMeetingToken(
  roomName: string,
  userName: string,
  expiresAt: Date,
  isOwner: boolean = false,
): Promise<string> {
  const apiKey = getApiKey();

  const response = await fetch(`${DAILY_API_BASE}/meeting-tokens`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      properties: {
        room_name: roomName,
        user_name: userName,
        exp: Math.floor(expiresAt.getTime() / 1000),
        is_owner: isOwner,
      },
    }),
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Daily.co meeting-token error (${response.status}): ${body}`);
  }

  const data = await response.json();
  return data.token as string;
}

/**
 * Get room info (status, expiry, participants).
 */
export async function getRoomInfo(roomName: string) {
  const apiKey = getApiKey();
  const response = await fetch(`${DAILY_API_BASE}/rooms/${roomName}`, {
    headers: { Authorization: `Bearer ${apiKey}` },
  });
  if (!response.ok) return null;
  const data = await response.json();
  return {
    name: data.name as string,
    url: data.url as string,
    exp: data.config?.exp as number | undefined,
    maxParticipants: data.config?.max_participants as number | undefined,
  };
}

/**
 * Update room expiry (extend session).
 */
export async function updateRoomExpiry(roomName: string, newExpiry: Date) {
  const apiKey = getApiKey();
  const response = await fetch(`${DAILY_API_BASE}/rooms/${roomName}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      properties: { exp: Math.floor(newExpiry.getTime() / 1000) },
    }),
  });
  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Daily.co update error (${response.status}): ${body}`);
  }
  return true;
}

/**
 * Delete a room.
 */
/**
 * Generate an observer token (camera/mic off by default).
 */
export async function createObserverToken(
  roomName: string,
  userName: string,
  expiresAt: Date,
): Promise<string> {
  const apiKey = getApiKey();
  const response = await fetch(`${DAILY_API_BASE}/meeting-tokens`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      properties: {
        room_name: roomName,
        user_name: userName,
        exp: Math.floor(expiresAt.getTime() / 1000),
        is_owner: false,
        start_video_off: true,
        start_audio_off: true,
      },
    }),
  });
  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Daily.co observer-token error (${response.status}): ${body}`);
  }
  const data = await response.json();
  return data.token as string;
}

/**
 * Update max_participants on a room (e.g. bump to 3 for observer).
 */
export async function updateRoomMaxParticipants(roomName: string, maxParticipants: number) {
  const apiKey = getApiKey();
  const response = await fetch(`${DAILY_API_BASE}/rooms/${roomName}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      properties: { max_participants: maxParticipants },
    }),
  });
  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Daily.co update error (${response.status}): ${body}`);
  }
  return true;
}

/**
 * Daily.co API error with HTTP status, so callers can distinguish "room
 * already gone" (404) from genuine API failures.
 */
export class DailyApiError extends Error {
  constructor(
    public readonly endpoint: string,
    public readonly status: number,
    public readonly responseBody: string,
  ) {
    super(`Daily.co ${endpoint} error (${status}): ${responseBody}`);
    this.name = "DailyApiError";
  }
}

/**
 * Delete a room. Throws DailyApiError on non-ok response (including 404 —
 * callers can branch on `.status === 404` to treat "already gone" as success).
 * This mirrors the throw-on-error pattern used by the rest of this module.
 */
export async function deleteRoom(roomName: string): Promise<void> {
  const apiKey = getApiKey();
  const response = await fetch(`${DAILY_API_BASE}/rooms/${roomName}`, {
    method: "DELETE",
    headers: { Authorization: `Bearer ${apiKey}` },
  });
  if (!response.ok) {
    throw new DailyApiError("delete-room", response.status, await response.text());
  }
}
