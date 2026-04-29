import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Constant-time string compare for secrets/tokens.
 *
 * Why: plain `===` short-circuits on first byte mismatch; an attacker measuring
 * response latency can recover the secret byte-by-byte. Use this for any
 * shared-secret check (webhook headers, cron auth, API tokens).
 */
export function safeCompareSecret(
  received: string | null | undefined,
  expected: string | null | undefined,
): boolean {
  if (!received || !expected) return false;
  const a = Buffer.from(received);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

/**
 * Sign an outbound webhook payload with HMAC-SHA256 and a freshness timestamp.
 *
 * Returns the headers a downstream verifier needs:
 *   X-Furqan-Timestamp — unix-seconds the message was signed
 *   X-Furqan-Signature — hex HMAC-SHA256 of `${timestamp}.${rawBody}`
 *
 * The verifier MUST:
 *   1. Reject if |now - timestamp| > 300 seconds (replay window).
 *   2. Recompute the HMAC and compare with `safeCompareSecret`.
 *
 * The body is concatenated with the timestamp before signing so a captured
 * (body, signature) pair cannot be replayed with a fresh timestamp.
 */
export function signWebhookPayload(
  rawBody: string,
  secret: string,
  nowSeconds: number = Math.floor(Date.now() / 1000),
): { timestamp: string; signature: string } {
  const timestamp = String(nowSeconds);
  const signature = createHmac("sha256", secret)
    .update(`${timestamp}.${rawBody}`)
    .digest("hex");
  return { timestamp, signature };
}

/**
 * Verify an inbound HMAC-signed webhook. Returns true only if the timestamp is
 * within the freshness window AND the signature matches.
 *
 * `windowSeconds` defaults to 300 (5 min) — the standard webhook freshness
 * window used by Stripe/GitHub/etc.
 */
export function verifyWebhookSignature(
  rawBody: string,
  receivedTimestamp: string | null | undefined,
  receivedSignature: string | null | undefined,
  secret: string,
  windowSeconds: number = 300,
): boolean {
  if (!receivedTimestamp || !receivedSignature) return false;
  const ts = Number(receivedTimestamp);
  if (!Number.isFinite(ts)) return false;
  const ageSeconds = Math.abs(Math.floor(Date.now() / 1000) - ts);
  if (ageSeconds > windowSeconds) return false;
  const expected = createHmac("sha256", secret)
    .update(`${receivedTimestamp}.${rawBody}`)
    .digest("hex");
  return safeCompareSecret(receivedSignature, expected);
}
