import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Verify a Daily.co webhook signature.
 *
 * Daily's actual signing protocol — captured 2026-05-12 by intercepting a
 * verification probe against a webhook.site URL:
 *
 *   key:        base64-decoded bytes of the `hmac` value submitted at
 *               registration time (Daily decodes it once before signing)
 *   payload:    `${timestamp}.${rawBody}` (Stripe-style canonicalization
 *               with `.` separator; timestamp from `x-webhook-timestamp`)
 *   signature:  HMAC-SHA256 over payload, base64-encoded, sent in the
 *               `x-webhook-signature` header
 *
 * The original implementation (spec 007) used hex everywhere and didn't
 * include the timestamp — see git history if you need the rationale.
 * That version's tests pass internally because the fixture is consistent
 * with itself, not with Daily.
 *
 * The length guard before timingSafeEqual is required — the function
 * throws when buffer lengths differ.
 */
export function verifyDailySignature(
  rawBody: string,
  header: string,
  secret: string,
  timestampHeader: string,
): boolean {
  if (!header || !timestampHeader) return false;

  // Daily's `hmac` field is required to be a base64 string at registration.
  // The signing key is the decoded bytes, not the string itself.
  const key = Buffer.from(secret, "base64");
  if (key.length === 0) return false;

  const signedPayload = `${timestampHeader}.${rawBody}`;
  const expected = createHmac("sha256", key).update(signedPayload).digest();

  let provided: Buffer;
  try {
    provided = Buffer.from(header, "base64");
  } catch {
    return false;
  }
  if (expected.length !== provided.length) return false;
  return timingSafeEqual(expected, provided);
}
