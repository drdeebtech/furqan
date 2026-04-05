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
        max_participants: 2,
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
