/**
 * auto-complete-sessions cron — drift-from-endSession regression test.
 *
 * The cron re-implements the confirmed→completed fan-out inline instead of
 * delegating to the canonical `endSession` orchestrator (attendance-policy
 * differs, so full delegation is a separate follow-up — see route.ts header
 * comment). It had DRIFTED on the teacher-attended branch: it never awarded
 * the `first_session` achievement and never sent the parent completion
 * report, so a student closed by the 15-minute cron silently lost their
 * badge and their parent lost the summary.
 *
 * This test locks in that both best-effort calls happen, with the same
 * arg shapes `endSession` uses (see src/lib/domains/session/orchestrate.ts).
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("server-only", () => ({}));

const {
  mockCreateAdminClient,
  mockAwardAchievement,
  mockNotifyParentSessionComplete,
  mockFinalizeAttendance,
  mockNotify,
  mockEmitEvent,
  mockLogError,
} = vi.hoisted(() => ({
  mockCreateAdminClient: vi.fn(),
  mockAwardAchievement: vi.fn().mockResolvedValue({ awarded: true }),
  mockNotifyParentSessionComplete: vi.fn().mockResolvedValue(undefined),
  mockFinalizeAttendance: vi.fn().mockResolvedValue(undefined),
  mockNotify: vi.fn().mockResolvedValue(undefined),
  mockEmitEvent: vi.fn().mockResolvedValue(undefined),
  mockLogError: vi.fn(),
}));

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: mockCreateAdminClient,
}));

vi.mock("@/lib/domains/achievements/award", () => ({
  awardAchievement: mockAwardAchievement,
}));

vi.mock("@/lib/notifications/parent", () => ({
  notifyParentSessionComplete: mockNotifyParentSessionComplete,
}));

vi.mock("@/lib/domains/attendance/finalize", () => ({
  finalizeAttendance: mockFinalizeAttendance,
}));

vi.mock("@/lib/notifications/dispatcher", () => ({
  notify: mockNotify,
}));

vi.mock("@/lib/automation/emit", () => ({
  emitEvent: mockEmitEvent,
}));

vi.mock("@/lib/logger", () => ({
  logError: mockLogError,
}));

// Bypass the Sentry check-in + dual-auth wrapper — it's exercised elsewhere;
// this test is about the post-completion side effects of the handler body.
vi.mock("@/lib/sentry/cron", () => ({
  withAuthedCronMonitor: (
    _slug: string,
    _schedule: string,
    handler: () => Promise<Response>,
  ) => handler,
}));

const { GET } = await import("./route");

// ── Fixtures ─────────────────────────────────────────────────────────────────

const SESSION_ID = "sess-1";
const BOOKING_ID = "book-1";
const STUDENT_ID = "stu-1";
const TEACHER_ID = "tea-1";
const DURATION_MIN = 30;

function makeChain(result: unknown) {
  const chain: Record<string, unknown> = {
    eq: vi.fn(() => chain),
    is: vi.fn(() => chain),
    not: vi.fn(() => chain),
    in: vi.fn(() => chain),
    then: (resolve: (v: unknown) => unknown, reject?: (e: unknown) => unknown) =>
      Promise.resolve(result).then(resolve, reject),
  };
  return chain;
}

/** Teacher-attended, student-attended stranded session, 70min elapsed vs a 30min booking. */
function makeAdmin() {
  const startedAt = new Date(Date.now() - 70 * 60_000).toISOString();
  const sessionRow = {
    id: SESSION_ID,
    booking_id: BOOKING_ID,
    started_at: startedAt,
    teacher_joined: true,
    student_joined: true,
  };
  const bookingRow = {
    id: BOOKING_ID,
    duration_min: DURATION_MIN,
    student_id: STUDENT_ID,
    teacher_id: TEACHER_ID,
  };

  return {
    from: vi.fn((table: string) => ({
      select: vi.fn(() => {
        if (table === "sessions") return makeChain({ data: [sessionRow], error: null });
        if (table === "bookings") return makeChain({ data: [bookingRow], error: null });
        return makeChain({ data: [], error: null });
      }),
      update: vi.fn(() => makeChain({ error: null })),
      insert: vi.fn(() => makeChain({ error: null })),
    })),
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockCreateAdminClient.mockReturnValue(makeAdmin());
});

const FAKE_REQUEST = new Request("https://furqan.today/api/cron/auto-complete-sessions");
describe("cron auto-complete-sessions — teacher-attended branch", () => {
  it("awards the first_session achievement, matching endSession's call shape", async () => {
    await GET(FAKE_REQUEST);

    expect(mockAwardAchievement).toHaveBeenCalledWith(STUDENT_ID, "first_session");
  });

  it("sends the parent completion report, matching endSession's call shape", async () => {
    await GET(FAKE_REQUEST);

    expect(mockNotifyParentSessionComplete).toHaveBeenCalledWith(
      SESSION_ID,
      "00000000-0000-0000-0000-000000000000",
    );
  });
});
