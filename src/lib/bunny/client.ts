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
//
// Default TTL is 4 hours so a 1.5–2 GB lecture on a slow mobile uplink (e.g.
// Egypt at 5 Mbps) survives a few resumes without the signature expiring.
// Bunny accepts up to 24h.
export function getTusUploadSignature(
  videoId: string,
  expiresInSeconds = 14400,
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
// Per https://docs.bunny.net/stream/webhooks (signature version v1):
//   Header  X-BunnyStream-Signature-Version   = "v1"
//   Header  X-BunnyStream-Signature-Algorithm = "hmac-sha256"
//   Header  X-BunnyStream-Signature           = lowercase hex HMAC-SHA256(rawBody, signingSecret)
// The signing secret is the library's Read-Only API key (NOT the regular
// API key, which is what we use for createVideo CRUD). Set it as
// BUNNY_WEBHOOK_SECRET; the env name is preserved so existing env infra
// keeps working — only the *source* of the value changes.
export function verifyBunnyWebhookSignature(
  rawBody: string,
  providedSignature: string,
  signatureVersion: string,
  signatureAlgorithm: string,
): boolean {
  if (signatureVersion !== "v1") return false;
  if (signatureAlgorithm !== "hmac-sha256") return false;

  const secret = process.env.BUNNY_WEBHOOK_SECRET;
  if (!secret) {
    throw new Error(
      "BUNNY_WEBHOOK_SECRET is not configured. Set it to your Bunny Stream library's Read-Only API key (api.bunny.net/videolibrary/<id>?includeAccessKey=true → ReadOnlyApiKey).",
    );
  }
  const expected = crypto
    .createHmac("sha256", secret)
    .update(rawBody, "utf8")
    .digest("hex");

  if (
    typeof providedSignature !== "string" ||
    providedSignature.length !== expected.length ||
    !/^[0-9a-f]+$/.test(providedSignature)
  ) {
    return false;
  }
  return crypto.timingSafeEqual(
    Buffer.from(expected, "utf8"),
    Buffer.from(providedSignature, "utf8"),
  );
}

// Bunny's webhook Status field (integer enum) mapped to our text status column.
// Per https://docs.bunny.net/stream/webhooks:
//   0=Queued, 1=Processing, 2=Encoding, 3=Finished, 4=ResolutionFinished,
//   5=Failed, 6=PresignedUploadStarted, 7=PresignedUploadFinished,
//   8=PresignedUploadFailed, 9=CaptionsGenerated, 10=TitleOrDescriptionGenerated
// 9 + 10 are non-status events (extra metadata after a video is already
// ready). Returning null tells callers to skip the video_status update so
// a "captions generated" webhook doesn't bounce a ready video back to
// processing.
export function bunnyStatusToVideoStatus(
  bunnyStatus: number,
): "uploading" | "processing" | "ready" | "failed" | null {
  switch (bunnyStatus) {
    case 0: // Queued
    case 6: // PresignedUploadStarted
    case 7: // PresignedUploadFinished (uploaded but not yet encoded)
      return "uploading";
    case 1: // Processing
    case 2: // Encoding
      return "processing";
    case 3: // Finished
    case 4: // ResolutionFinished — first one signals video is playable
      return "ready";
    case 5: // Failed
    case 8: // PresignedUploadFailed
      return "failed";
    case 9:  // CaptionsGenerated — non-status event, ignore
    case 10: // TitleOrDescriptionGenerated — non-status event, ignore
      return null;
    default:
      return "processing";
  }
}

export interface BunnyWebhookPayload {
  VideoLibraryId: number;
  VideoGuid: string;
  Status: number;
}
