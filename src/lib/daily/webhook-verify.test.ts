import { createHmac } from "node:crypto";
import { describe, it, expect } from "vitest";
import { verifyDailySignature } from "./webhook-verify";

const SECRET = "test-daily-secret-abc123";

function makeSignature(body: string, secret = SECRET): string {
  return createHmac("sha256", secret).update(body).digest("hex");
}

describe("verifyDailySignature", () => {
  it("accepts a valid signature", () => {
    const body = '{"type":"meeting.ended"}';
    expect(verifyDailySignature(body, makeSignature(body), SECRET)).toBe(true);
  });

  it("rejects a wrong signature", () => {
    const body = '{"type":"meeting.ended"}';
    const sig = makeSignature(body, "wrong-secret");
    expect(verifyDailySignature(body, sig, SECRET)).toBe(false);
  });

  it("rejects when signature length mismatches (truncated hex)", () => {
    const body = '{"type":"meeting.ended"}';
    const truncated = makeSignature(body).slice(0, 32);
    expect(verifyDailySignature(body, truncated, SECRET)).toBe(false);
  });

  it("rejects an empty header", () => {
    const body = '{"type":"meeting.ended"}';
    expect(verifyDailySignature(body, "", SECRET)).toBe(false);
  });

  it("rejects when body is tampered after signing", () => {
    const original = '{"type":"meeting.ended","id":"evt_1"}';
    const tampered = '{"type":"meeting.ended","id":"evt_2"}';
    const sig = makeSignature(original);
    expect(verifyDailySignature(tampered, sig, SECRET)).toBe(false);
  });

  it("is sensitive to whitespace in the raw body", () => {
    const compact = '{"type":"meeting.ended"}';
    const pretty = '{"type": "meeting.ended"}';
    const sig = makeSignature(compact);
    expect(verifyDailySignature(pretty, sig, SECRET)).toBe(false);
  });
});
