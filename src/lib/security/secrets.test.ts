import { describe, it, expect } from "vitest";
import { safeCompareSecret, signWebhookPayload, verifyWebhookSignature } from "./secrets";

describe("safeCompareSecret", () => {
  it("returns true for identical strings", () => {
    expect(safeCompareSecret("abc123", "abc123")).toBe(true);
  });

  it("returns false for different strings of equal length", () => {
    expect(safeCompareSecret("abc123", "abc124")).toBe(false);
  });

  it("returns false for strings of different lengths (no length oracle leak)", () => {
    expect(safeCompareSecret("short", "muchlongerstring")).toBe(false);
  });

  it("returns false for null/undefined inputs", () => {
    expect(safeCompareSecret(null, "abc")).toBe(false);
    expect(safeCompareSecret("abc", undefined)).toBe(false);
    expect(safeCompareSecret(null, undefined)).toBe(false);
  });

  it("returns false for empty strings", () => {
    // Empty-vs-empty would technically match, but we treat empty as 'not set'
    // because empty secrets are an env-misconfiguration, not a valid value.
    expect(safeCompareSecret("", "")).toBe(false);
  });
});

describe("signWebhookPayload + verifyWebhookSignature", () => {
  const SECRET = "test-secret-do-not-use-in-prod";
  const BODY = '{"event":"booking.confirmed","entity_id":"abc"}';

  it("round-trips: a freshly signed payload verifies", () => {
    const { timestamp, signature } = signWebhookPayload(BODY, SECRET);
    expect(verifyWebhookSignature(BODY, timestamp, signature, SECRET)).toBe(true);
  });

  it("rejects a tampered body", () => {
    const { timestamp, signature } = signWebhookPayload(BODY, SECRET);
    const tampered = BODY.replace("abc", "xyz");
    expect(verifyWebhookSignature(tampered, timestamp, signature, SECRET)).toBe(false);
  });

  it("rejects a wrong secret", () => {
    const { timestamp, signature } = signWebhookPayload(BODY, SECRET);
    expect(verifyWebhookSignature(BODY, timestamp, signature, "different-secret")).toBe(false);
  });

  it("rejects a stale timestamp outside the window", () => {
    const sixMinAgo = Math.floor(Date.now() / 1000) - 360;
    const { timestamp, signature } = signWebhookPayload(BODY, SECRET, sixMinAgo);
    expect(verifyWebhookSignature(BODY, timestamp, signature, SECRET)).toBe(false);
  });

  it("accepts a timestamp at the edge of the window", () => {
    const fourMinAgo = Math.floor(Date.now() / 1000) - 240;
    const { timestamp, signature } = signWebhookPayload(BODY, SECRET, fourMinAgo);
    expect(verifyWebhookSignature(BODY, timestamp, signature, SECRET)).toBe(true);
  });

  it("rejects when the signature is missing", () => {
    const { timestamp } = signWebhookPayload(BODY, SECRET);
    expect(verifyWebhookSignature(BODY, timestamp, null, SECRET)).toBe(false);
    expect(verifyWebhookSignature(BODY, timestamp, "", SECRET)).toBe(false);
  });

  it("rejects when the timestamp is missing or not numeric", () => {
    const { signature } = signWebhookPayload(BODY, SECRET);
    expect(verifyWebhookSignature(BODY, null, signature, SECRET)).toBe(false);
    expect(verifyWebhookSignature(BODY, "not-a-number", signature, SECRET)).toBe(false);
  });

  it("signature is stable for identical (body, timestamp, secret) triples", () => {
    const ts = Math.floor(Date.now() / 1000);
    const a = signWebhookPayload(BODY, SECRET, ts);
    const b = signWebhookPayload(BODY, SECRET, ts);
    expect(a.signature).toBe(b.signature);
  });

  it("signature changes when timestamp changes (binds timestamp to body)", () => {
    const a = signWebhookPayload(BODY, SECRET, 1000);
    const b = signWebhookPayload(BODY, SECRET, 2000);
    expect(a.signature).not.toBe(b.signature);
  });
});
