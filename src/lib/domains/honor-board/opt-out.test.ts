import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/logger", () => ({ logError: vi.fn() }));

const mocks = vi.hoisted(() => {
  const guardianChain = {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    maybeSingle: vi.fn(),
  };
  const boardChain = {
    update: vi.fn().mockReturnThis(),
    eq: vi.fn(),
  };
  const fromMock = vi.fn((table: string) => {
    if (table === "guardian_children") return guardianChain;
    return boardChain;
  });
  return { guardianChain, boardChain, fromMock };
});

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: vi.fn(() => ({ from: mocks.fromMock })),
}));

import { setOptOut } from "./opt-out";

const STUDENT = "student-aaa";
const GUARDIAN = "guardian-bbb";
const STRANGER = "stranger-ccc";

beforeEach(() => {
  vi.clearAllMocks();
  mocks.guardianChain.select.mockReturnThis();
  mocks.guardianChain.eq.mockReturnThis();
  mocks.boardChain.update.mockReturnThis();
  mocks.fromMock.mockImplementation((table: string) => {
    if (table === "guardian_children") return mocks.guardianChain;
    return mocks.boardChain;
  });
});

describe("setOptOut", () => {
  it("student can opt out of their own entry", async () => {
    mocks.boardChain.eq.mockResolvedValueOnce({ error: null });
    const result = await setOptOut(STUDENT, true, STUDENT);
    expect(result.ok).toBe(true);
    expect(mocks.guardianChain.maybeSingle).not.toHaveBeenCalled();
  });

  it("update writes is_opted_out=true to the correct student row", async () => {
    mocks.boardChain.eq.mockResolvedValueOnce({ error: null });
    await setOptOut(STUDENT, true, STUDENT);
    expect(mocks.boardChain.update).toHaveBeenCalledWith({ is_opted_out: true });
    expect(mocks.boardChain.eq).toHaveBeenCalledWith("student_id", STUDENT);
  });

  it("guardian linked to minor can opt out on their behalf", async () => {
    mocks.guardianChain.maybeSingle.mockResolvedValueOnce({
      data: { guardian_id: GUARDIAN },
      error: null,
    });
    mocks.boardChain.eq.mockResolvedValueOnce({ error: null });

    const result = await setOptOut(STUDENT, false, GUARDIAN);
    expect(result.ok).toBe(true);
  });

  it("non-linked third party gets 403", async () => {
    mocks.guardianChain.maybeSingle.mockResolvedValueOnce({ data: null, error: null });

    const result = await setOptOut(STUDENT, true, STRANGER);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.status).toBe(403);
  });

  it("guardian_children DB error returns 500", async () => {
    mocks.guardianChain.maybeSingle.mockResolvedValueOnce({
      data: null,
      error: { message: "db error" },
    });

    const result = await setOptOut(STUDENT, true, GUARDIAN);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.status).toBe(500);
  });

  it("honor_board_entries update DB error returns 500", async () => {
    mocks.boardChain.eq.mockResolvedValueOnce({ error: { message: "update failed" } });

    const result = await setOptOut(STUDENT, true, STUDENT);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.status).toBe(500);
  });

  it("update payload contains only is_opted_out — no PII columns (SC-008)", async () => {
    mocks.boardChain.eq.mockResolvedValueOnce({ error: null });
    await setOptOut(STUDENT, true, STUDENT);
    const updatePayload = mocks.boardChain.update.mock.calls[0][0] as Record<string, unknown>;
    expect(Object.keys(updatePayload)).toEqual(["is_opted_out"]);
  });
});
