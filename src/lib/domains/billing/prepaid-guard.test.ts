import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/logger", () => ({
  logError: vi.fn(),
}));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: vi.fn(),
}));

import { assertPrepaidGrantValid } from "./prepaid-guard";

const STUDENT_ID = "00000000-0000-1000-8000-000000000001";

type MockAdmin = {
  from: ReturnType<typeof vi.fn>;
};

function makeAdmin(
  profile: { id: string; role: string } | null | undefined,
  profileErr: { message: string } | null = null,
): {
  admin: Parameters<typeof assertPrepaidGrantValid>[0];
  mock: MockAdmin;
} {
  const maybeSingle = vi.fn().mockResolvedValue({ data: profile, error: profileErr });
  const eq = vi.fn(() => ({ maybeSingle }));
  const select = vi.fn(() => ({ eq }));
  const from = vi.fn((table: string) => {
    if (table === "profiles") return { select };
    throw new Error(`unexpected table: ${table}`);
  });
  return { admin: { from } as never, mock: { from } };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("assertPrepaidGrantValid", () => {
  it("returns ok:true when charged cents match hours × rate and the student owns it", async () => {
    const { admin, mock } = makeAdmin({ id: STUDENT_ID, role: "student" });

    const result = await assertPrepaidGrantValid(admin, {
      studentId: STUDENT_ID,
      hours: 10,
      rate: 10,
      chargedCents: 10000,
    });

    expect(result).toEqual({ ok: true });
    expect(mock.from).toHaveBeenCalledWith("profiles");
  });

  // ── Tamper guard ────────────────────────────────────────────────────────
  it("returns ok:false on a tampered chargedCents and never touches profiles (no RPC would fire)", async () => {
    const { admin, mock } = makeAdmin({ id: STUDENT_ID, role: "student" });

    const result = await assertPrepaidGrantValid(admin, {
      studentId: STUDENT_ID,
      hours: 10,
      rate: 10,
      chargedCents: 1000, // paid $10 for what should cost $100
    });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toMatch(/amount mismatch/i);
    // Tamper guard runs BEFORE ownership — the profiles lookup (and therefore
    // any downstream grant RPC in a real caller) never runs on a mismatch.
    expect(mock.from).not.toHaveBeenCalled();
  });

  it("rejects a tampered rate post-checkout (desync between hours/rate and charge)", async () => {
    const { admin } = makeAdmin({ id: STUDENT_ID, role: "student" });

    const result = await assertPrepaidGrantValid(admin, {
      studentId: STUDENT_ID,
      hours: 10,
      rate: 0.01,
      chargedCents: 10000,
    });

    expect(result.ok).toBe(false);
  });

  // ── Ownership / fail-closed ─────────────────────────────────────────────
  it("returns ok:false when no profile exists for studentId", async () => {
    const { admin } = makeAdmin(null);

    const result = await assertPrepaidGrantValid(admin, {
      studentId: STUDENT_ID,
      hours: 10,
      rate: 10,
      chargedCents: 10000,
    });

    expect(result.ok).toBe(false);
  });

  it("returns ok:false when the resolved profile role is not 'student'", async () => {
    const { admin } = makeAdmin({ id: STUDENT_ID, role: "teacher" });

    const result = await assertPrepaidGrantValid(admin, {
      studentId: STUDENT_ID,
      hours: 10,
      rate: 10,
      chargedCents: 10000,
    });

    expect(result.ok).toBe(false);
  });

  it("returns ok:false when the profile lookup errors", async () => {
    const { admin } = makeAdmin(undefined, { message: "db down" });

    const result = await assertPrepaidGrantValid(admin, {
      studentId: STUDENT_ID,
      hours: 10,
      rate: 10,
      chargedCents: 10000,
    });

    expect(result.ok).toBe(false);
  });
});
