const DAILY_API_URL = "https://api.daily.co/v1/rooms";

interface DailyRoom {
  url: string;
  name: string;
}

export async function createRoom(
  roomName: string,
  expiresAt: Date,
): Promise<DailyRoom> {
  const apiKey = process.env.DAILY_API_KEY;
  if (!apiKey) {
    throw new Error("DAILY_API_KEY is not set");
  }

  const response = await fetch(DAILY_API_URL, {
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
