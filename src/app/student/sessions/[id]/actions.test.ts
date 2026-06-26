import { describe, it, expect, vi, beforeEach } from "vitest";

// ---------------------------------------------------------------------------
// generateSessionToken mocks. vi.mock factories are hoisted above imports,
// so any mock fn referenced inside a factory must be created with
// vi.hoisted (which lifts them above the hoisted vi.mock calls too).
// ---------------------------------------------------------------------------

vi.mock("server-only", () => ({}));

const {
  mockGetUser,
  mockSessionSingle,
  mockBookingSingle,
  mockAuditInsert,
  mockCreateMeetingToken,
} = vi.hoisted(() => ({
  mockGetUser: vi.fn(),
  mockSessionSingle: vi.fn(),
  mockBookingSingle: vi.fn(),
  mockAuditInsert: vi.fn(() => Promise.resolve({ error: null })),
  mockCreateMeetingToken: vi.fn(),
}));

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(async () => ({
    auth: { getUser: mockGetUser },
    from: (table: string) => {
      if (table === "sessions") {
        return {
          select: () => ({
            eq: () => ({ single: mockSessionSingle }),
          }),
        };
      }
      if (table === "bookings") {
        return {
          select: () => ({
            eq: () => ({ single: mockBookingSingle }),
          }),
        };
      }
      throw new Error(`unexpected table ${table}`);
    },
  })),
}));

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: vi.fn(() => ({
    from: () => ({
      insert: () => ({
        then: (onFulfilled: unknown) =>
          Promise.resolve(mockAuditInsert()).then(onFulfilled as never),
      }),
    }),
  })),
}));

vi.mock("@/lib/daily", () => ({
  createMeetingToken: mockCreateMeetingToken,
}));

vi.mock("@/lib/automation/emit", () => ({ emitEvent: vi.fn() }));

const USER_ID = "user-student-1";
const SESSION_ID = "sess-1";
const BOOKING_ID = "booking-1";

import { generateSessionToken } from "./actions";

function sessionRow() {
  return {
    id: SESSION_ID,
    booking_id: BOOKING_ID,
    room_name: "room-x",
    room_url: "https://daily.co/room-x",
    expires_at: null,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockGetUser.mockResolvedValue({
    data: { user: { id: USER_ID, user_metadata: { full_name: "T" } } },
  });
  mockSessionSingle.mockResolvedValue({ data: sessionRow(), error: null });
});

describe("generateSessionToken — booking status guard (issue #534)", () => {
  it("returns a token when the booking is confirmed (happy path)", async () => {
    mockBookingSingle.mockResolvedValue({
      data: { student_id: USER_ID, teacher_id: "teacher-1", status: "confirmed" },
      error: null,
    });
    mockCreateMeetingToken.mockResolvedValue("tok-123");

    const result = await generateSessionToken(SESSION_ID);

    expect(result).toEqual({ token: "tok-123", roomUrl: "https://daily.co/room-x" });
    expect(mockCreateMeetingToken).toHaveBeenCalledTimes(1);
  });

  it("denies a Daily.co token when the booking is cancelled", async () => {
    mockBookingSingle.mockResolvedValue({
      data: { student_id: USER_ID, teacher_id: "teacher-1", status: "cancelled" },
      error: null,
    });

    const result = await generateSessionToken(SESSION_ID);

    expect(result).toEqual({ error: "تم إلغاء هذا الحجز" });
    expect(mockCreateMeetingToken).not.toHaveBeenCalled();
  });

  it("denies a token for a pending booking (not yet confirmed)", async () => {
    mockBookingSingle.mockResolvedValue({
      data: { student_id: USER_ID, teacher_id: "teacher-1", status: "pending" },
      error: null,
    });

    const result = await generateSessionToken(SESSION_ID);

    expect(result).toEqual({ error: "تم إلغاء هذا الحجز" });
    expect(mockCreateMeetingToken).not.toHaveBeenCalled();
  });

  it("still rejects a non-participant even if the booking is confirmed", async () => {
    mockBookingSingle.mockResolvedValue({
      data: { student_id: "someone-else", teacher_id: "teacher-1", status: "confirmed" },
      error: null,
    });

    const result = await generateSessionToken(SESSION_ID);

    expect(result).toEqual({ error: "ليس لديك صلاحية لهذه الجلسة" });
    expect(mockCreateMeetingToken).not.toHaveBeenCalled();
  });
});
