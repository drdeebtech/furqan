/**
 * T020 / T020.5 — Idempotency + misclick-filter handler tests (US3).
 *
 * T020: Duplicate event_id returns { ok:true, applied:false, reason:"duplicate" }
 *       and dispatchDailyEvent is only called once (ON CONFLICT has already handled the DB side).
 *
 * T020.5: meeting.ended with duration:240 produces status_outcome:"no_show",
 *         exactly one "session.no_show" emit, zero "session.ended" emits.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";
import { createHmac } from "node:crypto";

// ── Mocks ─────────────────────────────────────────────────────────────────────

vi.mock("server-only", () => ({}));

const mockDispatch = vi.fn();
const mockEmitEvent = vi.fn().mockResolvedValue(undefined);
const mockLogError  = vi.fn();

vi.mock("@/lib/daily/webhook-handler", () => ({
  dispatchDailyEvent: mockDispatch,
}));
vi.mock("@/lib/automation/emit", () => ({
  emitEvent: mockEmitEvent,
}));
vi.mock("@/lib/logger", () => ({
  logError: mockLogError,
}));

const { POST } = await import("./route");

// ── Helpers ───────────────────────────────────────────────────────────────────

const SECRET = "test-secret-idem-32chars-abcdefgh";

function sign(body: string): string {
  return createHmac("sha256", SECRET).update(body).digest("hex");
}

function makeRequest(payloadOverrides: Record<string, unknown> = {}): NextRequest {
  const body = JSON.stringify({
    id:        "evt_idem_001",
    type:      "meeting.ended",
    version:   "1",
    timestamp: Date.now(),
    room: { name: "furqan-idem-room", id: "room_x", domain_name: "furqan.daily.co" },
    data: { start_time: Math.floor(Date.now() / 1000) - 1800, end_time: Math.floor(Date.now() / 1000), duration: 1800 },
    ...payloadOverrides,
  });
  return new NextRequest("https://www.furqan.today/api/webhooks/daily", {
    method:  "POST",
    headers: { "content-type": "application/json", "x-webhook-signature": sign(body) },
    body,
  });
}

// ── T020: Idempotency ─────────────────────────────────────────────────────────

describe("T020 — duplicate event_id idempotency", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv("DAILY_WEBHOOK_SECRET", SECRET);
    vi.stubEnv("DAILY_WEBHOOK_SECRET_PREVIOUS", "");
  });

  it("returns applied:false reason:duplicate when dispatchDailyEvent returns kind:duplicate", async () => {
    mockDispatch.mockResolvedValue({
      kind:      "duplicate",
      sessionId: "sess-uuid-1",
      bookingId: "book-uuid-1",
      studentId: "stud-uuid-1",
      teacherId: "tchr-uuid-1",
    });

    const res  = await POST(makeRequest());
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json).toMatchObject({ ok: true, applied: false, reason: "duplicate" });
  });

  it("does NOT emit any event when duplicate", async () => {
    mockDispatch.mockResolvedValue({
      kind:      "duplicate",
      sessionId: "sess-uuid-1",
      bookingId: "book-uuid-1",
      studentId: "stud-uuid-1",
      teacherId: "tchr-uuid-1",
    });

    await POST(makeRequest());

    // give any fire-and-forget a tick to settle
    await new Promise((r) => setTimeout(r, 10));

    expect(mockEmitEvent).not.toHaveBeenCalled();
  });
});

// ── T020.5: Misclick filter + Q1 event selection ──────────────────────────────

describe("T020.5 — misclick filter: duration:240 → no_show, not session.ended", () => {
  const SESSION_ID = "sess-uuid-nshow";
  const BOOKING_ID = "book-uuid-nshow";
  const STUDENT_ID = "stud-uuid-nshow";
  const TEACHER_ID = "tchr-uuid-nshow";

  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv("DAILY_WEBHOOK_SECRET", SECRET);
    vi.stubEnv("DAILY_WEBHOOK_SECRET_PREVIOUS", "");
  });

  it("returns status_outcome:no_show in response body", async () => {
    mockDispatch.mockResolvedValue({
      kind:          "applied",
      sessionId:     SESSION_ID,
      bookingId:     BOOKING_ID,
      studentId:     STUDENT_ID,
      teacherId:     TEACHER_ID,
      statusOutcome: "no_show",
      isReconcile:   false,
    });

    const res  = await POST(makeRequest({ data: { duration: 240 } }));
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.status_outcome).toBe("no_show");
    expect(json.reason).toBe("misclick-filter");
  });

  it("emits exactly one session.no_show event with reason:misclick-filter and duration_seconds", async () => {
    mockDispatch.mockResolvedValue({
      kind:          "applied",
      sessionId:     SESSION_ID,
      bookingId:     BOOKING_ID,
      studentId:     STUDENT_ID,
      teacherId:     TEACHER_ID,
      statusOutcome: "no_show",
      isReconcile:   false,
    });

    await POST(makeRequest({ data: { start_time: Math.floor(Date.now() / 1000) - 240, end_time: Math.floor(Date.now() / 1000), duration: 240 } }));

    // Flush fire-and-forget promise
    await new Promise((r) => setTimeout(r, 10));

    const nshowCalls = mockEmitEvent.mock.calls.filter((c) => c[0] === "session.no_show");
    expect(nshowCalls).toHaveLength(1);
    expect(nshowCalls[0][3]).toMatchObject({
      reason:           "misclick-filter",
      duration_seconds: 240,
    });
  });

  it("emits zero session.ended events for no_show outcome", async () => {
    mockDispatch.mockResolvedValue({
      kind:          "applied",
      sessionId:     SESSION_ID,
      bookingId:     BOOKING_ID,
      studentId:     STUDENT_ID,
      teacherId:     TEACHER_ID,
      statusOutcome: "no_show",
      isReconcile:   false,
    });

    await POST(makeRequest({ data: { duration: 240 } }));
    await new Promise((r) => setTimeout(r, 10));

    const endedCalls = mockEmitEvent.mock.calls.filter((c) => c[0] === "session.ended");
    expect(endedCalls).toHaveLength(0);
  });
});
