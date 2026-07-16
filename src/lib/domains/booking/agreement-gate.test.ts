import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/logger", () => ({ logError: vi.fn(), logInfo: vi.fn() }));
vi.mock("@/lib/settings", () => ({ isFeatureEnabled: vi.fn() }));

import { teacherAgreementOk } from "./agreement-gate";
import { isFeatureEnabled } from "@/lib/settings";
import { logError } from "@/lib/logger";

const TEACHER = "11111111-1111-4111-8111-111111111111";

function fakeAdmin(rpcResult: { data: unknown; error: unknown }) {
  return { rpc: vi.fn().mockResolvedValue(rpcResult) };
}

describe("teacherAgreementOk (spec 040 FR-029 booking-path precondition)", () => {
  beforeEach(() => vi.clearAllMocks());

  it("is dormant when the gate flag is off — allows and never calls the predicate", async () => {
    vi.mocked(isFeatureEnabled).mockResolvedValue(false);
    // Predicate would DENY if consulted — proves the flag short-circuits it.
    const admin = fakeAdmin({ data: false, error: null });
    await expect(teacherAgreementOk(admin as never, TEACHER)).resolves.toBe(true);
    expect(admin.rpc).not.toHaveBeenCalled();
  });

  it("allows when enabled and the predicate returns true", async () => {
    vi.mocked(isFeatureEnabled).mockResolvedValue(true);
    const admin = fakeAdmin({ data: true, error: null });
    await expect(teacherAgreementOk(admin as never, TEACHER)).resolves.toBe(true);
    expect(admin.rpc).toHaveBeenCalledWith("teacher_agreement_gate_ok", {
      p_teacher_id: TEACHER,
    });
  });

  it("denies when enabled and the predicate returns false", async () => {
    vi.mocked(isFeatureEnabled).mockResolvedValue(true);
    const admin = fakeAdmin({ data: false, error: null });
    await expect(teacherAgreementOk(admin as never, TEACHER)).resolves.toBe(false);
  });

  it("fails closed (denies) and logs when the predicate rpc errors", async () => {
    vi.mocked(isFeatureEnabled).mockResolvedValue(true);
    const admin = fakeAdmin({ data: null, error: { message: "boom" } });
    await expect(teacherAgreementOk(admin as never, TEACHER)).resolves.toBe(false);
    expect(logError).toHaveBeenCalled();
  });

  it("fails closed on an unexpected null/undefined predicate result", async () => {
    vi.mocked(isFeatureEnabled).mockResolvedValue(true);
    const admin = fakeAdmin({ data: null, error: null });
    await expect(teacherAgreementOk(admin as never, TEACHER)).resolves.toBe(false);
  });
});
