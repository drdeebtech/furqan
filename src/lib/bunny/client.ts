import crypto from "node:crypto";

// Bunny.net Stream client — server-only.
// Setup instructions: docs/bunny-setup.md.
//
// Three things this module does:
//   1. createVideo()                — provisions a Bunny video record;
//                                     returns the guid we store in course_lessons.
//   2. getTusUploadSignature()      — mints a short-lived TUS signature so the
//                                     browser can upload directly to Bunny without
//                                     ever seeing the API key.
//   3. getSignedPlaybackUrl()       — produces a token-authed CDN playlist URL
//                                     that expires after the given TTL (default 5 min).
//
// Webhook verification lives in verifyBunnyWebhookSignature().
//
// All fetches use AccessKey header auth (Bunny's auth scheme — they call it
// "AccessKey" not "Authorization").

const BUNNY_API_BASE = "https://video.bunnycdn.com";
const BUNNY_TUS_ENDPOINT = "https://video.bunnycdn.com/tusupload";

interface BunnyConfig {
  apiKey: string;
  libraryId: string;
  pullZoneHostname: string;
  tokenAuthKey: string;
}

function getConfig(): BunnyConfig {
  const apiKey = process.env.BUNNY_STREAM_API_KEY;
  const libraryId = process.env.BUNNY_STREAM_LIBRARY_ID;
  const pullZoneHostname = process.env.BUNNY_STREAM_PULL_ZONE_HOSTNAME;
  const tokenAuthKey = process.env.BUNNY_STREAM_TOKEN_AUTH_KEY;

  if (!apiKey || !libraryId || !pullZoneHostname || !tokenAuthKey) {
    throw new Error(
      "Bunny.net Stream is not configured. Set BUNNY_STREAM_API_KEY, " +
        "BUNNY_STREAM_LIBRARY_ID, BUNNY_STREAM_PULL_ZONE_HOSTNAME, " +
        "BUNNY_STREAM_TOKEN_AUTH_KEY in .env.local. See docs/bunny-setup.md.",
    );
  }

  return { apiKey, libraryId, pullZoneHostname, tokenAuthKey };
}

export function isBunnyConfigured(): boolean {
  return Boolean(
    process.env.BUNNY_STREAM_API_KEY &&
      process.env.BUNNY_STREAM_LIBRARY_ID &&
      process.env.BUNNY_STREAM_PULL_ZONE_HOSTNAME &&
      process.env.BUNNY_STREAM_TOKEN_AUTH_KEY,
  );
}

interface BunnyVideoResponse {
  guid: string;
  title: string;
  status: number;
  length: number;
  width?: number;
  height?: number;
  framerate?: number;
}

export async function createVideo(title: string): Promise<{ guid: string }> {
  const cfg = getConfig();
  const res = await fetch(`${BUNNY_API_BASE}/library/${cfg.libraryId}/videos`, {
    method: "POST",
    headers: {
      AccessKey: cfg.apiKey,
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify({ title }),
  });
  if (!res.ok) {
    throw new Error(`Bunny createVideo failed: ${res.status} ${await res.text()}`);
  }
  const data = (await res.json()) as BunnyVideoResponse;
  return { guid: data.guid };
}

export async function getVideo(videoId: string): Promise<BunnyVideoResponse> {
  const cfg = getConfig();
  const res = await fetch(
    `${BUNNY_API_BASE}/library/${cfg.libraryId}/videos/${videoId}`,
    { headers: { AccessKey: cfg.apiKey, Accept: "application/json" } },
  );
  if (!res.ok) {
    throw new Error(`Bunny getVideo failed: ${res.status} ${await res.text()}`);
  }
  return res.json() as Promise<BunnyVideoResponse>;
}

export async function deleteVideo(videoId: string): Promise<void> {
  const cfg = getConfig();
  const res = await fetch(
    `${BUNNY_API_BASE}/library/${cfg.libraryId}/videos/${videoId}`,
    { method: "DELETE", headers: { AccessKey: cfg.apiKey } },
  );
  if (!res.ok && res.status !== 404) {
    throw new Error(`Bunny deleteVideo failed: ${res.status} ${await res.text()}`);
  }
}

interface TusUploadCredentials {
  endpoint: string;
  libraryId: string;
  videoId: string;
  signature: string;
  expirationTime: number;
}

// TUS resumable upload signature.
// Per Bunny docs: AuthorizationSignature = SHA256(libraryId + apiKey + expirationTime + videoId), hex-encoded.
// The browser sends these as TUS upload headers; the API key never leaves the server.
export function getTusUploadSignature(
  videoId: string,
  expiresInSeconds = 3600,
): TusUploadCredentials {
  const cfg = getConfig();
  const expirationTime = Math.floor(Date.now() / 1000) + expiresInSeconds;
  const sigInput = `${cfg.libraryId}${cfg.apiKey}${expirationTime}${videoId}`;
  const signature = crypto.createHash("sha256").update(sigInput).digest("hex");

  return {
    endpoint: BUNNY_TUS_ENDPOINT,
    libraryId: cfg.libraryId,
    videoId,
    signature,
    expirationTime,
  };
}

// Signed playback URL (HLS playlist). Default TTL 5 min — short enough to
// discourage link-sharing, long enough to survive a brief page reload.
//
// Bunny token auth scheme:
//   token = base64url(SHA256(tokenAuthKey + path + expirationTime))
//   path  = "/<videoId>/playlist.m3u8"
//   url   = "https://<pullZone><path>?token=<token>&expires=<expirationTime>"
export function getSignedPlaybackUrl(videoId: string, ttlSeconds = 300): string {
  const cfg = getConfig();
  const expires = Math.floor(Date.now() / 1000) + ttlSeconds;
  const path = `/${videoId}/playlist.m3u8`;
  const hash = crypto
    .createHash("sha256")
    .update(`${cfg.tokenAuthKey}${path}${expires}`)
    .digest();
  const token = hash
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=/g, "");
  return `https://${cfg.pullZoneHostname}${path}?token=${token}&expires=${expires}`;
}

// Webhook signature verification.
// Bunny.net signs webhook bodies with HMAC-SHA256 using the secret you set in
// the dashboard, sent in the Bunny-Signature header (lowercase hex).
export function verifyBunnyWebhookSignature(
  rawBody: string,
  providedSignature: string,
): boolean {
  const secret = process.env.BUNNY_WEBHOOK_SECRET;
  if (!secret) {
    throw new Error(
      "BUNNY_WEBHOOK_SECRET is not configured. Set it from the Bunny dashboard webhook section.",
    );
  }
  const expected = crypto
    .createHmac("sha256", secret)
    .update(rawBody)
    .digest("hex");

  if (expected.length !== providedSignature.length) return false;
  return crypto.timingSafeEqual(
    Buffer.from(expected, "hex"),
    Buffer.from(providedSignature, "hex"),
  );
}

// Bunny's webhook Status field (integer enum) mapped to our text status column.
//   0=Created, 1=Uploaded, 2=Processing, 3=Transcoding, 4=Finished,
//   5=Error, 6=UploadFailed, 7=JitSegmenting
export function bunnyStatusToVideoStatus(
  bunnyStatus: number,
): "uploading" | "processing" | "ready" | "failed" {
  switch (bunnyStatus) {
    case 4:
      return "ready";
    case 5:
    case 6:
      return "failed";
    case 0:
    case 1:
      return "uploading";
    case 2:
    case 3:
    case 7:
    default:
      return "processing";
  }
}

export interface BunnyWebhookPayload {
  VideoLibraryId: number;
  VideoGuid: string;
  Status: number;
}
