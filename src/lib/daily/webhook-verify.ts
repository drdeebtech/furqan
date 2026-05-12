import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Verify a Daily.co webhook signature.
 *
 * Daily computes HMAC-SHA256(secret, rawBody) and sends the hex digest
 * in the `X-Webhook-Signature` header. We recompute it server-side over
 * the raw request body (not the parsed JSON) so whitespace and key order
 * are preserved.
 *
 * The length guard before timingSafeEqual is required — the function
 * throws when buffer lengths differ.
 */
export function verifyDailySignature(
  rawBody: string,
  header: string,
  secret: string,
): boolean {
  if (!header) return false;
  const expected = createHmac("sha256", secret).update(rawBody).digest();
  const provided = Buffer.from(header, "hex");
  if (expected.length !== provided.length) return false;
  return timingSafeEqual(expected, provided);
}
