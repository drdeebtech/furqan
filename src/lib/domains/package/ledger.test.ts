import { describe, it, expect, vi } from "vitest";

/**
 * Tests for the Package ledger facade (architecture deepening #1).
 *
 * The facade's value is that the "check data, not just error" debit rule
 * (Spec 005 FR-002) and the soonest-expiry selection live in ONE place instead
 * of copy-pasted across three call sites. The interface is the test surface:
 * a fake admin client lets us assert every DebitOutcome branch without a DB.
 */

vi.mock("server-only", () => ({}));

import { selectActivePackage, debitPackage } from "./ledger";

// Minimal fake of the admin client's fluent query builder for selectActivePackage.
function fakeSelectClient(result: { data: unknown }) {
  const chain = {
    select: () => chain,
    eq: () => chain,
    gt: () => chain,
    order: () => chain,
    limit: () => chain,
    maybeSingle: () => Promise.resolve(result),
  };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return { from: () => chain } as any;
}

function fakeRpcClient(result: { data?: unknown; error?: unknown }) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return { rpc: vi.fn().mockResolvedValue(result) } as any;
}

describe("selectActivePackage", () => {
  it("returns the mapped active package when one exists", async () => {
    const admin = fakeSelectClient({ data: { id: "pkg-1", sessions_remaining: 3 } });
    expect(await selectActivePackage(admin, "student-1")).toEqual({
      id: "pkg-1",
      sessionsRemaining: 3,
    });
  });

  it("returns null when the student has no active package with credit", async () => {
    const admin = fakeSelectClient({ data: null });
    expect(await selectActivePackage(admin, "student-1")).toBeNull();
  });
});

describe("debitPackage", () => {
  it("ok when the kernel reports a row was charged", async () => {
    const admin = fakeRpcClient({ data: true });
    expect(await debitPackage(admin, "pkg-1")).toEqual({ ok: true });
    expect(admin.rpc).toHaveBeenCalledWith("deduct_package_session", { p_package_id: "pkg-1" });
  });

  it("exhausted when the kernel returns null (predicate failed, not an error)", async () => {
    // The Spec 005 FR-002 trap: no error, but data !== true means nothing was charged.
    const admin = fakeRpcClient({ data: null });
    expect(await debitPackage(admin, "pkg-1")).toEqual({ ok: false, reason: "exhausted" });
  });

  it("error when the RPC itself fails", async () => {
    const admin = fakeRpcClient({ error: { message: "boom" } });
    expect(await debitPackage(admin, "pkg-1")).toEqual({
      ok: false,
      reason: "error",
      message: "boom",
    });
  });
});
