import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/logger", () => ({ logError: vi.fn(), logInfo: vi.fn() }));

import { teacherAgreementOk } from "./agreement-gate";
import { logError } from "@/lib/logger";

const TEACHER = "11111111-1111-4111-8111-111111111111";

function fakeAdmin(rpcResult: { data: unknown; error: unknown }) {
  return { rpc: vi.fn().mockResolvedValue(rpcResult) };
}

describe("teacherAgreementOk (spec 040 FR-029 booking-path precondition)", () => {
  beforeEach(() => vi.clearAllMocks());

  it("allows when the predicate returns true (incl. the dormant flag-off case)", async () => {
    // The predicate itself returns true while the gate is disabled, so dormancy
    // is exercised here — there is no separate app-layer flag short-circuit.
    const admin = fakeAdmin({ data: true, error: null });
    await expect(teacherAgreementOk(admin as never, TEACHER)).resolves.toBe(true);
    expect(admin.rpc).toHaveBeenCalledWith("teacher_agreement_gate_ok", {
      p_teacher_id: TEACHER,
    });
  });

  it("denies when the predicate returns false", async () => {
    const admin = fakeAdmin({ data: false, error: null });
    await expect(teacherAgreementOk(admin as never, TEACHER)).resolves.toBe(false);
  });

  it("fails closed (denies) and logs on a generic predicate rpc error", async () => {
    const admin = fakeAdmin({ data: null, error: { code: "XX000", message: "boom" } });
    await expect(teacherAgreementOk(admin as never, TEACHER)).resolves.toBe(false);
    expect(logError).toHaveBeenCalled();
  });

  it("fails closed on an unexpected null/undefined predicate result", async () => {
    const admin = fakeAdmin({ data: null, error: null });
    await expect(teacherAgreementOk(admin as never, TEACHER)).resolves.toBe(false);
  });

  it("allows on PGRST202 (function not in schema cache — deploy window, not a consent failure)", async () => {
    const admin = fakeAdmin({ data: null, error: { code: "PGRST202", message: "not found" } });
    await expect(teacherAgreementOk(admin as never, TEACHER)).resolves.toBe(true);
    expect(logError).not.toHaveBeenCalled();
  });

  it("allows on 42883 (undefined_function — deploy window)", async () => {
    const admin = fakeAdmin({ data: null, error: { code: "42883", message: "does not exist" } });
    await expect(teacherAgreementOk(admin as never, TEACHER)).resolves.toBe(true);
  });
});
