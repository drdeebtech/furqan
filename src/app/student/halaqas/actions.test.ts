import { describe, it, expect, vi, beforeEach } from "vitest";

// ---------------------------------------------------------------------------
// Task 10: enroll_participant / release_participant RPC adapter tests.
// The RPC itself is proven atomic on real local Postgres (see the migration
// file's header comment + the session's DB proof); these tests only verify
// the adapter's success path and its error-code -> Arabic-message mapping.
// ---------------------------------------------------------------------------

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/automation/emit", () => ({ emitEvent: vi.fn(() => Promise.resolve()) }));

const { mockGetUser, mockProfileSingle, mockSessionSingle, mockRpc } = vi.hoisted(() => ({
  mockGetUser: vi.fn(),
  mockProfileSingle: vi.fn(),
  mockSessionSingle: vi.fn(),
  mockRpc: vi.fn(),
}));

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(async () => ({
    auth: { getUser: mockGetUser },
    from: (table: string) => {
      if (table === "profiles") {
        return { select: () => ({ eq: () => ({ maybeSingle: mockProfileSingle }) }) };
      }
      throw new Error(`unexpected table ${table}`);
    },
  })),
}));

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: vi.fn(() => ({
    from: (table: string) => {
      if (table === "sessions") {
        return {
          select: () => ({ eq: () => ({ maybeSingle: mockSessionSingle }) }),
        };
      }
      throw new Error(`unexpected table ${table}`);
    },
    rpc: mockRpc,
  })),
}));

import { enrollInHalaqa, cancelHalaqaEnrollment } from "./actions";

const USER_ID = "student-1";
const SESSION_ID = "11111111-1111-4111-8111-111111111111";

function formData(sessionId = SESSION_ID) {
  const fd = new FormData();
  fd.set("session_id", sessionId);
  return fd;
}

function openHalaqaSnapshot(overrides: Record<string, unknown> = {}) {
  return {
    id: SESSION_ID,
    session_mode: "halaqa",
    scheduled_at: new Date(Date.now() + 3600_000).toISOString(),
    ended_at: null,
    capacity: 5,
    current_enrollment: 1,
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockGetUser.mockResolvedValue({ data: { user: { id: USER_ID } } });
  mockProfileSingle.mockResolvedValue({ data: { role: "student" } });
  mockSessionSingle.mockResolvedValue({ data: openHalaqaSnapshot(), error: null });
});

describe("enrollInHalaqa — enroll_participant RPC adapter", () => {
  it("returns ok on a successful enroll", async () => {
    mockRpc.mockResolvedValue({ data: null, error: null });

    const result = await enrollInHalaqa({}, formData());

    expect(result).toEqual({ ok: true });
    expect(mockRpc).toHaveBeenCalledWith("enroll_participant", {
      p_session_id: SESSION_ID,
      p_user_id: USER_ID,
    });
  });

  it("maps a P0003 (at-capacity) RPC error to the Arabic 'full' message", async () => {
    mockRpc.mockResolvedValue({ data: null, error: { code: "P0003", message: "at capacity" } });

    const result = await enrollInHalaqa({}, formData());

    expect(result).toEqual({ error: "الحلقة ممتلئة" });
  });

  it("maps a 23505 (duplicate) RPC error to the Arabic 'already enrolled' message", async () => {
    mockRpc.mockResolvedValue({ data: null, error: { code: "23505", message: "duplicate key" } });

    const result = await enrollInHalaqa({}, formData());

    expect(result).toEqual({ error: "أنت مسجل في هذه الحلقة بالفعل" });
  });

  it("returns a generic failure message for any other RPC error", async () => {
    mockRpc.mockResolvedValue({ data: null, error: { code: "XX000", message: "boom" } });

    const result = await enrollInHalaqa({}, formData());

    expect(result).toEqual({ error: "فشل التسجيل" });
  });
});

describe("cancelHalaqaEnrollment — release_participant RPC adapter", () => {
  it("returns ok when release_participant reports the row was removed", async () => {
    mockRpc.mockResolvedValue({ data: true, error: null });

    const result = await cancelHalaqaEnrollment({}, formData());

    expect(result).toEqual({ ok: true });
    expect(mockRpc).toHaveBeenCalledWith("release_participant", {
      p_session_id: SESSION_ID,
      p_user_id: USER_ID,
    });
  });

  it("returns 'not enrolled' when release_participant returns false", async () => {
    mockRpc.mockResolvedValue({ data: false, error: null });

    const result = await cancelHalaqaEnrollment({}, formData());

    expect(result).toEqual({ error: "لست مسجلاً في هذه الحلقة" });
  });

  it("returns a generic failure message on an RPC error", async () => {
    mockRpc.mockResolvedValue({ data: null, error: { code: "XX000", message: "boom" } });

    const result = await cancelHalaqaEnrollment({}, formData());

    expect(result).toEqual({ error: "فشل الإلغاء" });
  });
});
