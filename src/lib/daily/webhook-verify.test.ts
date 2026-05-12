import { createHmac, randomBytes } from "node:crypto";
import { describe, it, expect } from "vitest";
import { verifyDailySignature } from "./webhook-verify";

// Daily-shape secret: base64-encoded random bytes (Daily decodes once at sign time).
const SECRET_BYTES = randomBytes(32);
const SECRET = SECRET_BYTES.toString("base64");
const TIMESTAMP = "1778619696910";

function makeSignature(body: string, secretBytes = SECRET_BYTES, timestamp = TIMESTAMP): string {
  return createHmac("sha256", secretBytes)
    .update(`${timestamp}.${body}`)
    .digest("base64");
}

describe("verifyDailySignature", () => {
  it("accepts a valid signature using Daily's actual protocol (timestamp.body, base64 sig, base64-decoded key)", () => {
    const body = '{"type":"meeting.ended"}';
    expect(verifyDailySignature(body, makeSignature(body), SECRET, TIMESTAMP)).toBe(true);
  });

  it("rejects a signature computed with the wrong secret", () => {
    const body = '{"type":"meeting.ended"}';
    const sig = makeSignature(body, randomBytes(32));
    expect(verifyDailySignature(body, sig, SECRET, TIMESTAMP)).toBe(false);
  });

  it("rejects when the timestamp differs (replay-with-edit)", () => {
    const body = '{"type":"meeting.ended"}';
    const sig = makeSignature(body, SECRET_BYTES, "1234567890");
    expect(verifyDailySignature(body, sig, SECRET, TIMESTAMP)).toBe(false);
  });

  it("rejects when signature length mismatches (truncated)", () => {
    const body = '{"type":"meeting.ended"}';
    const truncated = makeSignature(body).slice(0, 16);
    expect(verifyDailySignature(body, truncated, SECRET, TIMESTAMP)).toBe(false);
  });

  it("rejects an empty signature header", () => {
    const body = '{"type":"meeting.ended"}';
    expect(verifyDailySignature(body, "", SECRET, TIMESTAMP)).toBe(false);
  });

  it("rejects an empty timestamp header", () => {
    const body = '{"type":"meeting.ended"}';
    expect(verifyDailySignature(body, makeSignature(body), SECRET, "")).toBe(false);
  });

  it("rejects when body is tampered after signing", () => {
    const original = '{"type":"meeting.ended","id":"evt_1"}';
    const tampered = '{"type":"meeting.ended","id":"evt_2"}';
    const sig = makeSignature(original);
    expect(verifyDailySignature(tampered, sig, SECRET, TIMESTAMP)).toBe(false);
  });

  it("is sensitive to whitespace in the raw body", () => {
    const compact = '{"type":"meeting.ended"}';
    const pretty = '{"type": "meeting.ended"}';
    const sig = makeSignature(compact);
    expect(verifyDailySignature(pretty, sig, SECRET, TIMESTAMP)).toBe(false);
  });

  it("rejects when the secret is not valid base64", () => {
    const body = '{"type":"meeting.ended"}';
    const sig = makeSignature(body);
    expect(verifyDailySignature(body, sig, "", TIMESTAMP)).toBe(false);
  });

  it("matches the captured Daily.co probe fixture (2026-05-12 capture)", () => {
    // Real values captured by intercepting Daily's verification probe.
    const fixtureSecret = "cR0xocJXAg53MKgBFQXnnEPwvrXTPPVhehv5Fzp2nxc=";
    const fixtureBody = '{"test":"test"}';
    const fixtureTimestamp = "1778619696910";
    const fixtureSig = "0xekj4oKDC1qhAn8XHaE+IqNv7XtLm+CKo/yQRThPAI=";
    expect(verifyDailySignature(fixtureBody, fixtureSig, fixtureSecret, fixtureTimestamp)).toBe(true);
  });
});
