/**
 * T013.5 — FR-001 skew-window rejection tests.
 *
 * Verifies that payloads with timestamp outside the ±15-min window:
 *  - Return HTTP 200 (Daily must not retry)
 *  - Return { ok: true, applied: false, reason: "stale-event" }
 *  - Do NOT mutate sessions rows (dispatchDailyEvent never called)
 *  - Emit exactly one Sentry warning per call
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";
import { createHmac, randomBytes } from "node:crypto";

// ── Mocks ─────────────────────────────────────────────────────────────────────

// Silence server-only guard (route handler is a Next.js server module)
vi.mock("server-only", () => ({}));

const mockDispatch = vi.fn();
const mockLogError = vi.fn();

vi.mock("@/lib/daily/webhook-handler", () => ({
  dispatchDailyEvent: mockDispatch,
}));

vi.mock("@/lib/logger", () => ({
  logError: mockLogError,
}));

vi.mock("@/lib/automation/emit", () => ({
  emitEvent: vi.fn().mockResolvedValue(undefined),
}));

// Import after mocking
const { POST } = await import("./route");

// ── Helpers ───────────────────────────────────────────────────────────────────

// Daily.co's hmac field at registration time is base64; the signing key is
// the decoded bytes. Fixtures must match the same protocol.
const SECRET_BYTES = randomBytes(32);
const SECRET = SECRET_BYTES.toString("base64");
const WEBHOOK_TS = "1778619696910";

function sign(body: string, timestamp = WEBHOOK_TS): string {
  return createHmac("sha256", SECRET_BYTES).update(`${timestamp}.${body}`).digest("base64");
}

function makePayload(timestampMs: number, type = "meeting.ended"): string {
  return JSON.stringify({
    id:        "evt_skew_test_001",
    type,
    version:   "1",
    timestamp: timestampMs,
    room: { name: "furqan-skewtest", id: "room_x", domain_name: "furqan.daily.co" },
    data: {
      start_time: Math.floor(timestampMs / 1000) - 1800,
      end_time:   Math.floor(timestampMs / 1000),
      duration:   1800,
    },
  });
}

function makeRequest(body: string): NextRequest {
  const sig = sign(body);
  return new NextRequest("https://www.furqan.today/api/webhooks/daily", {
    method:  "POST",
    headers: {
      "content-type":        "application/json",
      "x-webhook-signature": sig,
      "x-webhook-timestamp": WEBHOOK_TS,
    },
    body,
  });
}

// ── Tests ──────────────────────────────────────────────────────────────────────

describe("FR-001 ±15-min skew window", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv("DAILY_WEBHOOK_SECRET", SECRET);
    vi.stubEnv("DAILY_WEBHOOK_SECRET_PREVIOUS", "");
  });

  it("rejects a payload timestamped 30 minutes in the past with 200 + stale-event", async () => {
    const staleTs = Date.now() - 30 * 60 * 1000;
    const body = makePayload(staleTs);
    const req  = makeRequest(body);

    const res  = await POST(req);
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json).toMatchObject({ ok: true, applied: false, reason: "stale-event" });
    expect(mockDispatch).not.toHaveBeenCalled();
  });

  it("emits exactly one Sentry warning for a past-stale event", async () => {
    const staleTs = Date.now() - 30 * 60 * 1000;
    const body = makePayload(staleTs);
    const req  = makeRequest(body);

    await POST(req);

    const warningCalls = mockLogError.mock.calls.filter(
      (call) => call[2]?.severity === "warning",
    );
    expect(warningCalls).toHaveLength(1);
    expect(warningCalls[0][0]).toMatch(/skew/);
  });

  it("rejects a payload timestamped 30 minutes in the future with 200 + stale-event", async () => {
    const futureTs = Date.now() + 30 * 60 * 1000;
    const body = makePayload(futureTs);
    const req  = makeRequest(body);

    const res  = await POST(req);
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json).toMatchObject({ ok: true, applied: false, reason: "stale-event" });
    expect(mockDispatch).not.toHaveBeenCalled();
  });

  it("emits exactly one Sentry warning for a future-stale event", async () => {
    const futureTs = Date.now() + 30 * 60 * 1000;
    const body = makePayload(futureTs);
    const req  = makeRequest(body);

    await POST(req);

    const warningCalls = mockLogError.mock.calls.filter(
      (call) => call[2]?.severity === "warning",
    );
    expect(warningCalls).toHaveLength(1);
  });

  it("accepts a payload timestamped 5 minutes ago (inside window)", async () => {
    const recentTs = Date.now() - 5 * 60 * 1000;
    const body = makePayload(recentTs);
    const req  = makeRequest(body);

    // dispatchDailyEvent returns a result so the handler doesn't throw
    mockDispatch.mockResolvedValue({ kind: "unsupported-type", eventType: "meeting.ended" });

    const res = await POST(req);

    // Should NOT be stale — dispatch must have been called
    const json = await res.json();
    expect(json.reason).not.toBe("stale-event");
    expect(mockDispatch).toHaveBeenCalledOnce();
  });

  it("accepts a payload timestamped right at the 15-min boundary (edge)", async () => {
    // 14:59 ago — should be accepted
    const edgeTs = Date.now() - 14 * 60 * 1000 - 59 * 1000;
    const body = makePayload(edgeTs);
    const req  = makeRequest(body);

    mockDispatch.mockResolvedValue({ kind: "unsupported-type", eventType: "meeting.ended" });

    const res  = await POST(req);
    const json = await res.json();
    expect(json.reason).not.toBe("stale-event");
    expect(mockDispatch).toHaveBeenCalledOnce();
  });
});
