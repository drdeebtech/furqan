import { describe, it, expect, vi, beforeEach } from "vitest";
import type { DailyPayload } from "./webhook-handler";

// ── Mocks ────────────────────────────────────────────────────────────────────

const mockRpc = vi.fn();
const mockSingle = vi.fn();
const mockSelect = vi.fn(() => ({ eq: mockEq }));
const mockEq = vi.fn(() => ({ single: mockSingle }));
const mockFrom = vi.fn(() => ({ select: mockSelect }));

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({ from: mockFrom, rpc: mockRpc }),
}));

// Import AFTER mocking
const { dispatchDailyEvent } = await import("./webhook-handler");

// ── Fixtures ─────────────────────────────────────────────────────────────────

const SESSION_ID = "sess-uuid-1234";
const BOOKING_ID = "book-uuid-5678";
const STUDENT_ID = "stud-uuid-abcd";
const TEACHER_ID = "tchr-uuid-efgh";

function makeEndedPayload(overrides?: Partial<DailyPayload["data"]>): DailyPayload {
  return {
    id: "evt_test_001",
    type: "meeting.ended",
    version: "1",
    timestamp: Date.now(),
    room: { name: "furqan-abc123", id: "room_x", domain_name: "furqan.daily.co" },
    data: {
      start_time: Math.floor(Date.now() / 1000) - 1800,
      end_time:   Math.floor(Date.now() / 1000),
      duration:   1800,
      ...overrides,
    },
  };
}

function _makeStartedPayload(): DailyPayload {
  return {
    id: "evt_started_001",
    type: "meeting.started",
    version: "1",
    timestamp: Date.now(),
    room: { name: "furqan-abc123", id: "room_x", domain_name: "furqan.daily.co" },
    data: { start_time: Math.floor(Date.now() / 1000) },
  };
}

function sessionFound() {
  mockSingle.mockResolvedValue({ data: { id: SESSION_ID }, error: null });
}

function sessionNotFound() {
  mockSingle.mockResolvedValue({ data: null, error: null });
}

function _rpcEndApplied(statusOutcome = "completed") {
  mockRpc.mockResolvedValue({
    data: [{
      booking_id:     BOOKING_ID,
      student_id:     STUDENT_ID,
      teacher_id:     TEACHER_ID,
      is_duplicate:   false,
      is_reconcile:   false,
      status_outcome: statusOutcome,
    }],
    error: null,
  });
}

function _rpcEndDuplicate() {
  mockRpc.mockResolvedValue({
    data: [{
      booking_id:     BOOKING_ID,
      student_id:     STUDENT_ID,
      teacher_id:     TEACHER_ID,
      is_duplicate:   true,
      is_reconcile:   false,
      status_outcome: "duplicate",
    }],
    error: null,
  });
}

// ── Tests ────────────────────────────────────────────────────────────────────

function rpcResolves(rows: object[]) {
  mockRpc.mockResolvedValue({ data: rows, error: null });
}

describe("dispatchDailyEvent", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns applied with status_outcome=completed for meeting.ended on a confirmed booking", async () => {
    sessionFound();
    rpcResolves([{ booking_id: BOOKING_ID, student_id: STUDENT_ID, teacher_id: TEACHER_ID, is_duplicate: false, is_reconcile: false, status_outcome: "completed" }]);

    const result = await dispatchDailyEvent(makeEndedPayload(), "{}");
    expect(result.kind).toBe("applied");
    if (result.kind === "applied") {
      expect(result.statusOutcome).toBe("completed");
      expect(result.sessionId).toBe(SESSION_ID);
    }
  });

  it("returns duplicate for a repeated event_id (SQL ON CONFLICT returned is_duplicate=true)", async () => {
    sessionFound();
    rpcResolves([{ booking_id: BOOKING_ID, student_id: STUDENT_ID, teacher_id: TEACHER_ID, is_duplicate: true, is_reconcile: false, status_outcome: "duplicate" }]);

    const result = await dispatchDailyEvent(makeEndedPayload(), "{}");
    expect(result.kind).toBe("duplicate");
  });

  it("returns unmapped when no session has the given room_name", async () => {
    sessionNotFound();
    const result = await dispatchDailyEvent(makeEndedPayload(), "{}");
    expect(result.kind).toBe("unmapped");
    if (result.kind === "unmapped") {
      expect(result.roomName).toBe("furqan-abc123");
    }
  });

  it("returns unsupported-type for unknown event types", async () => {
    const payload = { ...makeEndedPayload(), type: "recording.ready" };
    const result = await dispatchDailyEvent(payload, "{}");
    expect(result.kind).toBe("unsupported-type");
    if (result.kind === "unsupported-type") {
      expect(result.eventType).toBe("recording.ready");
    }
  });

  it("returns applied with status_outcome=no_show for short-duration call (misclick filter)", async () => {
    sessionFound();
    rpcResolves([{ booking_id: BOOKING_ID, student_id: STUDENT_ID, teacher_id: TEACHER_ID, is_duplicate: false, is_reconcile: false, status_outcome: "no_show" }]);

    const result = await dispatchDailyEvent(makeEndedPayload({ duration: 240 }), "{}");
    expect(result.kind).toBe("applied");
    if (result.kind === "applied") expect(result.statusOutcome).toBe("no_show");
  });
});
